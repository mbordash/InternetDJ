const SITE_URL = (
    process.env.REACT_APP_SITE_URL ||
    (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000')
).replace(/\/+$/, '');

export default SITE_URL;

