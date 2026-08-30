# IDJC token metadata

Written down because it was not obvious where this lived. Nothing in the app
code references the metadata host, so searching the repo for it finds nothing.

## Where the metadata actually is

IDJC is a **Token-2022** mint (`TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`)
using the **metadata extension**. That means the name, symbol and URI are
stored **directly on the mint account**, not in a separate Metaplex metadata
PDA. Looking for the usual Metaplex PDA returns nothing, which is what makes
this confusing to come back to.

| | |
|---|---|
| Mint | `DTLkUR3Sfp1LcPVZMSv8toTTK3iwU7WTdF66TawwJpKN` |
| Update authority | `HjSJR8xGc1NbB3eULRUYC5EjZL6UpRJqBrtqFmhz8hi9` |
| Off-chain JSON host | **Pinata**, dedicated gateway `chocolate-magnificent-swan-637.mypinata.cloud` |

The update authority is the same key used as the `referrer` in
`RAYDIUM_SWAP_URL` in `frontend/src/pages/IDJCoin.js`.

## Updating

IPFS is content-addressed, so nothing is ever edited in place. Every change
means pinning new content and pointing at the new CID.

### 1. Pin the image

Upload `frontend/public/idj-coin-512.png` to Pinata. That file is the square
coin mark on its own, which is what a wallet wants; `idj-share-card.png` is
the wide social card and is the wrong shape here.

Both files are produced by `node backend/scripts/generateCoinArt.js`.

### 2. Put the image CID into the JSON

The CID appears **twice**, as `image` and as `properties.files[0].uri`.
Updating only the first is the easy mistake, so substitute both at once:

```sh
sed -i '' "s|REPLACE_WITH_IMAGE_CID|<the-new-cid>|g" token-metadata/idjc-metadata.json
```

### 3. Pin the JSON

Upload the edited `idjc-metadata.json` to Pinata. Keep the dedicated gateway
rather than `gateway.pinata.cloud`: the public gateway is rate limited and is
what the previous image URL used.

### 4. Point the mint at it

Signed by the update authority above. Confirm the exact flags with
`spl-token update-metadata --help` first, since the CLI has changed shape
across releases.

```sh
MINT=DTLkUR3Sfp1LcPVZMSv8toTTK3iwU7WTdF66TawwJpKN
spl-token update-metadata $MINT name   "IDJC"
spl-token update-metadata $MINT symbol "IDJC"
spl-token update-metadata $MINT uri    "https://chocolate-magnificent-swan-637.mypinata.cloud/ipfs/<json-cid>"
spl-token update-metadata $MINT description "IDJC powers InternetDJ.co, ..."
```

`description` is a custom additional-metadata field, not one of the three
built-in ones, and it is stored on-chain **separately** from the description
inside the JSON. Both exist and both were out of date, so change both.

### 5. Verify

Reads the mint back and prints what is actually on chain:

```sh
cd frontend && node -e "
const {Connection, PublicKey} = require('@solana/web3.js');
const MINT = new PublicKey('DTLkUR3Sfp1LcPVZMSv8toTTK3iwU7WTdF66TawwJpKN');
(async () => {
  const c = new Connection('https://api.mainnet-beta.solana.com','confirmed');
  const d = (await c.getAccountInfo(MINT)).data;
  let o = 166;                       // base mint 82b, pad to 165, account_type, then TLV
  while (o + 4 <= d.length) {
    const type = d.readUInt16LE(o), len = d.readUInt16LE(o+2);
    if (type === 0 && len === 0) break;
    if (type === 19) {
      let p = o + 4 + 64;            // update authority + mint
      const str = () => { const n = d.readUInt32LE(p); p+=4; const s=d.slice(p,p+n).toString('utf8'); p+=n; return s; };
      console.log('name  :', str()); console.log('symbol:', str()); console.log('uri   :', str());
      const count = d.readUInt32LE(p); p += 4;
      for (let i=0;i<count;i++) console.log('extra :', str(), '=', str());
    }
    o += 4 + len;
  }
})();"
```

## What changed in this revision

Recorded so the next edit does not quietly undo it.

- `name` and `symbol` were `iDJ Coin` / `iDJc` on chain and `idjc` in the JSON,
  three spellings of one ticker. All now **IDJC**, matching the coin artwork
  and the site copy.
- `description` used an em dash, which reads as machine-written. Rewritten,
  and it now says what a holder actually gets rather than listing abstractions.
- `discord` pointed at invite `hWVFKE38C`, which the Discord API reports as
  **expired**. Replaced with `AbebAd3yS8`, the live invite the site uses.
- `image` pointed at the old slate-blue coin render through the public
  `gateway.pinata.cloud`. Now the redrawn sunset coin, through the dedicated
  gateway.
