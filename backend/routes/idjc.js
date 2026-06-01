const express = require('express');
const { Keypair, Connection, PublicKey, Transaction, sendAndConfirmTransaction } = require('@solana/web3.js');
const {
    getMint,
    getOrCreateAssociatedTokenAccount,
    createTransferCheckedInstruction,
    TOKEN_PROGRAM_ID,
    TOKEN_2022_PROGRAM_ID,
} = require('@solana/spl-token');
const bs58 = require('bs58');

const CLASSIC_TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

/**
 * Detect which SPL Token program owns a given mint.
 * Returns either TOKEN_PROGRAM_ID or TOKEN_2022_PROGRAM_ID.
 */
const detectTokenProgramId = async (connection, mintPublicKey) => {
    const accountInfo = await connection.getAccountInfo(mintPublicKey);
    if (!accountInfo) {
        throw new Error(`Mint account not found: ${mintPublicKey.toString()}`);
    }
    const owner = accountInfo.owner.toString();
    if (owner === TOKEN_2022_PROGRAM) {
        return TOKEN_2022_PROGRAM_ID;
    }
    if (owner === CLASSIC_TOKEN_PROGRAM) {
        return TOKEN_PROGRAM_ID;
    }
    throw new Error(`Unrecognised token program owner: ${owner}`);
};
const authenticate = require('../middleware/authenticate');
const pool = require('../config/database');
const logger = require('../utils/logger');

const router = express.Router();

const IDJ_COIN_MINT = process.env.IDJC_MINT_ADDRESS || 'DTLkUR3Sfp1LcPVZMSv8toTTK3iwU7WTdF66TawwJpKN';
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const CLAIM_AMOUNT = Number.parseInt(process.env.IDJC_CLAIM_AMOUNT || '1000', 10);
const CLAIM_CAMPAIGN_CODE = process.env.IDJC_CLAIM_CAMPAIGN || 'limited-time-claim-2026';

const SOLANA_ADDRESS_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const normalizeError = (err) => {
    const raw = err?.message || 'Unknown error';
    return String(raw).slice(0, 255);
};

const getTreasuryKeypair = () => {
    const secretKeyValue = process.env.IDJC_TREASURY_SECRET_KEY;

    if (!secretKeyValue) {
        throw new Error('IDJC_TREASURY_SECRET_KEY is not configured');
    }

    const trimmed = secretKeyValue.trim();

    if (trimmed.startsWith('[')) {
        const parsed = JSON.parse(trimmed);
        if (!Array.isArray(parsed) || parsed.length === 0) {
            throw new Error('IDJC_TREASURY_SECRET_KEY JSON format is invalid');
        }

        return Keypair.fromSecretKey(Uint8Array.from(parsed));
    }

    const decodeFn = bs58.default?.decode || bs58.decode;
    return Keypair.fromSecretKey(decodeFn(trimmed));
};

const getUserClaimRecord = async (userId) => {
    const rows = await pool.query(
        `
            SELECT id, status, transaction_signature, claimed_at
            FROM idjc_claims
            WHERE user_id = ? AND campaign_code = ?
            LIMIT 1
        `,
        [userId, CLAIM_CAMPAIGN_CODE]
    );

    return rows.length ? rows[0] : null;
};

router.get('/claim/status', authenticate, async (req, res) => {
    try {
        const userId = Number(req.user.id);
        const profileRows = await pool.query('SELECT id, solana_address FROM profiles WHERE user_id = ? LIMIT 1', [userId]);

        const profile = profileRows.length ? profileRows[0] : null;
        const hasWallet = Boolean(profile?.solana_address && SOLANA_ADDRESS_REGEX.test(profile.solana_address));
        const claim = await getUserClaimRecord(userId);

        if (!hasWallet) {
            return res.json({
                campaign: CLAIM_CAMPAIGN_CODE,
                amount: CLAIM_AMOUNT,
                status: claim?.status || 'needs_wallet',
                canClaim: false,
                needsWallet: true,
            });
        }

        if (!claim || claim.status === 'failed') {
            return res.json({
                campaign: CLAIM_CAMPAIGN_CODE,
                amount: CLAIM_AMOUNT,
                status: claim?.status || 'available',
                canClaim: true,
                needsWallet: false,
            });
        }

        res.json({
            campaign: CLAIM_CAMPAIGN_CODE,
            amount: CLAIM_AMOUNT,
            status: claim.status,
            canClaim: false,
            needsWallet: false,
            transactionSignature: claim.transaction_signature || null,
            claimedAt: claim.claimed_at || null,
        });
    } catch (err) {
        logger.error('Error in GET /idjc/claim/status:', err);
        res.status(500).json({ error: 'Failed to fetch claim status' });
    }
});

