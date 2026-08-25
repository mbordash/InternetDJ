const pool = require('../config/database');

/**
 * Output helpers for the scripts in backend/scripts/.
 *
 * These write straight to stdout rather than through utils/logger, because a
 * maintenance script is talking to a person watching a terminal, not filling
 * an app log. Routing them through the logger makes their output hostage to
 * LOG_LEVEL, which is exactly the wrong behaviour for a command you just typed.
 */
const out = (...args) => console.log(...args);
const warnOut = (...args) => console.warn(...args);
const errOut = (...args) => console.error(...args);

/**
 * End a script without losing its output.
 *
 * process.exit() discards whatever is still buffered on stdout when stdout is
 * a pipe rather than a terminal - which is exactly what it is over
 * `fly ssh console`. So instead of exiting, close the things holding the event
 * loop open and let node exit on its own, which flushes properly on the way
 * out. `closers` are extra teardown functions (a queue, a redis connection).
 */
async function finish(code = 0, closers = []) {
    process.exitCode = code;
    for (const close of closers) {
        try {
            await close();
        } catch (err) {
            errOut(`Warning: failed to close a resource cleanly: ${err.message}`);
        }
    }
    try {
        await pool.end();
    } catch (err) {
        errOut(`Warning: failed to close the database pool: ${err.message}`);
    }
}

/** Right-pad for simple aligned tables. */
const pad = (value, width) => String(value).padEnd(width);

module.exports = { out, warnOut, errOut, finish, pad };
