import { useEffect, useRef, useState, useContext } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import WaveSurfer from 'wavesurfer.js';
import Hover from 'wavesurfer.js/dist/plugins/hover.esm.js';
import { PlayIcon, PauseIcon, AdjustmentsVerticalIcon, XMarkIcon, ArrowPathIcon } from '@heroicons/react/24/solid';
import { AuthContext } from '../context/AuthContext';
import { AudioPlayerContext, toPlayableUrl } from '../context/AudioPlayerContext';
import { CancelToken } from 'axios';
import API_URL from '../utils/api';

const eqBands = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

/** Every band flat, which is both the starting point and what Reset returns to. */
const flatEqGains = () => eqBands.reduce((acc, band) => ({ ...acc, [band]: 0 }), {});

/**
 * Saved settings come out of a JSON column, so they can arrive as a string,
 * with the gains themselves as strings, or missing a band that was added since
 * they were saved. Everything downstream — the slider, the readout, the filter
 * — wants a plain number for every band, so settle that once here.
 */
const normalizeEqGains = (stored) => {
  let parsed = stored;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch (err) {
      console.warn('Stored EQ settings are not valid JSON:', stored);
      return flatEqGains();
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return flatEqGains();

  return eqBands.reduce((acc, band) => {
    const gain = Number(parsed[band]);
    return { ...acc, [band]: Number.isFinite(gain) ? gain : 0 };
  }, {});
};

function AudioPlayer({ songId, s3Url, isOwner = false }) {
  const waveformRef = useRef(null);
  const wavesurferRef = useRef(null);
  const modalRef = useRef(null);
  const dragRef = useRef(null);
  const isMountedRef = useRef(true);
  const fetchCancelTokenRef = useRef(null);
  const initializationCountRef = useRef(0);
  const loadUrlRef = useRef('');
  const mediaListenersRef = useRef([]);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isRepeating, setIsRepeating] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [peaks, setPeaks] = useState(null);
  const [showEQ, setShowEQ] = useState(false);
  const [filtersInitialized, setFiltersInitialized] = useState(false);
  const [eqLoading, setEqLoading] = useState(false);
  const [error, setError] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [eqSaved, setEqSaved] = useState(false);
  const eqSettingsLoadedRef = useRef(false);

  const [eqGains, setEqGains] = useState(flatEqGains);
  const filtersRef = useRef({});

  const [modalPosition, setModalPosition] = useState({ top: 150, left: 300 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  const { user } = useContext(AuthContext);
  const { audioRef, registerSong, getAudioGraph, hasAudioGraph, currentSong } = useContext(AudioPlayerContext);

  // This page only takes over the app-wide player when the member actually
  // presses play here. Until then the waveform runs on its own private audio
  // element, so opening a song page leaves whatever is in the footer playing.
  // Arriving at the page of the track that is already playing is the one case
  // that starts out active, so the waveform tracks live playback.
  const [isActive, setIsActive] = useState(
      () => currentSong?.id === Number(songId) && !audioRef.current.paused
  );
  const isActiveRef = useRef(isActive);
  isActiveRef.current = isActive;
  const playOnReadyRef = useRef(false);
  const resumeAtRef = useRef(0);
  const songDetailsRef = useRef(null);
  const isAuthenticated = !!user;
  const canPersistPeaks = true;

  const formatTime = (seconds) => {
    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${minutes}:${secs < 10 ? '0' : ''}${secs}`;
  };

  useEffect(() => {
    const fetchSongDetails = async () => {
      if (!songId) {
        console.warn('No songId provided for fetching details');
        return;
      }

      try {
        const token = localStorage.getItem('token');
        const response = await axios.get(`${API_URL}/music/${songId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        console.log('Fetched song details:', response.data);
        const songData = response.data?.song || response.data;
        // Held until this page takes over playback. Registering here instead
        // would put this song in the footer while a different one is still
        // playing through it.
        songDetailsRef.current = {
          id: Number(songId),
          title: songData?.title || 'Untitled Song',
          mp3_url: songData?.mp3_url || s3Url,
          image_url: songData?.image_url || null,
          profile_id: songData?.profile_id || null,
          profile_name: songData?.profile_name || null,
        };
        // If this page is already the one driving playback, the footer is
        // showing a placeholder until these details land.
        if (isActiveRef.current) {
          registerSong(songDetailsRef.current);
        }
      } catch (err) {
        console.error('Error fetching song details:', {
          message: err.message,
          response: err.response?.data,
          status: err.response?.status,
        });
      }
    };
    fetchSongDetails();
  }, [songId]);

  const savePeaks = async (peaksArray) => {
    if (!canPersistPeaks || !isMountedRef.current) return;
    const token = localStorage.getItem('token');
    try {
      const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
      await axios.post(
          `${API_URL}/music/peaks/${songId}`,
          { peaks: JSON.stringify(peaksArray) },
          headers ? { headers } : undefined
      );
      console.log('Peaks saved successfully for songId:', songId);
    } catch (err) {
      console.error('Error saving peaks:', {
        message: err.message,
        response: err.response?.data,
        status: err.response?.status,
      });
    }
  };

  const saveEQSettings = async () => {
    if (!isAuthenticated || !isMountedRef.current) return;
    const token = localStorage.getItem('token');
    if (!token) return;

    setIsSaving(true);
    setSaveError(null);

    if (!eqGains || typeof eqGains !== 'object' || Array.isArray(eqGains)) {
      console.error('Invalid eqGains in saveEQSettings:', eqGains);
      setSaveError('Invalid EQ settings');
      setIsSaving(false);
      return;
    }

    try {
      console.log('Sending eqGains:', eqGains);
      await axios.post(
          `${API_URL}/eq/settings`,
          { eqGains },
          { headers: { Authorization: `Bearer ${token}` } }
      );
      console.log('EQ settings saved successfully');
      setEqSaved(true);
    } catch (err) {
      console.error('Error saving EQ settings:', {
        message: err.message,
        response: err.response?.data,
        status: err.response?.status,
      });
      setSaveError(err.response?.data?.error || 'Failed to save EQ settings');
    } finally {
      setIsSaving(false);
    }
  };

  const fetchEQSettings = async () => {
    if (!isAuthenticated || !isMountedRef.current) return;
    const token = localStorage.getItem('token');
    if (!token) return;

    try {
      const response = await axios.get(`${API_URL}/eq/settings`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      console.log('Fetched EQ settings:', response.data);
      if (response.data.eqGains) {
        setEqGains(normalizeEqGains(response.data.eqGains));
      } else {
        console.log('No EQ settings found for user');
        setEqGains(flatEqGains());
      }
    } catch (err) {
      console.error('Error fetching EQ settings:', {
        message: err.message,
        response: err.response?.data,
        status: err.response?.status,
      });
      setSaveError(err.response?.data?.error || 'Failed to load EQ settings');
    }
  };

  // The sliders are just numbers until there is an audio chain to put them
  // through, so nothing here touches the filters directly: the gains are state,
  // and this effect is the one place that pushes them at whatever filters
  // currently exist. That is what lets a member set the EQ up before pressing
  // play — the chain is built with these values when it appears (see
  // initializeEQFilters), and re-synced here the moment it does.
  useEffect(() => {
    Object.entries(eqGains).forEach(([band, gain]) => {
      const filter = filtersRef.current[band];
      if (filter) {
        filter.gain.value = Number(gain) || 0;
      }
    });
  }, [eqGains, filtersInitialized]);

  // Moving a slider makes whatever is stored no longer what you are hearing,
  // so the saved confirmation stops applying. Keyed on the gains alone: the
  // chain appearing later does not change what is stored.
  useEffect(() => {
    setEqSaved(false);
  }, [eqGains]);

  const updateEQGain = (band, value) => {
    setEqGains((prev) => ({ ...prev, [band]: parseFloat(value) }));
  };

  const resetEQ = () => {
    setEqGains(flatEqGains());
  };

  const initializeEQFilters = () => {
    if (!wavesurferRef.current) return false;
    if (filtersInitialized) {
      console.log('EQ filters already initialized, skipping');
      return true;
    }

    try {
      const { ctx, source } = getAudioGraph();

      filtersRef.current = {};
      eqBands.forEach((freq) => {
        const filter = ctx.createBiquadFilter();
        filter.type = freq <= 32 ? 'lowshelf' : freq >= 16000 ? 'highshelf' : 'peaking';
        filter.frequency.value = freq;
        filter.Q.value = 1;
        filter.gain.value = eqGains[freq] || 0;
        filtersRef.current[freq] = filter;
      });

      source.disconnect();
      const equalizer = Object.values(filtersRef.current).reduce((prev, curr) => {
        prev.connect(curr);
        return curr;
      }, source);

      equalizer.connect(ctx.destination);
      setFiltersInitialized(true);
      setEqLoading(false);
      console.log('EQ filters initialized successfully');
      return true;
    } catch (err) {
      console.error('Error initializing EQ filters:', err);
      setEqLoading(false);
      return false;
    }
  };

  // Detach the EQ chain and restore direct output on the persistent graph
  const bypassEQFilters = () => {
    if (!hasAudioGraph()) return;
    // Nothing of ours is in the chain, so leave it alone: an inactive page
    // unmounting must not reach into the graph of the track still playing.
    if (Object.keys(filtersRef.current).length === 0) return;
    try {
      const { ctx, source } = getAudioGraph();
      Object.values(filtersRef.current).forEach((filter) => {
        try { filter.disconnect(); } catch (e) { /* noop */ }
      });
      filtersRef.current = {};
      source.disconnect();
      source.connect(ctx.destination);
    } catch (err) {
      console.error('Error bypassing EQ filters:', err);
    }
  };

  const retryAudioLoad = async (attempts = 3, delay = 1000) => {
    if (!isMountedRef.current) return false;
    const retryUrl = loadUrlRef.current || toPlayableUrl(s3Url);
    for (let i = 0; i < attempts; i++) {
      try {
        wavesurferRef.current.load(retryUrl);
        return true;
      } catch (err) {
        console.error(`Audio load attempt ${i + 1} failed:`, err);
        if (i < attempts - 1) {
          await new Promise((resolve) => setTimeout(resolve, delay * Math.pow(2, i)));
        }
      }
    }
    console.error('All audio load attempts failed');
    setIsLoading(false);
    setEqLoading(false);
    setError('Failed to load audio. Please check the URL or try again later.');
    return false;
  };

  const handleDragStart = (e) => {
    setIsDragging(true);
    setDragStart({
      x: e.clientX - modalPosition.left,
      y: e.clientY - modalPosition.top,
    });
  };

  const handleDragMove = (e) => {
    if (isDragging) {
      const newLeft = e.clientX - dragStart.x;
      const newTop = e.clientY - dragStart.y;
      const maxX = window.innerWidth - (modalRef.current?.offsetWidth || 0);
      const maxY = window.innerHeight - (modalRef.current?.offsetHeight || 0);
      setModalPosition({
        left: Math.max(0, Math.min(newLeft, maxX)),
        top: Math.max(0, Math.min(newTop, maxY)),
      });
    }
  };

  const handleDragEnd = () => {
    setIsDragging(false);
  };

  useEffect(() => {
    isMountedRef.current = true;
    initializationCountRef.current += 1;
    console.log(`[DEBUG] AudioPlayer useEffect triggered, init count: ${initializationCountRef.current}, songId: ${songId}, s3Url: ${s3Url}`);

    if (!s3Url) {
      setIsLoading(false);
      setError('No audio URL provided.');
      return;
    }

    const initWaveSurfer = async () => {
      console.log(`[DEBUG] initWaveSurfer called for songId: ${songId}`);

      // Cancel any ongoing fetchPeaks request
      if (fetchCancelTokenRef.current) {
        fetchCancelTokenRef.current.cancel('Canceled due to new songId or s3Url');
        fetchCancelTokenRef.current = null;
      }

      // Destroy existing WaveSurfer instance if it exists
      if (wavesurferRef.current) {
        console.log(`[DEBUG] Destroying WaveSurfer for songId: ${songId}`);
        try {
          wavesurferRef.current.destroy();
        } catch (err) {
          console.error('Error destroying WaveSurfer:', err);
        }
        wavesurferRef.current = null;
      }

      // Clear waveform container
      if (waveformRef.current) {
        console.log(`[DEBUG] Clearing waveform container for songId: ${songId}`);
        waveformRef.current.innerHTML = '';
      }

      // Reset state (do not touch the shared audio element — it may be playing)
      setFiltersInitialized(false);
      setPeaks(null);
      setIsLoading(true);
      setError(null);
      setCurrentTime(0);
      setDuration(0);
      setIsPlaying(false);

      // Store current songId and initialization time
      waveformRef.currentSongId = songId;
      waveformRef.currentS3Url = s3Url;
      waveformRef.currentInitTime = Date.now();

      // Fetch peaks with cancel token
      let storedPeaks = null;
      try {
        fetchCancelTokenRef.current = CancelToken.source();
        console.log(`[DEBUG] Fetching peaks for songId: ${songId}`);
        const response = await axios.get(`${API_URL}/music/peaks/${songId}`, {
          cancelToken: fetchCancelTokenRef.current.token,
        });
        if (response.data.peaks) {
          const parsedPeaks = JSON.parse(response.data.peaks);
          console.log(`[DEBUG] Peaks fetched successfully for songId: ${songId}, length: ${parsedPeaks.length}`);
          storedPeaks = parsedPeaks;
        } else {
          console.log(`[DEBUG] No peaks found for songId: ${songId}`);
        }
      } catch (err) {
        if (axios.isCancel(err)) {
          console.log(`[DEBUG] Peaks fetch canceled for songId: ${songId}`);
          return;
        }
        console.error('Error fetching peaks:', {
          message: err.message,
          response: err.response?.data,
          status: err.response?.status,
        });
      } finally {
        fetchCancelTokenRef.current = null;
      }

      if (!isMountedRef.current) return;

      const storedPeakChannels = Array.isArray(storedPeaks?.[0]) ? storedPeaks : storedPeaks ? [storedPeaks] : null;
      setPeaks(storedPeakChannels ? storedPeakChannels[0] : null);

      const proxyUrl = toPlayableUrl(s3Url);

      try {
        console.log(`[DEBUG] Validating audio URL for songId: ${songId}`);
        const response = await fetch(proxyUrl, {
          method: 'GET',
          headers: { Range: 'bytes=0-1023' },
        });
        if (!response.ok) {
          throw new Error(`Failed to load audio: ${response.status} ${response.statusText}`);
        }
        const contentType = response.headers.get('Content-Type');
        if (
            !contentType ||
            (!contentType.includes('audio') && contentType !== 'application/octet-stream') ||
            (contentType === 'application/octet-stream' && !s3Url.toLowerCase().endsWith('.mp3'))
        ) {
          throw new Error(`Invalid audio content type: ${contentType}`);
        }
        const blob = await response.blob();
        if (blob.size === 0) {
          throw new Error('Empty audio content');
        }
      } catch (err) {
        console.error('Error validating s3Url:', err);
        setIsLoading(false);
        setEqLoading(false);
        setError('Failed to validate audio file. Please check the URL.');
        return;
      }

      // The two awaits above each give React a chance to unmount this player
      // (navigating between song pages remounts it). Without this check the
      // dead instance still builds a WaveSurfer and points the shared element
      // at its own, now-stale, track.
      if (!isMountedRef.current) return;

      console.log(`[DEBUG] Creating new WaveSurfer instance for songId: ${songId}, active: ${isActive}`);
      // The element reports src as an absolute URL, so resolve ours the same
      // way before comparing (API_URL is relative in production).
      const absoluteUrl = new URL(proxyUrl, window.location.href).href;
      const sharedAudio = audioRef.current;
      // Active: drive the app-wide element, so playback carries on in the
      // footer when the member navigates away. Inactive: let WaveSurfer make
      // its own element, leaving whatever is in the footer untouched.
      let wasPlaying = false;
      if (isActive) {
        wasPlaying = !sharedAudio.paused && sharedAudio.src === absoluteUrl;
        if (sharedAudio.src !== absoluteUrl) {
          sharedAudio.pause();
          sharedAudio.src = absoluteUrl;
        }
        // Falls back to the little we know if the details fetch is still in
        // flight: taking over the element without registering the song would
        // leave the footer captioned with the previous track.
        registerSong(songDetailsRef.current || {
          id: Number(songId),
          title: 'Untitled Song',
          mp3_url: s3Url,
          image_url: null,
          profile_id: null,
          profile_name: null,
        });
      }
      loadUrlRef.current = isActive ? sharedAudio.src : proxyUrl;

      wavesurferRef.current = WaveSurfer.create({
        container: waveformRef.current,
        // WaveSurfer loads once from these on construction: an external
        // media element's own src, or `url` when it owns the element.
        ...(isActive ? { media: sharedAudio } : { url: proxyUrl }),
        ...(storedPeakChannels ? { peaks: storedPeakChannels } : {}),
        waveColor: '#2f7f96',
        progressColor: '#ff2f8e',
        cursorColor: '#00f0ff',
        barWidth: 2,
        barRadius: 0,
        barGap: 2,
        height: 125,
        responsive: true,
        normalize: true,
        plugins: [
          Hover.create({
            lineColor: 'rgba(239, 68, 68, 0.5)',
            lineWidth: 2,
            labelBackground: '#1f2937',
            labelColor: '#fff',
            labelSize: '12px',
            formatTimeCallback: formatTime,
          }),
        ],
      });

      // Reflect the element's actual state (the shared one may already be playing)
      setIsPlaying(isActive && !sharedAudio.paused);

      // Repeat is component state, so it has to be re-applied to whichever
      // element this instance ended up on.
      const activeMedia = wavesurferRef.current.getMediaElement();
      if (activeMedia) {
        activeMedia.loop = isRepeating;
      }

      wavesurferRef.current.on('ready', () => {
        if (!isMountedRef.current) return;
        console.log(`[DEBUG] WaveSurfer ready for songId: ${songId}`);
        setIsLoading(false);
        setDuration(wavesurferRef.current.getDuration());

        // The EQ graph is wired to the shared element, so it only means
        // anything once this page is the one driving it.
        if (isActive && !filtersInitialized) {
          initializeEQFilters();
        }

        // Loading always pauses the media element, so a page opened for the
        // track already playing has to pick it back up, and a take-over has
        // to start it from wherever the member had scrubbed to.
        if (playOnReadyRef.current || wasPlaying) {
          playOnReadyRef.current = false;
          if (resumeAtRef.current > 0) {
            wavesurferRef.current.setTime(resumeAtRef.current);
            resumeAtRef.current = 0;
          }
          wavesurferRef.current.play().catch((err) => {
            console.error('Error starting playback:', err);
          });
        }

        if (!storedPeaks && canPersistPeaks) {
          const peaksArray = wavesurferRef.current.exportPeaks()[0];
          console.log(`[DEBUG] Saving new peaks for songId: ${songId}`);
          savePeaks(peaksArray);
          setPeaks(peaksArray);
        } else if (!storedPeaks) {
          console.log(`[DEBUG] Skipping peaks save for songId: ${songId}`, {
            isOwner,
            isAuthenticated,
            canPersistPeaks,
            hasToken: !!localStorage.getItem('token'),
          });
        }
      });

      wavesurferRef.current.on('error', (err) => {
        if (!isMountedRef.current) return;
        console.error('WaveSurfer error:', err);
        retryAudioLoad();
      });

      wavesurferRef.current.on('audioprocess', () => {
        if (!isMountedRef.current) return;
        setCurrentTime(wavesurferRef.current.getCurrentTime());
      });

      wavesurferRef.current.on('play', () => {
        if (!isMountedRef.current) return;
        setIsPlaying(true);
        // Resume the shared Web Audio graph if EQ has been used
        if (hasAudioGraph()) {
          getAudioGraph();
        }
        const token = localStorage.getItem('token');
        axios
            .post(
                `${API_URL}/music/play/${songId}`,
                {},
                { headers: token ? { Authorization: `Bearer ${token}` } : {} }
            )
            .catch((err) => {
              if (err.response?.status !== 429) {
                console.error('Error tracking play:', {
                  message: err.message,
                  response: err.response?.data,
                  status: err.response?.status,
                });
              }
            });
      });

      wavesurferRef.current.on('pause', () => {
        if (!isMountedRef.current) return;
        setIsPlaying(false);
      });

      wavesurferRef.current.on('finish', () => {
        if (!isMountedRef.current) return;
        console.log('WaveSurfer finish event triggered, isRepeating:', isRepeating);
        if (isRepeating) {
          console.log('Attempting to restart playback');
          wavesurferRef.current.play().catch((err) => {
            console.error('Error restarting playback:', err);
          });
        } else {
          setIsPlaying(false);
        }
      });

      // Fallback: Listen to the HTML5 audio element's ended event
      const audioElement = wavesurferRef.current.getMediaElement();
      if (audioElement) {
        const handleEnded = () => {
          if (!isMountedRef.current) return;
          console.log('HTML5 audio ended event triggered, isRepeating:', isRepeating);
          if (isRepeating) {
            console.log('Restarting playback via HTML5 ended event');
            wavesurferRef.current.play().catch((err) => {
              console.error('Error restarting playback:', err);
            });
          } else {
            setIsPlaying(false);
          }
        };
        audioElement.addEventListener('ended', handleEnded);
        mediaListenersRef.current.push(() => audioElement.removeEventListener('ended', handleEnded));
      }

    };

    initWaveSurfer();

    return () => {
      console.log(`[DEBUG] Cleaning up useEffect for songId: ${songId}`);
      isMountedRef.current = false;
      // Cancel any ongoing fetchPeaks request
      if (fetchCancelTokenRef.current) {
        fetchCancelTokenRef.current.cancel('Canceled due to cleanup');
        fetchCancelTokenRef.current = null;
      }
      // Remove our listeners from the shared audio element
      mediaListenersRef.current.forEach((remove) => remove());
      mediaListenersRef.current = [];
      // Restore direct audio output; the EQ chain is page-specific
      bypassEQFilters();
      // Don't leave looping enabled on the shared element
      if (audioRef.current) {
        audioRef.current.loop = false;
      }
      if (wavesurferRef.current) {
        try {
          // When active the media element is the shared one, which WaveSurfer
          // treats as external and detaches from without pausing -- that is
          // what keeps the footer playing. When inactive it owns its private
          // element and tears it down properly.
          wavesurferRef.current.destroy();
        } catch (err) {
          console.error('Error destroying WaveSurfer:', err);
        }
        wavesurferRef.current = null;
      }
      if (waveformRef.current) {
        waveformRef.current.innerHTML = '';
        waveformRef.currentSongId = null;
        waveformRef.currentS3Url = null;
        waveformRef.currentInitTime = null;
      }
      setFiltersInitialized(false);
    };
  }, [songId, s3Url, isActive]);

  // Update the audio element's loop property when isRepeating changes
  useEffect(() => {
    if (wavesurferRef.current) {
      const audioElement = wavesurferRef.current.getMediaElement();
      if (audioElement) {
        audioElement.loop = isRepeating;
        console.log('Updated audio element loop property to:', isRepeating);
      }
    }
  }, [isRepeating]);

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleDragMove);
      document.addEventListener('mouseup', handleDragEnd);
    }
    return () => {
      document.removeEventListener('mousemove', handleDragMove);
      document.removeEventListener('mouseup', handleDragEnd);
    };
  }, [isDragging]);

  const toggleEQModal = () => {
    setShowEQ(!showEQ);
    // Once per mount: re-fetching on every open would quietly throw away
    // slider positions the member had set but not saved yet.
    if (!showEQ && isAuthenticated && !eqSettingsLoadedRef.current) {
      eqSettingsLoadedRef.current = true;
      fetchEQSettings();
    }
    if (isActive && !filtersInitialized && wavesurferRef.current) {
      setEqLoading(true);
      initializeEQFilters();
    }
  };

  const togglePlayPause = () => {
    // Pressing play here is the one thing that moves the app-wide player to
    // this song. Re-initializing against the shared element picks up from
    // wherever the member had scrubbed the preview to.
    if (!isActive) {
      resumeAtRef.current = wavesurferRef.current?.getCurrentTime() || 0;
      playOnReadyRef.current = true;
      setIsActive(true);
      return;
    }
    if (wavesurferRef.current) {
      wavesurferRef.current.playPause();
      if (!filtersInitialized) {
        setEqLoading(true);
        initializeEQFilters();
      }
    }
  };

  return (
      <div className="retro-panel retro-cut w-full p-4 relative text-gray-100">
        <style>
          {`
          .wavesurfer canvas {
            pointer-events: none;
          }
            input[type="range"][orient="vertical"] {
            writing-mode: vertical-lr;
            direction: rtl;
            width: 8px;
            height: 100px;
            background: #1f2937;
            border-radius: 5px;
            outline: none;
          }
          input[type="range"][orient="vertical"]::-webkit-slider-thumb {
            -webkit-appearance: none;
            width: 16px;
            height: 16px;
            background: #60a5fa;
            border-radius: 50%;
            cursor: pointer;
          }
          input[type="range"][orient="vertical"]::-moz-range-thumb {
            width: 16px;
            height: 16px;
            background: #60a5fa;
            border-radius: 50%;
            cursor: pointer;
          }
        `}
        </style>
        <div className="relative">
          <div ref={waveformRef} className="w-full relative z-0" />
          {isLoading && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/60 z-20 rounded-xl">
                <svg
                    className="animate-spin h-8 w-8 text-primary-brand-300"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                >
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8h8a8 8 0 01-16 0z" />
                </svg>
              </div>
          )}
        </div>
        {error && <div className="retro-mono text-lg text-fuchsia-400 mt-2">{error}</div>}
        <div className="flex items-center mt-4 space-x-4">
          <button
              onClick={togglePlayPause}
              className="retro-action p-2 z-10"
              disabled={isLoading || error}
          >
            {isPlaying ? <PauseIcon className="h-6 w-6" /> : <PlayIcon className="h-6 w-6" />}
          </button>
          <button
              onClick={() => setIsRepeating(!isRepeating)}
              className={`p-2 rounded-full focus:outline-none z-10 ${
                  isRepeating
                      ? 'bg-primary-brand-500 text-white hover:bg-primary-brand-700'
                      : 'bg-gray-800 text-white hover:bg-gray-700'
              }`}
              title={isRepeating ? 'Disable Repeat' : 'Enable Repeat'}
              disabled={isLoading || error}
          >
            <ArrowPathIcon className="h-6 w-6" />
          </button>
          <button
              onClick={toggleEQModal}
              className="retro-action p-2 z-10"
              title="Equalizer"
              disabled={isLoading || error}
          >
            <AdjustmentsVerticalIcon className="h-6 w-6" />
          </button>
          <div className="retro-mono text-xl text-cyan-300">
            {formatTime(currentTime)} / {formatTime(duration)}
          </div>
        </div>
        {showEQ && createPortal((
            /* Portalled to <body> because the player card above is .retro-cut,
               and clip-path both clips its descendants and opens a stacking
               context - so a position:fixed child is pinned inside the card and
               no z-index can lift it out. The layer class only decides ordering
               once it is out here. */
            <div
                ref={modalRef}
                className="retro-panel retro-cut fixed p-4 w-full max-w-[90vw] sm:max-w-[600px] retro-layer-tool text-gray-100"
                style={{
                  top: `${modalPosition.top}px`,
                  left: `${modalPosition.left}px`,
                }}
            >
              <div
                  ref={dragRef}
                  className="flex justify-between items-center mb-4 cursor-move"
                  onMouseDown={handleDragStart}
              >
                <h3 className="retro-display text-sm retro-glow-cyan">Equalizer</h3>
                <button
                    onClick={toggleEQModal}
                    className="p-1 text-gray-400 hover:text-white focus:outline-none"
                >
                  <XMarkIcon className="h-5 w-5" />
                </button>
              </div>
              {eqLoading && !filtersInitialized && (
                  <div className="flex justify-center mb-4">
                    <svg
                        className="animate-spin h-6 w-6 text-primary-brand-300"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                    >
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8h8a8 8 0 01-16 0z" />
                    </svg>
                  </div>
              )}
              {/* The sliders always work; what changes is whether there is
                  anything to hear yet. Say which of those it is instead of the
                  old "unable to initialize", which read as broken when the only
                  thing missing was playback. */}
              {!eqLoading && !filtersInitialized && (
                  <div className="retro-mono text-lg text-center mb-4 text-gray-300">
                    {isActive
                        ? 'The equalizer could not be set up for this track.'
                        : 'Set these however you like \u2014 they take effect when you hit play.'}
                  </div>
              )}
              <div className="flex justify-between space-x-2">
                {eqBands.map((band) => (
                    <div key={band} className="flex flex-col items-center">
                      <input
                          type="range"
                          orient="vertical"
                          min="-30"
                          max="30"
                          step="0.1"
                          value={Number(eqGains[band]) || 0}
                          onChange={(e) => updateEQGain(band, e.target.value)}
                          className="w-8 h-24"
                          aria-label={`${band} Hz gain`}
                      />
                      <span className="retro-mono text-base text-cyan-300 mt-2">{band} Hz</span>
                      <span className="retro-mono text-base text-gray-300">
                        {(Number(eqGains[band]) || 0).toFixed(1)} dB
                      </span>
                    </div>
                ))}
              </div>
              <div className="mt-4 flex justify-end space-x-2">
                <button
                    onClick={resetEQ}
                    className="retro-btn py-1 px-3 text-[0.6rem]"
                >
                  Reset EQ
                </button>
                <button
                    onClick={saveEQSettings}
                    className={`py-1 px-3 rounded-md focus:outline-none ${
                        isAuthenticated
                            ? 'bg-primary-brand-500 text-white hover:bg-primary-brand-700'
                            : 'bg-white/10 text-gray-500 cursor-not-allowed'
                    }`}
                    disabled={!isAuthenticated || isSaving}
                >
                  {isSaving ? 'Saving...' : 'Save EQ Settings'}
                </button>
              </div>
              {saveError && <div className="retro-mono text-lg text-fuchsia-400 mt-2">{saveError}</div>}
              {eqSaved && !saveError && (
                  <div className="retro-mono text-lg text-cyan-300 mt-2">Settings saved.</div>
              )}
            </div>
        ), document.body)}
      </div>
  );
}

export default AudioPlayer;