router.post('/claim', authenticate, async (req, res) => {
    let claimId;
    let walletAddress;

    try {
        const userId = Number(req.user.id);

        if (!Number.isFinite(userId)) {
            return res.status(400).json({ error: 'Invalid user id' });
        }

        if (!Number.isInteger(CLAIM_AMOUNT) || CLAIM_AMOUNT <= 0) {
            return res.status(500).json({ error: 'Invalid claim amount configuration' });
        }

        const profileRows = await pool.query('SELECT id, solana_address FROM profiles WHERE user_id = ? LIMIT 1', [userId]);
        if (!profileRows.length || !profileRows[0].solana_address) {
            return res.status(400).json({ error: 'Please add your Solana address in your profile before claiming IDJC.' });
        }

        walletAddress = profileRows[0].solana_address;
        if (!SOLANA_ADDRESS_REGEX.test(walletAddress)) {
            return res.status(400).json({ error: 'Your saved Solana wallet address is invalid. Please update your profile.' });
        }

        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();

            const existingRows = await conn.query(
                `
                    SELECT id, status
                    FROM idjc_claims
                    WHERE user_id = ? AND campaign_code = ?
                    LIMIT 1
                    FOR UPDATE
                `,
                [userId, CLAIM_CAMPAIGN_CODE]
            );

            if (existingRows.length) {
                const existing = existingRows[0];
                claimId = existing.id;

                if (existing.status === 'completed') {
                    await conn.rollback();
                    conn.release();
                    return res.status(409).json({ error: 'You already claimed this IDJC reward.' });
                }

                if (existing.status === 'pending') {
                    await conn.rollback();
                    conn.release();
                    return res.status(409).json({ error: 'Your claim is currently being processed. Please wait.' });
                }

                await conn.query(
                    `
                        UPDATE idjc_claims
                        SET status = 'pending',
                            profile_id = ?,
                            wallet_address = ?,
                            amount = ?,
                            error_message = NULL,
                            attempts = attempts + 1,
                            updated_at = NOW()
                        WHERE id = ?
                    `,
                    [profileRows[0].id, walletAddress, CLAIM_AMOUNT, claimId]
                );
            } else {
                const insertResult = await conn.query(
                    `
                        INSERT INTO idjc_claims (user_id, profile_id, wallet_address, amount, campaign_code, status, attempts)
                        VALUES (?, ?, ?, ?, ?, 'pending', 1)
                    `,
                    [userId, profileRows[0].id, walletAddress, CLAIM_AMOUNT, CLAIM_CAMPAIGN_CODE]
                );

                claimId = insertResult.insertId;
            }

            await conn.commit();
            conn.release();
        } catch (dbErr) {
            try {
                await conn.rollback();
            } catch (_rollbackErr) {
                // Ignore rollback errors and return original error.
            }
            conn.release();
            throw dbErr;
        }

        const treasuryKeypair = getTreasuryKeypair();
        const connection = new Connection(SOLANA_RPC_URL, 'confirmed');
        const mintPublicKey = new PublicKey(IDJ_COIN_MINT);
        const destinationPublicKey = new PublicKey(walletAddress);

        const tokenProgramId = await detectTokenProgramId(connection, mintPublicKey);

        // Pre-flight: verify treasury has enough SOL for fees (min ~0.001 SOL)
        const MIN_SOL_LAMPORTS = 1_000_000; // 0.001 SOL
        const treasuryBalance = await connection.getBalance(treasuryKeypair.publicKey, 'confirmed');
        if (treasuryBalance < MIN_SOL_LAMPORTS) {
            logger.error(
                `Treasury wallet ${treasuryKeypair.publicKey.toString()} has insufficient SOL: ${treasuryBalance} lamports`
            );
            throw new Error(`Treasury wallet needs SOL for transaction fees (current balance: ${treasuryBalance} lamports)`);
        }

        const mintInfo = await getMint(connection, mintPublicKey, 'confirmed', tokenProgramId);
        const transferAmount = BigInt(CLAIM_AMOUNT) * (BigInt(10) ** BigInt(mintInfo.decimals));

        const fromTokenAccount = await getOrCreateAssociatedTokenAccount(
            connection,
            treasuryKeypair,
            mintPublicKey,
            treasuryKeypair.publicKey,
            false,
            'confirmed',
            undefined,
            tokenProgramId
        );

        const destinationTokenAccount = await getOrCreateAssociatedTokenAccount(
            connection,
            treasuryKeypair,
            mintPublicKey,
            destinationPublicKey,
            false,
            'confirmed',
            undefined,
            tokenProgramId
        );

        const transferInstruction = createTransferCheckedInstruction(
            fromTokenAccount.address,
            mintPublicKey,
            destinationTokenAccount.address,
            treasuryKeypair.publicKey,
            transferAmount,
            mintInfo.decimals,
            [],
            tokenProgramId
        );

        const { blockhash } = await connection.getLatestBlockhash('confirmed');
        const tx = new Transaction({ recentBlockhash: blockhash, feePayer: treasuryKeypair.publicKey }).add(transferInstruction);

        const signature = await sendAndConfirmTransaction(connection, tx, [treasuryKeypair], {
            commitment: 'confirmed',
        });

        await pool.query(
            `
                UPDATE idjc_claims
                SET status = 'completed',
                    transaction_signature = ?,
                    claimed_at = NOW(),
                    updated_at = NOW()
                WHERE id = ?
            `,
            [signature, claimId]
        );

        res.status(200).json({
            message: `Successfully sent ${CLAIM_AMOUNT.toLocaleString()} IDJC to your wallet.`,
            amount: CLAIM_AMOUNT,
            campaign: CLAIM_CAMPAIGN_CODE,
            transactionSignature: signature,
        });
    } catch (err) {
        logger.error('Error in POST /idjc/claim:', err);

        if (claimId) {
            try {
                await pool.query(
                    `
                        UPDATE idjc_claims
                        SET status = 'failed',
                            error_message = ?,
                            updated_at = NOW()
                        WHERE id = ?
                    `,
                    [normalizeError(err), claimId]
                );
            } catch (updateErr) {
                logger.error('Failed to persist claim failure state:', updateErr);
            }
        }

        if (err instanceof SyntaxError && /JSON/.test(err.message)) {
            return res.status(500).json({ error: 'Treasury wallet key is misconfigured on the server.' });
        }

        if (/debit an account but found no record of a prior credit/i.test(err.message)) {
            return res.status(500).json({ error: 'Treasury wallet has no SOL balance to pay transaction fees. Please contact support.' });
        }

        res.status(500).json({ error: 'Failed to process IDJC claim. Please try again in a moment.' });
    }
});

module.exports = router;

