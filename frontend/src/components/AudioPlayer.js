import { useEffect, useRef, useState, useContext } from 'react';
import axios from 'axios';
import WaveSurfer from 'wavesurfer.js';
import Hover from 'wavesurfer.js/dist/plugins/hover.esm.js';
import { SparklesIcon, PlayIcon, PauseIcon, AdjustmentsVerticalIcon, XMarkIcon, ArrowPathIcon } from '@heroicons/react/24/solid';
import { AuthContext } from '../context/AuthContext';
import { CancelToken } from 'axios';
import API_URL from '../utils/api';

function AudioPlayer({ songId, s3Url, isOwner = false }) {
  const [showMasteringModal, setShowMasteringModal] = useState(false);
  const [masteringType, setMasteringType] = useState(null);
  const [masteredUrl, setMasteredUrl] = useState(null);
  const [isMastering, setIsMastering] = useState(false);
  const [masteringError, setMasteringError] = useState(null);
  const [songTitle, setSongTitle] = useState('');

  const [showSuccessNotification, setShowSuccessNotification] = useState(false);
  const [newSongId, setNewSongId] = useState(null);

  const waveformRef = useRef(null);
  const wavesurferRef = useRef(null);
  const modalRef = useRef(null);
  const dragRef = useRef(null);
  const audioContextRef = useRef(null);
  const mediaNodeRef = useRef(null);
  const isMountedRef = useRef(true);
  const fetchCancelTokenRef = useRef(null);
  const initializationCountRef = useRef(0);

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

  const eqBands = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
  const [eqGains, setEqGains] = useState(eqBands.reduce((acc, band) => ({ ...acc, [band]: 0 }), {}));
  const filtersRef = useRef({});

  const [modalPosition, setModalPosition] = useState({ top: 150, left: 300 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  const { user } = useContext(AuthContext);
  const isAuthenticated = !!user;

  const formatTime = (seconds) => {
    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${minutes}:${secs < 10 ? '0' : ''}${secs}`;
  };

  useEffect(() => {
    const fetchSongDetails = async () => {
      if (!songId) {
        console.warn('No songId provided for fetching details');
        setSongTitle('Unknown Song');
        return;
      }

      try {
        const token = localStorage.getItem('token');
        const response = await axios.get(`${API_URL}/music/${songId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        console.log('Fetched song details:', response.data);
        setSongTitle(response.data.title || 'Untitled Song');
      } catch (err) {
        console.error('Error fetching song details:', {
          message: err.message,
          response: err.response?.data,
          status: err.response?.status,
        });
        setSongTitle('Unknown Song');
      }
    };
    fetchSongDetails();
  }, [songId]);

  const fetchPeaks = async () => {
    if (!isMountedRef.current) return null;
    try {
      const response = await axios.get(`${API_URL}/music/peaks/${songId}`);
      if (response.data.peaks) {
        const parsedPeaks = JSON.parse(response.data.peaks);
        console.log('Peaks fetched successfully:', parsedPeaks);
        return parsedPeaks;
      }
      console.log('No peaks found for songId:', songId);
      return null;
    } catch (err) {
      console.error('Error fetching peaks:', {
        message: err.message,
        response: err.response?.data,
        status: err.response?.status,
      });
      return null;
    }
  };

  const savePeaks = async (peaksArray) => {
    if (!isOwner || !isAuthenticated || !isMountedRef.current) return;
    const token = localStorage.getItem('token');
    if (!token) return;
    try {
      await axios.post(
          `${API_URL}/music/peaks/${songId}`,
          { peaks: JSON.stringify(peaksArray) },
          { headers: { Authorization: `Bearer ${token}` } }
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

  const handleMastering = async (type) => {
    setIsMastering(true);
    setMasteringError(null);
    setMasteringType(type);

    try {
      const token = localStorage.getItem('token');
      const response = await axios.post(
          `${API_URL}/music/master/${songId}`,
          { masteringType: type },
          { headers: { Authorization: `Bearer ${token}` } }
      );

      setMasteredUrl(response.data.masteredUrl);
      setIsMastering(false);
    } catch (err) {
      console.error('Error mastering audio:', err);
      if (err.response?.status === 429) {
        setMasteringError('Too many mastering jobs running. Please try again later.');
      } else {
        setMasteringError('Failed to master audio. Please try again.');
      }
      setIsMastering(false);
    }
  };

  const handleSaveMastered = async () => {
    if (!masteredUrl) return;

    setIsSaving(true);
    setSaveError(null);

    try {
      const token = localStorage.getItem('token');
      const formData = new FormData();
      const title = songTitle || 'Auto Mastered Song';
      formData.append('title', `${title} (Auto Mastered)`);

      const proxyUrl = `${API_URL}/proxy/audio?url=${encodeURIComponent(masteredUrl)}`;
      const response = await fetch(proxyUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch mastered audio: ${response.statusText}`);
      }
      const blob = await response.blob();
      formData.append('mp3', blob, `mastered-${Date.now()}.mp3`);

      const uploadResponse = await axios.post(`${API_URL}/music/upload`, formData, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'multipart/form-data',
        },
      });

      const newSong = uploadResponse.data.song;
      console.log('New song uploaded:', newSong);
      setNewSongId(newSong.id);

      await new Promise(resolve => setTimeout(resolve, 3000));

      setShowSuccessNotification(true);
      setShowMasteringModal(false);
      setMasteredUrl(null);
      setMasteringType(null);

      setTimeout(() => {
        setShowSuccessNotification(false);
        setNewSongId(null);
      }, 5000);
    } catch (err) {
      console.error('Error saving mastered song:', err);
      setSaveError('Failed to save mastered song.');
    } finally {
      setIsSaving(false);
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
        setEqGains(response.data.eqGains);
        if (filtersInitialized) {
          Object.keys(response.data.eqGains).forEach((band) => {
            if (filtersRef.current[band]) {
              filtersRef.current[band].gain.value = parseFloat(response.data.eqGains[band]);
            }
          });
        }
      } else {
        console.log('No EQ settings found for user');
        setEqGains(eqBands.reduce((acc, band) => ({ ...acc, [band]: 0 }), {}));
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

  const updateEQGain = (band, value) => {
    setEqGains((prev) => ({ ...prev, [band]: parseFloat(value) }));
    if (filtersRef.current[band]) {
      filtersRef.current[band].gain.value = parseFloat(value);
    }
  };

  const resetEQ = () => {
    const resetGains = eqBands.reduce((acc, band) => ({ ...acc, [band]: 0 }), {});
    setEqGains(resetGains);
    Object.keys(filtersRef.current).forEach((band) => {
      if (filtersRef.current[band]) {
        filtersRef.current[band].gain.value = 0;
      }
    });
  };

  const initializeEQFilters = () => {
    if (!audioContextRef.current || !wavesurferRef.current) return false;
    if (filtersInitialized) {
      console.log('EQ filters already initialized, skipping');
      return true;
    }

    const audio = wavesurferRef.current.getMediaElement();
    if (!audio) {
      console.warn('Media element not available for EQ initialization');
      return false;
    }

    try {
      if (!mediaNodeRef.current) {
        mediaNodeRef.current = audioContextRef.current.createMediaElementSource(audio);
      }

      filtersRef.current = {};
      eqBands.forEach((freq) => {
        const filter = audioContextRef.current.createBiquadFilter();
        filter.type = freq <= 32 ? 'lowshelf' : freq >= 16000 ? 'highshelf' : 'peaking';
        filter.frequency.value = freq;
        filter.Q.value = 1;
        filter.gain.value = eqGains[freq] || 0;
        filtersRef.current[freq] = filter;
      });

      const equalizer = Object.values(filtersRef.current).reduce((prev, curr) => {
        prev.connect(curr);
        return curr;
      }, mediaNodeRef.current);

      equalizer.connect(audioContextRef.current.destination);
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

  const retryAudioLoad = async (attempts = 3, delay = 1000) => {
    if (!isMountedRef.current) return false;
    const proxyUrl = `${API_URL}/proxy/audio?url=${encodeURIComponent(s3Url)}`;
    for (let i = 0; i < attempts; i++) {
      try {
        wavesurferRef.current.load(proxyUrl);
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

    // Guard against duplicate or rapid initialization for same songId
    if (
        wavesurferRef.current &&
        waveformRef.currentSongId === songId &&
        Date.now() - (waveformRef.currentInitTime || 0) < 2000
    ) {
      console.log(`[DEBUG] Skipping duplicate initialization for songId: ${songId}, s3Url: ${s3Url}`);
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

      // Disconnect and close existing AudioContext if it exists
      if (audioContextRef.current) {
        console.log(`[DEBUG] Closing AudioContext for songId: ${songId}`);
        if (mediaNodeRef.current) {
          mediaNodeRef.current.disconnect();
          mediaNodeRef.current = null;
        }
        audioContextRef.current.close().catch((err) => console.error('Error closing AudioContext:', err));
        audioContextRef.current = null;
      }

      // Reset state
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

      setPeaks(storedPeaks);

      const proxyUrl = `${API_URL}/proxy/audio?url=${encodeURIComponent(s3Url)}`;

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

      console.log(`[DEBUG] Creating new WaveSurfer instance for songId: ${songId}`);
      wavesurferRef.current = WaveSurfer.create({
        container: waveformRef.current,
        waveColor: '#73cbf0',
        progressColor: '#008dcb',
        cursorColor: '#000',
        barWidth: 2,
        barRadius: 2,
        barGap: 2,
        height: 125,
        responsive: true,
        normalize: true,
        peaks: storedPeaks ? [storedPeaks] : undefined,
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

      wavesurferRef.current.on('ready', () => {
        if (!isMountedRef.current) return;
        console.log(`[DEBUG] WaveSurfer ready for songId: ${songId}`);
        setIsLoading(false);
        setDuration(wavesurferRef.current.getDuration());

        if (!filtersInitialized) {
          initializeEQFilters();
        }

        if (!storedPeaks && isOwner && isAuthenticated) {
          const peaksArray = wavesurferRef.current.exportPeaks()[0];
          console.log(`[DEBUG] Saving new peaks for songId: ${songId}`);
          savePeaks(peaksArray);
          setPeaks(peaksArray);
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
        if (!audioContextRef.current) {
          audioContextRef.current = new AudioContext();
          if (audioContextRef.current.state === 'suspended') {
            audioContextRef.current.resume().then(() => {
              console.log('Audio context resumed');
              if (!filtersInitialized) {
                initializeEQFilters();
              }
            });
          }
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
        audioElement.addEventListener('ended', () => {
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
        });
      }

      console.log(`[DEBUG] Loading audio for songId: ${songId}`);
      try {
        wavesurferRef.current.load(proxyUrl);
      } catch (err) {
        console.error('Error loading audio:', err);
        retryAudioLoad();
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
      if (wavesurferRef.current) {
        try {
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
      if (audioContextRef.current) {
        if (mediaNodeRef.current) {
          mediaNodeRef.current.disconnect();
          mediaNodeRef.current = null;
        }
        audioContextRef.current.close().catch((err) => console.error('Error closing AudioContext:', err));
        audioContextRef.current = null;
      }
      setFiltersInitialized(false);
    };
  }, [songId, s3Url, isOwner, isAuthenticated]);

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
    if (!showEQ && isAuthenticated) {
      fetchEQSettings();
    }
    if (!filtersInitialized && wavesurferRef.current) {
      setEqLoading(true);
      initializeEQFilters();
    }
  };

  const togglePlayPause = () => {
    if (wavesurferRef.current) {
      wavesurferRef.current.playPause();
      if (!filtersInitialized) {
        setEqLoading(true);
        initializeEQFilters();
      }
    }
  };

  return (
      <div className="w-full bg-[#0f0f0f] border border-white/10 p-4 rounded-xl shadow-sm relative text-gray-100">
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
        {error && <div className="text-red-600 text-sm mt-2">{error}</div>}
        <div className="flex items-center mt-4 space-x-4">
          <button
              onClick={togglePlayPause}
              className="p-2 bg-gray-800 text-white rounded-full hover:bg-gray-700 focus:outline-none z-10"
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
          {isOwner && (
              <button
                  onClick={() => {
                    if (wavesurferRef.current && isPlaying) {
                      wavesurferRef.current.pause();
                    }
                    setShowMasteringModal(true);
                  }}
                  className="p-2 bg-gray-800 text-white rounded-full hover:bg-gray-700 focus:outline-none z-10"
                  title="Auto Master"
                  disabled={isLoading || error || !isAuthenticated}
              >
                <SparklesIcon className="h-6 w-6" />
              </button>
          )}
          <button
              onClick={toggleEQModal}
              className="p-2 bg-gray-800 text-white rounded-full hover:bg-gray-700 focus:outline-none z-10"
              title="Equalizer"
              disabled={isLoading || error}
          >
            <AdjustmentsVerticalIcon className="h-6 w-6" />
          </button>
          <div className="text-sm text-gray-300">
            {formatTime(currentTime)} / {formatTime(duration)}
          </div>
        </div>
        {showMasteringModal && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
              <div className="bg-[#111827] border border-white/10 p-6 rounded-xl w-[400px] text-gray-100 shadow-2xl">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-semibold text-white">Auto Mastering</h3>
                  <button
                      onClick={() => {
                        setShowMasteringModal(false);
                        setMasteredUrl(null);
                        setMasteringType(null);
                        setMasteringError(null);
                      }}
                      className="p-1 text-gray-400 hover:text-white"
                  >
                    <XMarkIcon className="h-5 w-5" />
                  </button>
                </div>

                {!masteredUrl && (
                    <div className="space-y-4">
                      <p className="text-gray-300">Select mastering intensity:</p>
                      <div className="flex space-x-2">
                        {['light', 'middle', 'heavy'].map((type) => (
                            <button
                                key={type}
                                onClick={() => handleMastering(type)}
                                disabled={isMastering}
                                className={`flex-1 py-2 px-4 rounded-md ${
                                    isMastering
                                        ? 'bg-white/10 text-gray-500 cursor-not-allowed'
                                        : 'bg-primary-brand-500 text-white hover:bg-primary-brand-700'
                                }`}
                            >
                              {type.charAt(0).toUpperCase() + type.slice(1)}
                            </button>
                        ))}
                      </div>
                    </div>
                )}

                {isMastering && !masteredUrl && (
                    <div className="flex justify-center">
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

                {masteredUrl && (
                    <div className="space-y-4">
                      <p className="text-gray-300">Preview mastered track:</p>
                      <audio controls src={masteredUrl} className="w-full" />
                      <div className="flex space-x-2">
                        <button
                            onClick={handleSaveMastered}
                            disabled={isSaving}
                            className={`flex-1 py-2 px-4 rounded-md ${
                                isSaving
                                    ? 'bg-white/10 text-gray-500 cursor-not-allowed'
                                    : 'bg-primary-brand-500 text-white hover:bg-primary-brand-700'
                            }`}
                        >
                          {isSaving ? 'Saving...' : 'Save Mastered Track'}
                        </button>
                        <button
                            onClick={() => {
                              setMasteredUrl(null);
                              setMasteringType(null);
                            }}
                            className="flex-1 py-2 px-4 rounded-md bg-white/10 text-white hover:bg-white/15"
                        >
                          Try Another
                        </button>
                      </div>
                    </div>
                )}

                {masteringError && (
                    <div className="mt-2 text-red-600 text-sm">
                      {masteringError}
                      {masteringError.includes('Too many') && (
                          <button
                              onClick={() => handleMastering(masteringType)}
                              className="ml-2 text-primary-brand-300 underline hover:text-primary-brand-200"
                          >
                            Try Again
                          </button>
                      )}
                    </div>
                )}
                {saveError && <div className="mt-2 text-red-600 text-sm">{saveError}</div>}
              </div>
            </div>
        )}

        {showSuccessNotification && newSongId && (
            <div className="fixed top-4 right-4 bg-primary-brand-600 text-white p-4 rounded-md shadow-lg z-50 flex items-center space-x-2 border border-white/10">
              <span>Mastered track saved successfully!</span>
              <a
                  href={`/song/${newSongId}`}
                  className="underline hover:text-white"
              >
                View Track
              </a>
              <button
                  onClick={() => setShowSuccessNotification(false)}
                  className="text-white hover:text-gray-200"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
        )}

        {showEQ && (
            <div
                ref={modalRef}
                className="fixed bg-[#111827] p-4 rounded-xl shadow-md w-full max-w-[90vw] sm:max-w-[600px] z-50 border border-white/10 text-gray-100"
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
                <h3 className="text-lg font-semibold text-white">Equalizer</h3>
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
              {!eqLoading && !filtersInitialized && (
                  <div className="text-center mb-4 text-gray-300">
                    Unable to initialize equalizer. Please try playing the audio first.
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
                          value={eqGains[band]}
                          onChange={(e) => updateEQGain(band, e.target.value)}
                          className="w-8 h-24"
                          disabled={!filtersInitialized || eqLoading}
                      />
                      <span className="text-xs text-gray-300 mt-2">{band} Hz</span>
                      <span className="text-xs text-gray-300">{eqGains[band].toFixed(1)} dB</span>
                    </div>
                ))}
              </div>
              <div className="mt-4 flex justify-end space-x-2">
                <button
                    onClick={resetEQ}
                    className="py-1 px-3 bg-white/10 text-white rounded-md hover:bg-white/15 focus:outline-none"
                    disabled={!filtersInitialized || eqLoading}
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
                    disabled={!isAuthenticated || isSaving || eqLoading || !filtersInitialized}
                >
                  {isSaving ? 'Saving...' : 'Save EQ Settings'}
                </button>
              </div>
              {saveError && <div className="mt-2 text-red-600 text-sm">{saveError}</div>}
            </div>
        )}
      </div>
  );
}

export default AudioPlayer;