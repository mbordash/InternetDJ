const trimTrailingSlash = (value = '') => value.replace(/\/+$/, '');
const trimLeadingSlash = (value = '') => value.replace(/^\/+/, '');

const getPublicBucketBaseUrl = () => {
    if (process.env.PUBLIC_BUCKET_URL) {
        return trimTrailingSlash(process.env.PUBLIC_BUCKET_URL);
    }

    if (!process.env.AWS_ENDPOINT_URL_S3 || !process.env.BUCKET_NAME) {
        return null;
    }

    try {
        const endpoint = new URL(process.env.AWS_ENDPOINT_URL_S3);
        return `${endpoint.protocol}//${process.env.BUCKET_NAME}.${endpoint.host}`;
    } catch (err) {
        return null;
    }
};

const buildPublicFileUrl = (objectKey) => {
    const baseUrl = getPublicBucketBaseUrl();
    if (!baseUrl) {
        throw new Error('Missing PUBLIC_BUCKET_URL or AWS_ENDPOINT_URL_S3/BUCKET_NAME configuration');
    }

    return `${baseUrl}/${trimLeadingSlash(objectKey)}`;
};

const extractObjectKey = (fileUrl) => {
    if (!fileUrl) {
        return null;
    }

    try {
        const parsed = new URL(fileUrl);
        return trimLeadingSlash(parsed.pathname);
    } catch (err) {
        return trimLeadingSlash(fileUrl);
    }
};

const isPublicBucketUrl = (fileUrl) => {
    const baseUrl = getPublicBucketBaseUrl();
    if (!baseUrl || !fileUrl) {
        return false;
    }

    return fileUrl.startsWith(`${baseUrl}/`);
};

module.exports = {
    buildPublicFileUrl,
    extractObjectKey,
    getPublicBucketBaseUrl,
    isPublicBucketUrl,
};

