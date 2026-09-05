/**
 * The weekly activity email.
 *
 *     node backend/scripts/sendWeeklyDigest.js [--dry-run]
 *
 * Runs from the crontab on the cron machine. Replaces the per-event emails that
 * utils/notifications.js used to send on every review, follow, like and reply:
 * an active week could produce a dozen of them, each carrying one line of news,
 * and the effect of that is an unsubscribe rather than a visit.
 *
 * What it sends is one message per member listing what they have not read, and
 * nothing at all to a member with nothing waiting. Quiet weeks send no mail.
 *
 * Scope is deliberately "unread AND from the last seven days", not "all unread".
 * A member who never opens the bell would otherwise receive the same growing
 * list every week forever, which is the same mistake in a slower costume.
 *
 * Honours the existing preference columns rather than adding another: a member
 * who turned off both profile and artist activity gets no digest. In-site
 * notifications are unaffected either way, and remain the real record.
 */
const pool = require('../config/database');
const Mailgun = require('mailgun.js');
const FormData = require('form-data');
const { out, warnOut, errOut, finish, pad } = require('../utils/cli');

const DRY_RUN = process.argv.includes('--dry-run');

const FRONTEND_URL =
    process.env.FRONTEND_URL ||
    process.env.FRONTEND_URL_PROD ||
    process.env.CLIENT_URL ||
    'https://internetdj.co';

const MAILGUN_DOMAIN = process.env.MAILGUN_DOMAIN;
const MAILGUN_API_KEY = process.env.MAILGUN_API_KEY;

/** How far back a notification still counts as news. */
const WINDOW_DAYS = 7;

/** Above this, the email lists a sample and says how many more there are. */
const MAX_LINES = 12;

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"]/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
));

/** Where a notification points. Mirrors buildActivityUrl in utils/notifications.js. */
const linkFor = (row) => {
    if (row.entity_type === 'song' && row.entity_id) return `${FRONTEND_URL}/song/${row.entity_id}`;
    if (row.entity_type === 'forum_post' && row.entity_id) return `${FRONTEND_URL}/forum/post/${row.entity_id}`;
    if (row.entity_type === 'profile' && row.entity_id) return `${FRONTEND_URL}/profile/${row.entity_id}`;
    if (row.entity_type === 'playlist' && row.entity_id) return `${FRONTEND_URL}/crate/${row.entity_id}`;
    if (row.entity_type === 'release' && row.entity_id) return `${FRONTEND_URL}/release/${row.entity_id}`;
    if (row.entity_type === 'article' && row.entity_id) return `${FRONTEND_URL}/articles/${row.entity_id}`;
    return FRONTEND_URL;
};

/**
 * The stored message is written from the recipient's side and names nobody, so
 * the actor goes back on the front here. Same rewrite the notification bell does.
 */
const describe = (row) => {
    if (row.type === 'site_update') return row.message;
    const actor = row.actor_name && row.actor_name !== 'Unknown' ? row.actor_name : null;
    if (!actor) return row.message;
    const rewritten = String(row.message).replace(/^Someone\b/, actor);
    return rewritten !== row.message ? rewritten : `${actor}: ${row.message}`;
};

const buildHtml = (name, rows, total) => {
    const shown = rows.slice(0, MAX_LINES);
    const items = shown.map((row) => `
        <li style="margin:0 0 10px 0;">
            <a href="${linkFor(row)}" style="color:#0a58ca;text-decoration:none;">
                ${escapeHtml(describe(row))}
            </a>
        </li>`).join('');

    const more = total > shown.length
        ? `<p style="color:#555;">and ${total - shown.length} more.</p>`
        : '';

    return `
        <h2>What you missed on InternetDJ</h2>
        <p>${escapeHtml(name || 'Hello')}, here is what came in this week.</p>
        <ul style="padding-left:18px;">${items}</ul>
        ${more}
        <p><a href="${FRONTEND_URL}">Open InternetDJ</a></p>
        <p style="color:#888;font-size:12px;">
            One email a week, only when there is something waiting. Turn it off in
            <a href="${FRONTEND_URL}/settings">your settings</a>.
        </p>`;
};

(async () => {
    let client = null;
    if (MAILGUN_API_KEY && MAILGUN_DOMAIN) {
        client = new Mailgun(FormData).client({ username: 'api', key: MAILGUN_API_KEY });
    } else if (!DRY_RUN) {
        errOut('MAILGUN_API_KEY / MAILGUN_DOMAIN are not set; nothing can be sent.');
        await finish(1);
        return;
    }

    try {
        // One query for the whole run. Per-member queries would be a round trip
        // each across the membership, on a machine whose only job is cron.
        const rows = await pool.query(
            `
                SELECT n.recipient_user_id, n.type, n.message, n.entity_type, n.entity_id,
                       n.created_at,
                       u.email, u.name AS recipient_name,
                       p.name AS actor_name
                  FROM notifications n
                  JOIN users u ON u.id = n.recipient_user_id
                  LEFT JOIN profiles p ON p.user_id = n.actor_user_id
                 WHERE n.is_read = 0
                   AND n.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
                   AND u.email IS NOT NULL
                   -- A member who switched both activity categories off has
                   -- opted out of activity mail; the digest is activity mail.
                   AND (u.email_profile_activity_enabled = 1 OR u.email_artist_activity_enabled = 1)
                 ORDER BY n.recipient_user_id, n.created_at DESC
            `,
            [WINDOW_DAYS]
        );

        const byMember = new Map();
        for (const row of rows) {
            const id = Number(row.recipient_user_id);
            if (!byMember.has(id)) byMember.set(id, []);
            byMember.get(id).push(row);
        }

        out(`${rows.length} unread notification(s) from the last ${WINDOW_DAYS} days`);
        out(`${byMember.size} member(s) have something waiting`);
        if (DRY_RUN) out('DRY RUN: nothing will be sent.');
        out('');

        let sent = 0;
        let failed = 0;

        for (const [, items] of byMember) {
            const { email, recipient_name: name } = items[0];

            if (DRY_RUN) {
                out(`  ${pad(email, 34)} ${items.length} item(s)  e.g. "${describe(items[0]).slice(0, 52)}"`);
                sent += 1;
                continue;
            }

            try {
                await client.messages.create(MAILGUN_DOMAIN, {
                    from: `InternetDJ <noreply@${MAILGUN_DOMAIN}>`,
                    to: email,
                    subject: items.length === 1
                        ? 'One thing waiting on InternetDJ'
                        : `${items.length} things waiting on InternetDJ`,
                    html: buildHtml(name, items, items.length),
                });
                sent += 1;
            } catch (err) {
                // One bad address must not end the run for everyone after it.
                warnOut(`  failed for ${email}: ${err.message}`);
                failed += 1;
            }
        }

        out('');
        out(`${sent} digest(s) ${DRY_RUN ? 'would be sent' : 'sent'}, ${failed} failed.`);
    } catch (err) {
        errOut(`Weekly digest failed: ${err.message}`);
        errOut(err.stack);
        await finish(1);
        return;
    }

    await finish(0);
})();
