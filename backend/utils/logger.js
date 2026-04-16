const levels = { error: 0, warn: 1, info: 2, debug: 3 };
const current = process.env.LOG_LEVEL ?? "info";
const currentNum = levels[current] ?? levels.info;

function enabled(level) {
    return (levels[level] ?? 999) <= currentNum;
}

module.exports = {
    error: (...args) => console.error(...args),
    warn: (...args) => enabled("warn") && console.warn(...args),
    info: (...args) => enabled("info") && console.log(...args),
    debug: (...args) => enabled("debug") && console.log(...args),
};