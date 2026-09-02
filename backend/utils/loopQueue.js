/**
 * The AI loop generation queue. Thin next to the other two because the loops
 * table already carries everything the page needs to show, and the route does
 * its own validation before anything is queued.
 */
const { addJob } = require('./jobQueue');

const LOOP_QUEUE_NAME = 'loop-gen';

// Generation is a Replicate call polled every five seconds plus a download and
// an ffmpeg trim, so a slow one runs into minutes. The worker heartbeats while
// it waits; this is only the window after a crash before the job is retried.
const LEASE_MS = 20 * 60 * 1000;

async function enqueueLoopGeneration({ loopId, fullPrompt, duration }) {
    return addJob(LOOP_QUEUE_NAME, { loopId, fullPrompt, duration });
}

module.exports = { enqueueLoopGeneration, LOOP_QUEUE_NAME, LEASE_MS };
