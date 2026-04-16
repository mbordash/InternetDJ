import React, { createContext, useState, useRef, useEffect } from 'react';

export const AudioPlayerContext = createContext();

export const AudioPlayerProvider = ({ children }) => {
    const [currentSong, setCurrentSong] = useState(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [songQueue, setSongQueue] = useState([]); // New: Queue for playlist songs
    const [currentQueueIndex, setCurrentQueueIndex] = useState(-1); // New: Track current song in queue
    const audioRef = useRef(new Audio());

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
            audio.src = song.mp3_url;
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

    const playPlaylist = (songs) => {
        if (!songs || songs.length === 0) {
            console.log('[DEBUG] No songs provided to playPlaylist');
            return;
        }

        const audio = audioRef.current;
        const firstSong = songs[0];
        audio.src = firstSong.mp3_url;
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
            audio.src = nextSong.mp3_url;
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
            audio.src = prevSong.mp3_url;
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
                playPlaylist, // New
                nextSong, // New
                prevSong, // New
                togglePlayPause,
                stopPlayback,
                pausePlayback,
                audioRef,
                songQueue, // Expose for UI if needed
                currentQueueIndex,
            }}
        >
            {children}
        </AudioPlayerContext.Provider>
    );
};