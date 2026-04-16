let runningJobs = 0;

module.exports = {
    getRunningJobs: () => runningJobs,
    incrementRunningJobs: () => runningJobs++,
    decrementRunningJobs: () => runningJobs--,
};