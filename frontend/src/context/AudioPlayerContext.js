import React, { createContext, useState, useRef, useEffect } from 'react';
import { toPlayableUrl } from '../utils/playableUrl';

export const AudioPlayerContext = createContext();

// All playback goes through the backend audio proxy so the shared element
// stays CORS-clean, which the Web Audio EQ graph needs to output sound at all.
// Moved to utils/playableUrl.js so the multitrack sampler can use it too;
// re-exported here because several components already import it from this file.
export { toPlayableUrl };

const createSharedAudio = () => {
    const audio = new Audio();
    audio.crossOrigin = 'anonymous';
    return audio;
};

export const AudioPlayerProvider = ({ children }) => {
    const [currentSong, setCurrentSong] = useState(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [songQueue, setSongQueue] = useState([]); // New: Queue for playlist songs
    const [currentQueueIndex, setCurrentQueueIndex] = useState(-1); // New: Track current song in queue
    const audioRef = useRef(null);
    if (!audioRef.current) {
        audioRef.current = createSharedAudio();
    }
    // Lazily-created, permanent Web Audio graph for the shared element.
    // createMediaElementSource() can only ever be called once per element,
    // so the graph must live here and never be closed.
    const audioGraphRef = useRef(null);

    const getAudioGraph = () => {
        if (!audioGraphRef.current) {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            const ctx = new Ctx();
            const source = ctx.createMediaElementSource(audioRef.current);
            source.connect(ctx.destination);
            audioGraphRef.current = { ctx, source };
        }
        if (audioGraphRef.current.ctx.state === 'suspended') {
            audioGraphRef.current.ctx.resume().catch(() => {});
        }
        return audioGraphRef.current;
    };

    const hasAudioGraph = () => !!audioGraphRef.current;

    useEffect(() => {
        const audio = audioRef.current;

        const handlePlay = () => setIsPlaying(true);
        const handlePause = () => setIsPlaying(false);
        const handleEnded = () => {
            // Play next song in queue if available
            if (currentQueueIndex < songQueue.length - 1) {
                nextSong();
            } else {
                setIsPlaying(false);
                setCurrentSong(null);
                setSongQueue([]);
                setCurrentQueueIndex(-1);
            }
        };

        audio.addEventListener('play', handlePlay);
        audio.addEventListener('pause', handlePause);
        audio.addEventListener('ended', handleEnded);

        return () => {
            audio.removeEventListener('play', handlePlay);
            audio.removeEventListener('pause', handlePause);
            audio.removeEventListener('ended', handleEnded);
        };
    }, [currentQueueIndex, songQueue]);

    const playSong = (song) => {
        if (currentSong?.id === song.id && isPlaying) {
            return;
        }

        const audio = audioRef.current;
        if (currentSong?.id !== song.id) {
            audio.src = toPlayableUrl(song.mp3_url);
            setCurrentSong(song);
            setSongQueue([song]); // Reset queue to single song
            setCurrentQueueIndex(0);
        }
        audio.play().then(() => {
            setIsPlaying(true);
        }).catch((error) => {
            console.error('[ERROR] Error playing audio:', error);
        });
    };

    // Register a song's metadata on the global player without touching the
    // audio element. Used by the Song page, which manages the element itself
    // via its WaveSurfer instance.
    const registerSong = (song) => {
        setCurrentSong(song);
        setSongQueue([song]);
        setCurrentQueueIndex(0);
    };

    const playPlaylist = (songs) => {
        if (!songs || songs.length === 0) {
            console.log('[DEBUG] No songs provided to playPlaylist');
            return;
        }

        const audio = audioRef.current;
        const firstSong = songs[0];
        audio.src = toPlayableUrl(firstSong.mp3_url);
        setCurrentSong(firstSong);
        setSongQueue(songs);
        setCurrentQueueIndex(0);
        audio.play().then(() => {
            setIsPlaying(true);
        }).catch((error) => {
            console.error('[ERROR] Error playing playlist:', error);
        });
    };

    const nextSong = () => {
        if (currentQueueIndex < songQueue.length - 1) {
            const nextIndex = currentQueueIndex + 1;
            const nextSong = songQueue[nextIndex];
            const audio = audioRef.current;
            audio.src = toPlayableUrl(nextSong.mp3_url);
            setCurrentSong(nextSong);
            setCurrentQueueIndex(nextIndex);
            audio.play().then(() => {
                setIsPlaying(true);
            }).catch((error) => {
                console.error('[ERROR] Error playing next song:', error);
            });
        } else {
            stopPlayback();
        }
    };

    const prevSong = () => {
        if (currentQueueIndex > 0) {
            const prevIndex = currentQueueIndex - 1;
            const prevSong = songQueue[prevIndex];
            const audio = audioRef.current;
            audio.src = toPlayableUrl(prevSong.mp3_url);
            setCurrentSong(prevSong);
            setCurrentQueueIndex(prevIndex);
            audio.play().then(() => {
                setIsPlaying(true);
            }).catch((error) => {
                console.error('[ERROR] Error playing previous song:', error);
            });
        }
    };

    const togglePlayPause = () => {
        const audio = audioRef.current;
        if (isPlaying) {
            audio.pause();
            setIsPlaying(false);
        } else {
            audio.play().then(() => {
                setIsPlaying(true);
            }).catch((error) => {
                console.error('[ERROR] Error playing audio:', error);
            });
        }
    };

    const stopPlayback = () => {
        const audio = audioRef.current;
        audio.pause();
        audio.currentTime = 0;
        setIsPlaying(false);
        setCurrentSong(null);
        setSongQueue([]);
        setCurrentQueueIndex(-1);
    };

    const pausePlayback = () => {
        const audio = audioRef.current;
        if (isPlaying) {
            audio.pause();
            setIsPlaying(false);
        }
    };

    return (
        <AudioPlayerContext.Provider
            value={{
                currentSong,
                isPlaying,
                playSong,
                registerSong,
                playPlaylist, // New
                nextSong, // New
                prevSong, // New
                togglePlayPause,
                stopPlayback,
                pausePlayback,
                audioRef,
                getAudioGraph,
                hasAudioGraph,
                songQueue, // Expose for UI if needed
                currentQueueIndex,
            }}
        >
            {children}
        </AudioPlayerContext.Provider>
    );
};