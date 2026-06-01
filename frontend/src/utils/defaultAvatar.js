import studioRackImage1 from '../assets/studio-rack-image-1.jpg';
import studioRackImage2 from '../assets/studio-rack-image-2.jpg';
import studioRackImage3 from '../assets/studio-rack-image-3.jpg';
import studioRackImage4 from '../assets/studio-rack-image-4.jpg';

const ELECTRONIC_AVATARS = [
    studioRackImage1,
    studioRackImage2,
    studioRackImage3,
    studioRackImage4,
];

const toSeedString = (seed) => {
    if (seed === null || seed === undefined) return 'internetdj-default';
    return String(seed);
};

const hashString = (value) => {
    let hash = 0;
    for (let i = 0; i < value.length; i += 1) {
        hash = (hash << 5) - hash + value.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash);
};

export const getDefaultAvatar = (seed) => {
    const index = hashString(toSeedString(seed)) % ELECTRONIC_AVATARS.length;
    return ELECTRONIC_AVATARS[index];
};

