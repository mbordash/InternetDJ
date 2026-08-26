/**
 * Turns a timestamp into plain relative wording: "today", "3 days ago",
 * "5 months ago".
 *
 * Used where a list needs to be honest about how old its contents are. A page
 * called "new" that shows no dates at all cannot tell a visitor whether it has
 * changed since their last visit, which is worse than admitting a quiet month.
 */
const DAY_MS = 24 * 60 * 60 * 1000;

const relativeDate = (value) => {
    if (!value) {
        return '';
    }

    const then = new Date(value);
    if (Number.isNaN(then.getTime())) {
        return '';
    }

    const days = Math.floor((Date.now() - then.getTime()) / DAY_MS);

    if (days < 0) {
        return 'just now';
    }
    if (days === 0) {
        return 'today';
    }
    if (days === 1) {
        return 'yesterday';
    }
    if (days < 7) {
        return `${days} days ago`;
    }
    if (days < 30) {
        const weeks = Math.floor(days / 7);
        return weeks === 1 ? 'last week' : `${weeks} weeks ago`;
    }
    if (days < 365) {
        const months = Math.floor(days / 30);
        return months === 1 ? 'last month' : `${months} months ago`;
    }

    const years = Math.floor(days / 365);
    return years === 1 ? 'last year' : `${years} years ago`;
};

export default relativeDate;
