import React, { useEffect, useState, useContext, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { AuthContext } from '../context/AuthContext';
import { XMarkIcon, TrashIcon, EnvelopeIcon } from '@heroicons/react/24/solid';
import API_URL from '../utils/api';

const ConfirmDeleteModal = ({ isOpen, onClose, onConfirm, title, message }) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-[#111827] border border-white/10 p-6 rounded-xl shadow-xl max-w-md w-full text-gray-100">
                <h3 className="text-lg font-bold mb-4 text-white">{title}</h3>
                <p className="text-gray-300 mb-6">{message}</p>
                <div className="flex justify-end space-x-4">
                    <button
                        onClick={onClose}
                        className="py-2 px-4 bg-white/10 text-white font-semibold rounded-md hover:bg-white/15"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={onConfirm}
                        className="py-2 px-4 bg-red-600 text-white font-semibold rounded-md hover:bg-red-700"
                    >
                        Delete
                    </button>
                </div>
            </div>
        </div>
    );
};

const ConfirmInviteModal = ({ isOpen, onClose, onConfirm, invite }) => {
    if (!isOpen || !invite) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-[#111827] border border-white/10 p-6 rounded-xl shadow-xl max-w-md w-full text-gray-100">
                <h3 className="text-lg font-bold mb-4 text-white">Collaboration Invite</h3>
                <p className="text-gray-300 mb-6">
                    You’ve been invited to join <strong>{invite.collaboration_title}</strong>.
                    {invite.can_upload && ' You will have upload permissions.'}
                    <br />
                    Do you want to accept this invite?
                </p>
                <div className="flex justify-end space-x-4">
                    <button
                        onClick={onClose}
                        className="py-2 px-4 bg-white/10 text-white font-semibold rounded-md hover:bg-white/15"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={() => onConfirm()}
                        className="py-2 px-4 bg-green-600 text-white font-semibold rounded-md hover:bg-green-700"
                    >
                        Accept
                    </button>
                </div>
            </div>
        </div>
    );
};

const RecordModal = ({ isOpen, onClose, tracks, onStartRecording, onStopRecording, isRecording }) => {
    const [selectedTrack, setSelectedTrack] = useState(null);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-[#111827] border border-white/10 p-6 rounded-xl shadow-xl max-w-md w-full text-gray-100">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-bold text-white">Record Vocal Track</h3>
                    <button onClick={onClose} className="text-primary-brand-300 hover:text-primary-brand-200">
                        <XMarkIcon className="w-6 h-6" />
                    </button>
                </div>
                <p className="text-sm text-gray-300 mb-4">
                    Select a track to play in the background, ensure your microphone is enabled, then click "Start Recording" to begin. Click "Stop Recording" to save your vocal track, which will be uploaded to the collaboration.
                </p>
                <div className="mb-4">
                    <label className="block text-sm font-medium mb-2 text-gray-200">Select Track for Playback</label>
                    <select
                        onChange={(e) => setSelectedTrack(tracks.find(t => t.id === Number(e.target.value)))}
                        className="w-full px-3 py-2 border border-white/10 rounded-md bg-white/5 text-white"
                        disabled={isRecording}
                    >
                        <option value="">Select a track</option>
                        {tracks.map(track => (
                            <option key={track.id} value={track.id}>{track.title}</option>
                        ))}
                    </select>
                </div>
                <div className="flex justify-end space-x-4">
                    <button
                        onClick={onClose}
                        className="py-2 px-4 bg-white/10 text-white font-semibold rounded-md hover:bg-white/15"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={isRecording ? onStopRecording : () => onStartRecording(selectedTrack)}
                        disabled={!selectedTrack}
                        className={`py-2 px-4 font-semibold rounded-md ${
                            isRecording
                                ? 'bg-red-600 text-white hover:bg-red-700'
                                : 'bg-green-600 text-white hover:bg-green-700'
                        } ${!selectedTrack ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                        {isRecording ? 'Stop Recording' : 'Start Recording'}
                    </button>
                </div>
            </div>
        </div>
    );
};

const CollaborationsManager = () => {
    const { profileId } = useParams();
    const { user, setUser, loading: authLoading } = useContext(AuthContext);
    const navigate = useNavigate();
    const [collaborations, setCollaborations] = useState([]);
    const [pendingInvites, setPendingInvites] = useState([]);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(true);
    const [showCreateForm, setShowCreateForm] = useState(false);
    const [createForm, setCreateForm] = useState({
        title: '',
        description: '',
        is_public: false,
        allow_uploads: false,
    });
    const [selectedCollaboration, setSelectedCollaboration] = useState(null);
    const [showTrackForm, setShowTrackForm] = useState(false);
    const [trackForm, setTrackForm] = useState({
        title: '',
        mp3: null,
        is_master: false,
    });
    const [showInviteForm, setShowInviteForm] = useState(false);
    const [inviteForm, setInviteForm] = useState({
        email: '',
        can_upload: false,
    });
    const [showEditForm, setShowEditForm] = useState(false);
    const [editForm, setEditForm] = useState({
        title: '',
        description: '',
        is_public: false,
        allow_uploads: false,
    });
    const [invitees, setInvitees] = useState([]);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [confirmAction, setConfirmAction] = useState(null);
    const [confirmTitle, setConfirmTitle] = useState('');
    const [confirmMessage, setConfirmMessage] = useState('');
    const [showInviteModal, setShowInviteModal] = useState(false);
    const [selectedInvite, setSelectedInvite] = useState(null);
    const [isRecording, setIsRecording] = useState(false);
    const [mediaRecorder, setMediaRecorder] = useState(null);
    const [recordedChunks, setRecordedChunks] = useState([]);
    const [audioContext, setAudioContext] = useState(null);
    const [sourceNode, setSourceNode] = useState(null);
    const [selectedTrackForPlayback, setSelectedTrackForPlayback] = useState(null);
    const [showRecordModal, setShowRecordModal] = useState(false);
    const mp3InputRef = useRef(null);
    const uploadLockRef = useRef(false); // Prevent multiple uploads
    const [showDeleteTrackModal, setShowDeleteTrackModal] = useState(false);
    const [trackToDelete, setTrackToDelete] = useState(null);
    const [playingTrackPair, setPlayingTrackPair] = useState(null); // { mainTrackId, vocalTrackId }

    // Axios instance with timeout and retry logic
    const axiosInstance = axios.create({
        baseURL: API_URL,
        timeout: 10000,
        headers: {
            Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
    });

    const toggleTrackExpansion = (trackId) => {
        setExpandedTracks(prev => {
            const newSet = new Set(prev);
            if (newSet.has(trackId)) {
                newSet.delete(trackId);
            } else {
                newSet.add(trackId);
            }
            return newSet;
        });
    };

    const playTrackPair = async (mainTrack, vocalTrack) => {
        if (playingTrackPair) {
            stopTrackPair();
        }

        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            setAudioContext(audioContext);

            // Retry fetch with exponential backoff
            const fetchWithRetry = async (url, retries = 3, delay = 1000) => {
                for (let attempt = 1; attempt <= retries; attempt++) {
                    try {
                        const response = await fetch(url, { mode: 'cors', cache: 'no-cache' });
                        if (!response.ok) throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
                        return response;
                    } catch (err) {
                        if (attempt === retries) throw err;
                        console.warn(`Fetch attempt ${attempt} failed for ${url}: ${err.message}. Retrying...`);
                        await new Promise(resolve => setTimeout(resolve, delay * attempt));
                    }
                }
            };

            // Fetch main track
            const mainResponse = await fetchWithRetry(mainTrack.mp3_url);
            const mainArrayBuffer = await mainResponse.arrayBuffer();
            const mainAudioBuffer = await audioContext.decodeAudioData(mainArrayBuffer);
            const mainSource = audioContext.createBufferSource();
            mainSource.buffer = mainAudioBuffer;
            mainSource.connect(audioContext.destination);

            // Fetch vocal track
            let vocalSource = null;
            if (vocalTrack) {
                const vocalResponse = await fetchWithRetry(vocalTrack.mp3_url);
                const vocalArrayBuffer = await vocalResponse.arrayBuffer();
                const vocalAudioBuffer = await audioContext.decodeAudioData(vocalArrayBuffer);
                vocalSource = audioContext.createBufferSource();
                vocalSource.buffer = vocalAudioBuffer;
                vocalSource.connect(audioContext.destination);
            }

            // Start playback
            mainSource.start(0);
            if (vocalSource) vocalSource.start(0);

            setPlayingTrackPair({ mainTrackId: mainTrack.id, vocalTrackId: vocalTrack ? vocalTrack.id : null });
            setSourceNode({ main: mainSource, vocal: vocalSource });

            // Handle playback end
            mainSource.onended = () => {
                stopTrackPair();
            };
        } catch (err) {
            console.error('Play track pair error:', err, 'Main URL:', mainTrack.mp3_url, 'Vocal URL:', vocalTrack?.mp3_url);
            setError(`Failed to play tracks: ${err.message}. Please check your network or track accessibility.`);
            stopTrackPair();
        }
    };

    const stopTrackPair = () => {
        if (sourceNode) {
            if (sourceNode.main) sourceNode.main.stop();
            if (sourceNode.vocal) sourceNode.vocal.stop();
        }
        if (audioContext) {
            audioContext.close();
        }
        setPlayingTrackPair(null);
        setSourceNode(null);
        setAudioContext(null);
    };

    const handleDeleteTrack = async (trackId) => {
        const token = localStorage.getItem('token');
        if (!token) {
            console.log('No token for delete track, redirecting');
            setError('You must be logged in to delete a track');
            navigate(`/login?return=${encodeURIComponent(window.location.pathname)}`);
            return;
        }

        try {
            await axiosInstance.delete(`/collabs/${selectedCollaboration.id}/tracks/${trackId}`);
            setSelectedCollaboration({
                ...selectedCollaboration,
                tracks: selectedCollaboration.tracks.filter(t => t.id !== trackId),
            });
            setError(null);
        } catch (err) {
            console.error('Delete track error:', err.response || err);
            if (err.response?.status === 401) {
                localStorage.removeItem('token');
                setUser(null);
                navigate(`/login?return=${encodeURIComponent(window.location.pathname)}`);
            }
            setError(`Failed to delete track: ${err.response?.data?.error || err.message}`);
        } finally {
            closeConfirmModal();
        }
    };

    // Retry logic for failed requests
    const retryRequest = async (requestFn, maxRetries = 2, delay = 1000) => {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                return await requestFn();
            } catch (err) {
                if (attempt === maxRetries) throw err;
                console.warn(`Retry attempt ${attempt} failed: ${err.message}`);
                await new Promise(resolve => setTimeout(resolve, delay * attempt));
            }
        }
    };

    const fetchCollaborations = async () => {
        const token = localStorage.getItem('token');
        if (!token) {
            console.log('No token found, redirecting to login');
            setError('You must be logged in to manage collaborations.');
            setLoading(false);
            navigate(`/login?return=${encodeURIComponent(window.location.pathname)}`);
            return;
        }

        try {
            console.log('API_URL:', API_URL);
            console.log('Fetching collaborations from:', `${API_URL}/collabs`);
            const response = await retryRequest(() => axiosInstance.get('/collabs'));
            console.log('Collaborations response:', response.data);
            setCollaborations(response.data.collaborations || []);
            setError(null);
        } catch (err) {
            console.error('Fetch collaborations error:', err.response || err);
            if (err.response?.status === 401) {
                console.log('401 error, clearing token and redirecting');
                localStorage.removeItem('token');
                setUser(null);
                setError('Session expired. Please log in again.');
                navigate(`/login?return=${encodeURIComponent(window.location.pathname)}`);
            } else {
                setError(`Failed to fetch collaborations: ${err.response?.data?.error || err.message}`);
            }
        } finally {
            setLoading(false);
        }
    };

    const fetchPendingInvites = async () => {
        const token = localStorage.getItem('token');
        if (!token) {
            console.log('No token for pending invites, skipping');
            return;
        }

        try {
            console.log('Fetching pending invites from:', `${API_URL}/collabs/invites/pending`);
            const response = await retryRequest(() => axiosInstance.get('/collabs/invites/pending'));
            console.log('Pending invites response:', response.data);
            setPendingInvites(response.data.invites || []);
            setError(null);
        } catch (err) {
            console.error('Fetch pending invites error:', err.response || err);
            if (err.response?.status === 401) {
                console.log('401 error for pending invites, clearing token');
                localStorage.removeItem('token');
                setUser(null);
                setError('Session expired. Please log in again.');
                navigate(`/login?return=${encodeURIComponent(window.location.pathname)}`);
            } else {
                setError(`Failed to fetch pending invites: ${err.response?.data?.error || err.message}`);
            }
        }
    };

    useEffect(() => {
        console.log('CollaborationsManager useEffect - authLoading:', authLoading, 'user:', user);
        if (authLoading) {
            console.log('Auth still loading, waiting...');
            return;
        }
        if (!user) {
            console.log('No user after auth check, redirecting to login');
            setLoading(false);
            navigate(`/login?return=${encodeURIComponent(window.location.pathname)}`);
            return;
        }
        console.log('User authenticated, fetching data');
        Promise.all([fetchCollaborations(), fetchPendingInvites()]).finally(() => {
            console.log('Data fetch complete');
            setLoading(false);
        });
    }, [user, authLoading, navigate]);

    const handleCreateInputChange = (e) => {
        const { name, value, type, checked } = e.target;
        setCreateForm({
            ...createForm,
            [name]: type === 'checkbox' ? checked : value,
        });
    };

    const handleCreateSubmit = async (e) => {
        e.preventDefault();
        const token = localStorage.getItem('token');
        if (!token) {
            console.log('No token for create, redirecting');
            setError('You must be logged in to create a collaboration');
            navigate(`/login?return=${encodeURIComponent(window.location.pathname)}`);
            return;
        }
        if (!createForm.title) return setError('Collaboration title is required');

        try {
            const response = await axiosInstance.post('/collabs', createForm);
            setCollaborations([...collaborations, response.data.collaboration]);
            setCreateForm({ title: '', description: '', is_public: false, allow_uploads: false });
            setShowCreateForm(false);
            setError(null);
        } catch (err) {
            console.error('Create collaboration error:', err.response || err);
            if (err.response?.status === 401) {
                localStorage.removeItem('token');
                setUser(null);
                navigate(`/login?return=${encodeURIComponent(window.location.pathname)}`);
            }
            setError(`Failed to create collaboration: ${err.response?.data?.error || err.message}`);
        }
    };

    const handleEditInputChange = (e) => {
        const { name, value, type, checked } = e.target;
        setEditForm({
            ...editForm,
            [name]: type === 'checkbox' ? checked : value,
        });
    };

    const handleEditSubmit = async (e) => {
        e.preventDefault();
        const token = localStorage.getItem('token');
        if (!token) {
            console.log('No token for edit, redirecting');
            setError('You must be logged in to edit a collaboration');
            navigate(`/login?return=${encodeURIComponent(window.location.pathname)}`);
            return;
        }
        if (!editForm.title) return setError('Collaboration title is required');

        try {
            const response = await axiosInstance.patch(`/collabs/${selectedCollaboration.id}`, editForm);
            setCollaborations(
                collaborations.map(c => (c.id === selectedCollaboration.id ? response.data.collaboration : c))
            );
            setSelectedCollaboration(response.data.collaboration);
            setShowEditForm(false);
            setError(null);
        } catch (err) {
            console.error('Edit collaboration error:', err.response || err);
            if (err.response?.status === 401) {
                localStorage.removeItem('token');
                setUser(null);
                navigate(`/login?return=${encodeURIComponent(window.location.pathname)}`);
            }
            setError(`Failed to update collaboration: ${err.response?.data?.error || err.message}`);
        }
    };

    const handleTrackInputChange = (e) => {
        const { name, value, type, checked } = e.target;
        if (type === 'file') {
            const file = e.target.files[0];
            if (!file) return;
            if (file.size > 100 * 1024 * 1024) return setError('MP3 file size exceeds 100 MB limit');
            if (!file.type.includes('audio/mpeg')) return setError('MP3 file must be an audio/mpeg file');
            setTrackForm({ ...trackForm, mp3: file });
        } else {
            setTrackForm({
                ...trackForm,
                [name]: type === 'checkbox' ? checked : value,
            });
        }
    };

    const handleTrackSubmit = async (e) => {
        e.preventDefault();
        const token = localStorage.getItem('token');
        if (!token) {
            console.log('No token for track upload, redirecting');
            setError('You must be logged in to upload a track');
            navigate(`/login?return=${encodeURIComponent(window.location.pathname)}`);
            return;
        }
        if (!trackForm.title) return setError('Track title is required');
        if (!trackForm.mp3) return setError('MP3 file is required');

        setIsUploading(true);
        setUploadProgress(0);

        const formData = new FormData();
        formData.append('title', trackForm.title);
        formData.append('mp3', trackForm.mp3);
        formData.append('is_master', trackForm.is_master);

        try {
            const response = await axiosInstance.post(`/collabs/${selectedCollaboration.id}/tracks`, formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
                timeout: 60000,
                onUploadProgress: (progressEvent) => {
                    if (progressEvent.total) {
                        const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
                        setUploadProgress(percentCompleted);
                    }
                },
            });
            setSelectedCollaboration({
                ...selectedCollaboration,
                tracks: [...(selectedCollaboration.tracks || []), response.data.track],
            });
            setTrackForm({ title: '', mp3: null, is_master: false });
            setShowTrackForm(false);
            setError(null);
        } catch (err) {
            console.error('Upload track error:', err.response || err);
            if (err.response?.status === 401) {
                localStorage.removeItem('token');
                setUser(null);
                navigate(`/login?return=${encodeURIComponent(window.location.pathname)}`);
            }
            setError(`Failed to upload track: ${err.response?.data?.error || err.message}`);
        } finally {
            setIsUploading(false);
            setUploadProgress(0);
        }
    };

    const handleInviteInputChange = (e) => {
        const { name, value, type, checked } = e.target;
        setInviteForm({
            ...inviteForm,
            [name]: type === 'checkbox' ? checked : value,
        });
    };

    const handleInviteSubmit = async (e) => {
        e.preventDefault();
        const token = localStorage.getItem('token');
        if (!token) {
            console.log('No token for invite, redirecting');
            setError('You must be logged in to invite collaborators');
            navigate(`/login?return=${encodeURIComponent(window.location.pathname)}`);
            return;
        }
        if (!inviteForm.email) return setError('Email is required');

        try {
            await axiosInstance.post(`/collabs/${selectedCollaboration.id}/invite`, inviteForm);
            setInviteForm({ email: '', can_upload: false });
            setShowInviteForm(false);
            fetchInvitees();
            setError(null);
        } catch (err) {
            console.error('Invite collaborator error:', err.response || err);
            if (err.response?.status === 401) {
                localStorage.removeItem('token');
                setUser(null);
                navigate(`/login?return=${encodeURIComponent(window.location.pathname)}`);
            }
            setError(`Failed to send invitation: ${err.response?.data?.error || err.message}`);
        }
    };

    const startRecording = async (track) => {
        if (!track) return setError('Please select a track for playback');

        try {
            setSelectedTrackForPlayback(track);
            const context = new (window.AudioContext || window.webkitAudioContext)();
            setAudioContext(context);

            const response = await fetch(track.mp3_url);
            if (!response.ok) throw new Error('Failed to fetch playback track');
            const arrayBuffer = await response.arrayBuffer();
            const audioBuffer = await context.decodeAudioData(arrayBuffer);

            const source = context.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(context.destination);
            setSourceNode(source);

            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const recorder = new MediaRecorder(stream);
            setMediaRecorder(recorder);
            setRecordedChunks([]);

            recorder.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    setRecordedChunks(prev => [...prev, e.data]);
                }
            };

            recorder.onstop = () => {
                console.log('Recording stopped, chunks collected:', recordedChunks.length);
            };

            source.start(0);
            recorder.start(1000); // Timeslice to ensure single dataavailable event
            setIsRecording(true);
        } catch (err) {
            console.error('Start recording error:', err);
            setError('Failed to start recording: ' + err.message);
            setShowRecordModal(false);
        }
    };

    const stopRecording = () => {
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            mediaRecorder.stop();
        }
        if (sourceNode) {
            sourceNode.stop();
        }
        if (audioContext) {
            audioContext.close();
        }
        setIsRecording(false);

        if (mediaRecorder) {
            mediaRecorder.stream.getTracks().forEach(track => track.stop());
        }
        setMediaRecorder(null);
        setSourceNode(null);
        setAudioContext(null);
    };

    useEffect(() => {
        if (!isRecording && recordedChunks.length > 0 && !uploadLockRef.current) {
            uploadLockRef.current = true;

            const uploadRecording = async () => {
                try {
                    const webmBlob = new Blob(recordedChunks, { type: 'audio/webm' });
                    if (webmBlob.size > 100 * 1024 * 1024) {
                        setError('Recorded file size exceeds 100 MB limit');
                        return;
                    }

                    const file = new File([webmBlob], `vocal-track-${Date.now()}.webm`, { type: 'audio/webm' });

                    const formData = new FormData();
                    formData.append('title', `Vocal Track - ${selectedTrackForPlayback.title}`);
                    formData.append('mp3', file); // Backend will handle as WebM
                    formData.append('is_master', 'false');

                    setIsUploading(true);
                    setUploadProgress(0);

                    const response = await axiosInstance.post(`/collabs/${selectedCollaboration.id}/tracks`, formData, {
                        headers: { 'Content-Type': 'multipart/form-data' },
                        timeout: 60000,
                        onUploadProgress: (progressEvent) => {
                            if (progressEvent.total) {
                                const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
                                setUploadProgress(percentCompleted);
                            }
                        },
                    });

                    setSelectedCollaboration({
                        ...selectedCollaboration,
                        tracks: [...(selectedCollaboration.tracks || []), response.data.track],
                    });
                    setShowRecordModal(false);
                    setError(null);
                } catch (err) {
                    console.error('Upload recorded track error:', err);
                    setError(`Failed to upload recorded track: ${err.response?.data?.error || err.message}`);
                } finally {
                    setIsUploading(false);
                    setUploadProgress(0);
                    setRecordedChunks([]);
                    setSelectedTrackForPlayback(null);
                    uploadLockRef.current = false;
                }
            };

            uploadRecording();
        }
    }, [recordedChunks, isRecording, selectedCollaboration]);

    const convertWebMToMP3 = async (webmBlob) => {
        try {
            const arrayBuffer = await webmBlob.arrayBuffer();
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

            // Convert AudioBuffer to WAV (simplified, assumes mono channel)
            const wavBuffer = audioBuffer.getChannelData(0);
            const wavSamples = new Int16Array(wavBuffer.length);
            for (let i = 0; i < wavBuffer.length; i++) {
                wavSamples[i] = Math.max(-1, Math.min(1, wavBuffer[i])) * 32767;
            }

            // Encode WAV to MP3 using lamejs
            const mp3Encoder = new lamejs.Mp3Encoder(1, audioBuffer.sampleRate, 128);
            const mp3Data = [];
            const blockSize = 1152;
            for (let i = 0; i < wavSamples.length; i += blockSize) {
                const block = wavSamples.subarray(i, i + blockSize);
                const mp3buf = mp3Encoder.encodeBuffer(block);
                if (mp3buf.length > 0) {
                    mp3Data.push(mp3buf);
                }
            }
            const mp3buf = mp3Encoder.flush();
            if (mp3buf.length > 0) {
                mp3Data.push(mp3buf);
            }

            return new Blob(mp3Data, { type: 'audio/mpeg' });
        } catch (err) {
            console.error('MP3 conversion error:', err);
            throw new Error('Failed to convert recording to MP3');
        }
    };

    useEffect(() => {
        if (!isRecording && recordedChunks.length > 0 && !uploadLockRef.current) {
            uploadLockRef.current = true;

            const uploadRecording = async () => {
                try {
                    const webmBlob = new Blob(recordedChunks, { type: 'audio/webm' });
                    if (webmBlob.size > 100 * 1024 * 1024) {
                        setError('Recorded file size exceeds 100 MB limit');
                        return;
                    }

                    const mp3Blob = await convertWebMToMP3(webmBlob);
                    const file = new File([mp3Blob], `vocal-track-${Date.now()}.mp3`, { type: 'audio/mpeg' });

                    const formData = new FormData();
                    formData.append('title', `Vocal Track - ${selectedTrackForPlayback.title}`);
                    formData.append('mp3', file);
                    formData.append('is_master', 'false');

                    setIsUploading(true);
                    setUploadProgress(0);

                    const response = await axiosInstance.post(`/collabs/${selectedCollaboration.id}/tracks`, formData, {
                        headers: { 'Content-Type': 'multipart/form-data' },
                        timeout: 60000,
                        onUploadProgress: (progressEvent) => {
                            if (progressEvent.total) {
                                const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
                                setUploadProgress(percentCompleted);
                            }
                        },
                    });

                    setSelectedCollaboration({
                        ...selectedCollaboration,
                        tracks: [...(selectedCollaboration.tracks || []), response.data.track],
                    });
                    setShowRecordModal(false);
                    setError(null);
                } catch (err) {
                    console.error('Upload recorded track error:', err);
                    setError(`Failed to upload recorded track: ${err.response?.data?.error || err.message}`);
                } finally {
                    setIsUploading(false);
                    setUploadProgress(0);
                    setRecordedChunks([]);
                    setSelectedTrackForPlayback(null);
                    uploadLockRef.current = false;
                }
            };

            uploadRecording();
        }
    }, [recordedChunks, isRecording, selectedCollaboration]);

    const openConfirmModal = (action, title, message) => {
        setConfirmAction(() => action);
        setConfirmTitle(title);
        setConfirmMessage(message);
        setShowConfirmModal(true);
    };

    const closeConfirmModal = () => {
        setShowConfirmModal(false);
        setConfirmAction(null);
        setConfirmTitle('');
        setConfirmMessage('');
    };

    const handleDeleteCollaboration = (collaborationId) => {
        openConfirmModal(
            async () => {
                const token = localStorage.getItem('token');
                if (!token) {
                    console.log('No token for delete, redirecting');
                    setError('You must be logged in to delete a collaboration');
                    navigate(`/login?return=${encodeURIComponent(window.location.pathname)}`);
                    return;
                }

                try {
                    await axiosInstance.delete(`/collabs/${collaborationId}`);
                    setCollaborations(collaborations.filter(c => c.id !== collaborationId));
                    setSelectedCollaboration(null);
                    setError(null);
                } catch (err) {
                    console.error('Delete collaboration error:', err.response || err);
                    if (err.response?.status === 401) {
                        localStorage.removeItem('token');
                        setUser(null);
                        navigate(`/login?return=${encodeURIComponent(window.location.pathname)}`);
                    }
                    setError(`Failed to delete collaboration: ${err.response?.data?.error || err.message}`);
                } finally {
                    closeConfirmModal();
                }
            },
            'Delete Collaboration',
            'Are you sure you want to delete this collaboration? This action cannot be undone.'
        );
    };

    const handleResendInvite = async (invitationId) => {
        const token = localStorage.getItem('token');
        if (!token) {
            console.log('No token for resend invite, redirecting');
            setError('You must be logged in to resend invitations');
            navigate(`/login?return=${encodeURIComponent(window.location.pathname)}`);
            return;
        }

        try {
            await axiosInstance.post(`/collabs/${selectedCollaboration.id}/invitees/${invitationId}/resend`, {});
            fetchInvitees();
            setError(null);
        } catch (err) {
            console.error('Resend invite error:', err.response || err);
            if (err.response?.status === 401) {
                localStorage.removeItem('token');
                setUser(null);
                navigate(`/login?return=${encodeURIComponent(window.location.pathname)}`);
            }
            setError(`Failed to resend invitation: ${err.response?.data?.error || err.message}`);
        }
    };

    const handleRevokeInvite = (invitationId, email) => {
        openConfirmModal(
            async () => {
                const token = localStorage.getItem('token');
                if (!token) {
                    console.log('No token for revoke invite, redirecting');
                    setError('You must be logged in to revoke invitations');
                    navigate(`/login?return=${encodeURIComponent(window.location.pathname)}`);
                    return;
                }

                try {
                    await axiosInstance.delete(`/collabs/${selectedCollaboration.id}/invitees/${invitationId}`);
                    fetchInvitees();
                    setError(null);
                } catch (err) {
                    console.error('Revoke invite error:', err.response || err);
                    if (err.response?.status === 401) {
                        localStorage.removeItem('token');
                        setUser(null);
                        navigate(`/login?return=${encodeURIComponent(window.location.pathname)}`);
                    }
                    setError(`Failed to revoke invitation: ${err.response?.data?.error || err.message}`);
                } finally {
                    closeConfirmModal();
                }
            },
            'Revoke Invitation',
            `Are you sure you want to revoke the invitation for ${email}?`
        );
    };

    const handleRemoveCollaborator = (collaboratorProfileId, profileName) => {
        openConfirmModal(
            async () => {
                const token = localStorage.getItem('token');
                if (!token) {
                    console.log('No token for remove collaborator, redirecting');
                    setError('You must be logged in to remove collaborators');
                    navigate(`/login?return=${encodeURIComponent(window.location.pathname)}`);
                    return;
                }

                try {
                    await axiosInstance.delete(`/collabs/${selectedCollaboration.id}/collaborators/${collaboratorProfileId}`);
                    fetchInvitees();
                    setError(null);
                } catch (err) {
                    console.error('Remove collaborator error:', err.response || err);
                    if (err.response?.status === 401) {
                        localStorage.removeItem('token');
                        setUser(null);
                        navigate(`/login?return=${encodeURIComponent(window.location.pathname)}`);
                    }
                    setError(`Failed to remove collaborator: ${err.response?.data?.error || err.message}`);
                } finally {
                    closeConfirmModal();
                }
            },
            'Remove Collaborator',
            `Are you sure you want to remove ${profileName} from this collaboration?`
        );
    };

    const fetchCollaborationDetails = async (collaborationId) => {
        const token = localStorage.getItem('token');
        try {
            const response = await retryRequest(() => axiosInstance.get(`/collabs/${collaborationId}`));
            setSelectedCollaboration(response.data.collaboration);
            setEditForm({
                title: response.data.collaboration.title,
                description: response.data.collaboration.description || '',
                is_public: response.data.collaboration.is_public,
                allow_uploads: response.data.collaboration.allow_uploads,
            });
            if (response.data.collaboration.profile_id === Number(profileId)) {
                fetchInvitees(collaborationId);
            }
            setError(null);
        } catch (err) {
            console.error('Fetch collaboration details error:', err.response || err);
            if (err.response?.status === 401) {
                localStorage.removeItem('token');
                setUser(null);
                navigate(`/login?return=${encodeURIComponent(window.location.pathname)}`);
            }
            setError(`Failed to fetch collaboration: ${err.response?.data?.error || err.message}`);
        }
    };

    const fetchInvitees = async (collaborationId = selectedCollaboration?.id) => {
        if (!collaborationId) return;
        const token = localStorage.getItem('token');
        try {
            const response = await retryRequest(() =>
                axiosInstance.get(`/collabs/${collaborationId}/invitees`)
            );
            setInvitees(response.data.invitees || []);
            setError(null);
        } catch (err) {
            console.error('Fetch invitees error:', err.response || err);
            if (err.response?.status === 401) {
                localStorage.removeItem('token');
                setUser(null);
                navigate(`/login?return=${encodeURIComponent(window.location.pathname)}`);
            }
            setError(`Failed to fetch invitees: ${err.response?.data?.error || err.message}`);
        }
    };

    const handleInviteAction = async (invite) => {
        const token = localStorage.getItem('token');
        if (!token) {
            console.log('No token for invite action, redirecting');
            setError('You must be logged in to respond to invites');
            navigate(`/login?return=${encodeURIComponent(window.location.pathname)}`);
            return;
        }

        try {
            await axiosInstance.post(`/collabs/invite/${invite.token}`);
            setPendingInvites(pendingInvites.filter(i => i.id !== invite.id));
            await fetchCollaborations();
            fetchCollaborationDetails(invite.collaboration_id);
            setError(null);
        } catch (err) {
            console.error('Invite action error:', err.response || err);
            if (err.response?.status === 401) {
                localStorage.removeItem('token');
                setUser(null);
                navigate(`/login?return=${encodeURIComponent(window.location.pathname)}`);
            }
            setError(`Failed to accept invite: ${err.response?.data?.error || err.message}`);
        } finally {
            setShowInviteModal(false);
            setSelectedInvite(null);
        }
    };

    const openInviteModal = (invite) => {
        setSelectedInvite(invite);
        setShowInviteModal(true);
    };

    const closeInviteModal = () => {
        setShowInviteModal(false);
        setSelectedInvite(null);
    };

    const getStatusDisplay = (status) => {
        switch (status) {
            case 'pending':
                return 'Pending';
            case 'accepted':
                return 'Accepted';
            case 'declined':
                return 'Declined';
            case 'removed':
                return 'Removed by Admin';
            default:
                return status;
        }
    };

    if (authLoading || loading) {
        return (
            <div className="container mx-auto px-4 py-8 text-center text-gray-100 pt-2">
                <p>Loading...</p>
            </div>
        );
    }

    if (!user || error === 'You are not authorized to manage collaborations.') {
        return (
            <div className="container mx-auto px-4 py-8 text-center text-gray-100 pt-2">
                <p className="text-red-500">{error || 'Unauthorized'}</p>
            </div>
        );
    }

    return (
            <div className="container mx-auto px-4 py-8 max-w-4xl text-gray-100 pt-2 min-h-screen">
            <h1 className="text-3xl font-bold mb-6 text-white">Collaborations Manager</h1>
            {error && <p className="text-red-400 mb-4">{error}</p>}

            {/* Pending Invites */}
            {pendingInvites.length > 0 && (
                <div className="spotify-surface border border-white/10 p-6 rounded-xl shadow-md mb-8">
                    <h2 className="text-2xl font-bold mb-4 text-white">Pending Invites</h2>
                    <div className="space-y-4">
                        {pendingInvites.map(invite => (
                            <div
                                key={invite.id}
                                className="p-4 bg-white/5 border border-white/10 rounded-xl shadow-sm flex items-center justify-between"
                            >
                                <div>
                                    <h3 className="text-lg font-semibold text-white">
                                        {invite.collaboration_title}
                                    </h3>
                                    <p className="text-sm text-gray-300">
                                        Invited to: {invite.email}
                                    </p>
                                    <p className="text-sm text-gray-300">
                                        Invited on: {new Date(invite.invited_at).toLocaleString()}
                                    </p>
                                    <p className="text-sm text-gray-300">
                                        Upload Permissions: {invite.can_upload ? 'Yes' : 'No'}
                                    </p>
                                </div>
                                <button
                                    onClick={() => openInviteModal(invite)}
                                    className="py-2 px-4 bg-primary-brand-500 text-white font-semibold rounded-md shadow-sm hover:bg-primary-brand-700"
                                >
                                    Respond
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Create Collaboration Button */}
            {!showCreateForm && (
                <div className="mb-8">
                    <button
                        onClick={() => setShowCreateForm(true)}
                        className="py-2 px-4 bg-primary-brand-500 text-white font-semibold rounded-md shadow-sm hover:bg-primary-brand-700"
                    >
                        Create New Collaboration
                    </button>
                </div>
            )}

            {/* Create Collaboration Form */}
            {showCreateForm && (
                <div className="spotify-surface border border-white/10 p-6 rounded-xl shadow-md mb-8 text-gray-100">
                    <div className="flex justify-between items-center mb-4">
                        <h2 className="text-2xl font-bold text-white">Create Collaboration</h2>
                        <button
                            onClick={() => setShowCreateForm(false)}
                            className="text-primary-brand-300 hover:text-primary-brand-200"
                        >
                            <XMarkIcon className="w-6 h-6" />
                        </button>
                    </div>
                    <form onSubmit={handleCreateSubmit} className="space-y-6">
                        <div>
                            <label className="block text-sm font-medium text-gray-200">Title</label>
                            <input
                                type="text"
                                name="title"
                                value={createForm.title}
                                onChange={handleCreateInputChange}
                                required
                                className="mt-1 block w-full px-3 py-2 border border-white/10 rounded-md shadow-sm bg-white/5 text-white"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-200">Description</label>
                            <textarea
                                name="description"
                                value={createForm.description}
                                onChange={handleCreateInputChange}
                                rows="4"
                                className="mt-1 block w-full px-3 py-2 border border-white/10 rounded-md shadow-sm bg-white/5 text-white"
                            />
                        </div>
                        <div>
                            <label className="flex items-center">
                                <input
                                    type="checkbox"
                                    name="is_public"
                                    checked={createForm.is_public}
                                    onChange={handleCreateInputChange}
                                    className="mr-2"
                                />
                                Public
                            </label>
                        </div>
                        <div>
                            <label className="flex items-center">
                                <input
                                    type="checkbox"
                                    name="allow_uploads"
                                    checked={createForm.allow_uploads}
                                    onChange={handleCreateInputChange}
                                    className="mr-2"
                                />
                                Allow Uploads
                            </label>
                        </div>
                        <button
                            type="submit"
                            className="w-full py-2 px-4 bg-primary-brand-500 text-white font-semibold rounded-md shadow-sm hover:bg-primary-brand-700"
                        >
                            Create
                        </button>
                    </form>
                </div>
            )}

            {/* Collaborations List */}
            <div className="spotify-surface border border-white/10 p-6 rounded-xl shadow-md">
                <h2 className="text-2xl font-bold mb-4 text-white">Your Collaborations</h2>
                {collaborations.length === 0 ? (
                    <p className="text-gray-300">No collaborations yet.</p>
                ) : (
                    <div className="space-y-6">
                        {collaborations.map(collab => (
                            <div
                                key={collab.id}
                                className="p-4 bg-white/5 border border-white/10 rounded-xl shadow-sm flex items-center justify-between"
                            >
                                <div>
                                    <h3
                                        className="text-lg font-semibold text-white cursor-pointer hover:underline"
                                        onClick={() => fetchCollaborationDetails(collab.id)}
                                    >
                                        {collab.title}
                                    </h3>
                                    <p className="text-sm text-gray-300">{collab.description}</p>
                                    <p className="text-sm text-gray-300">
                                        {collab.is_public ? 'Public' : 'Private'} |{' '}
                                        {collab.allow_uploads ? 'Uploads Allowed' : 'Uploads Restricted'}
                                    </p>
                                </div>
                                {collab.profile_id === Number(profileId) && (
                                    <button
                                        onClick={() => handleDeleteCollaboration(collab.id)}
                                        className="p-2 text-red-600 hover:text-red-700"
                                        title="Delete Collaboration"
                                    >
                                        <TrashIcon className="w-5 h-5" />
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Collaboration Details */}
            {selectedCollaboration && (
                <div className="spotify-surface border border-white/10 p-6 rounded-xl shadow-md mt-8 text-gray-100">
                    <div className="flex justify-between items-center mb-4">
                        <h2 className="text-2xl font-bold text-white">{selectedCollaboration.title}</h2>
                        <button
                            onClick={() => setSelectedCollaboration(null)}
                            className="text-primary-brand-300 hover:text-primary-brand-200"
                        >
                            <XMarkIcon className="w-6 h-6" />
                        </button>
                    </div>
                    <p className="mb-4 text-gray-300">{selectedCollaboration.description}</p>
                    <div className="flex space-x-4 mb-4">
                        <button
                            onClick={() => setShowTrackForm(true)}
                            className="py-2 px-4 bg-primary-brand-500 text-white font-semibold rounded-md shadow-sm hover:bg-primary-brand-700"
                        >
                            Upload Track
                        </button>
                        <button
                            onClick={() => setShowRecordModal(true)}
                            className="py-2 px-4 bg-primary-brand-500 text-white font-semibold rounded-md shadow-sm hover:bg-primary-brand-700"
                        >
                            Record Vocal Track
                        </button>
                        {selectedCollaboration.profile_id === Number(profileId) && (
                            <>
                                <button
                                    onClick={() => setShowInviteForm(true)}
                                    className="py-2 px-4 bg-primary-brand-500 text-white font-semibold rounded-md shadow-sm hover:bg-primary-brand-700"
                                >
                                    Invite Collaborator
                                </button>
                                <button
                                    onClick={() => setShowEditForm(true)}
                                    className="py-2 px-4 bg-primary-brand-500 text-white font-semibold rounded-md shadow-sm hover:bg-primary-brand-700"
                                >
                                    Edit Collaboration
                                </button>
                            </>
                        )}
                    </div>

                    {/* Invitees List */}
                    {selectedCollaboration.profile_id === Number(profileId) && (
                        <div className="mt-6">
                            <h3 className="text-xl font-bold mb-4 text-white">Invitees</h3>
                            {invitees.length === 0 ? (
                                <p className="text-gray-300">No invitees yet.</p>
                            ) : (
                                <div className="space-y-4">
                                    {invitees.map(invitee => (
                                        <div
                                            key={invitee.id}
                                            className="p-2 bg-white/5 border border-white/10 rounded-md flex justify-between items-center"
                                        >
                                            <div>
                                                <p className="font-semibold text-white">{invitee.email}</p>
                                                <p className="text-sm text-gray-300">
                                                    Status: {getStatusDisplay(invitee.status)}
                                                </p>
                                                <p className="text-sm text-gray-300">
                                                    Invited: {new Date(invitee.invited_at).toLocaleString()}
                                                </p>
                                                {invitee.accepted_at && (
                                                    <p className="text-sm text-gray-300">
                                                        Accepted: {new Date(invitee.accepted_at).toLocaleString()}
                                                    </p>
                                                )}
                                                {invitee.profile_name && invitee.status === 'accepted' && (
                                                    <p className="text-sm text-gray-300">
                                                        Collaborator: {invitee.profile_name}
                                                    </p>
                                                )}
                                            </div>
                                            {invitee.status === 'pending' && (
                                                <div className="flex space-x-2">
                                                    <button
                                                        onClick={() => handleResendInvite(invitee.id)}
                                                        className="p-2 text-blue-600 hover:text-primary-brand-800"
                                                        title="Resend Invitation"
                                                    >
                                                        <EnvelopeIcon className="w-5 h-5" />
                                                    </button>
                                                    <button
                                                        onClick={() => handleRevokeInvite(invitee.id, invitee.email)}
                                                        className="p-2 text-red-600 hover:text-red-700"
                                                        title="Revoke Invitation"
                                                    >
                                                        <TrashIcon className="w-5 h-5" />
                                                    </button>
                                                </div>
                                            )}
                                            {invitee.status === 'accepted' && invitee.profile_id && (
                                                <button
                                                    onClick={() => handleRemoveCollaborator(invitee.profile_id, invitee.profile_name)}
                                                    className="p-2 text-red-600 hover:text-red-700"
                                                    title="Remove Collaborator"
                                                >
                                                    <TrashIcon className="w-5 h-5" />
                                                </button>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Tracks List */}
                    <h3 className="text-xl font-bold mb-4 mt-6 text-white">Tracks</h3>
                    {selectedCollaboration.tracks && selectedCollaboration.tracks.length > 0 ? (
                        <div className="space-y-4">
                            {selectedCollaboration.tracks
                                .filter(track => !track.title.startsWith('Vocal Track -')) // Main tracks
                                .map(mainTrack => {
                                    const vocalTracks = selectedCollaboration.tracks.filter(track =>
                                        track.title.startsWith(`Vocal Track - ${mainTrack.title}`)
                                    );
                                    return (
                                        <div key={mainTrack.id} className="p-2 bg-white/5 border border-white/10 rounded-md">
                                            <div className="flex justify-between items-center relative group">
                                                <div className="flex-1">
                                                    <p className="font-semibold text-white">{mainTrack.title}</p>
                                                    <p className="text-sm text-gray-300">
                                                        Uploaded by {mainTrack.profile_name} {mainTrack.is_master && '(Master)'}
                                                    </p>
                                                    <audio
                                                        controls
                                                        src={mainTrack.mp3_url}
                                                        type={mainTrack.mp3_url.endsWith('.webm') ? 'audio/webm' : 'audio/mpeg'}
                                                        onError={(e) => console.error('Audio playback error:', e.nativeEvent, 'URL:', mainTrack.mp3_url)}
                                                        onContextMenu={e => e.preventDefault()}
                                                        controlsList="nodownload"
                                                        className="mt-2 w-full"
                                                    >
                                                        Your browser does not support the audio element.
                                                    </audio>
                                                </div>
                                                {(selectedCollaboration.profile_id === Number(profileId) || mainTrack.profile_id === Number(profileId)) && (
                                                    <button
                                                        onClick={() => {
                                                            setTrackToDelete(mainTrack);
                                                            openConfirmModal(
                                                                () => handleDeleteTrack(mainTrack.id),
                                                                'Delete Track',
                                                                `Are you sure you want to delete the track "${mainTrack.title}"? This action cannot be undone.`
                                                            );
                                                        }}
                                                        className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300"
                                                        title="Delete Track"
                                                    >
                                                        <TrashIcon className="w-5 h-5" />
                                                    </button>
                                                )}
                                            </div>
                                            {vocalTracks.length > 0 && (
                                                <div className="ml-8 mt-2 space-y-2">
                                                    {vocalTracks.map(vocalTrack => (
                                                        <div key={vocalTrack.id} className="p-2 bg-white/5 border border-white/10 rounded-md relative group">
                                                            <div className="flex-1">
                                                                <p className="text-sm font-medium text-white">{vocalTrack.title}</p>
                                                                <p className="text-xs text-gray-300">
                                                                    Uploaded by {vocalTrack.profile_name}
                                                                </p>
                                                                <audio
                                                                    controls
                                                                    src={vocalTrack.mp3_url}
                                                                    type={vocalTrack.mp3_url.endsWith('.webm') ? 'audio/webm' : 'audio/mpeg'}
                                                                    onError={(e) => console.error('Audio playback error:', e.nativeEvent, 'URL:', vocalTrack.mp3_url)}
                                                                    onContextMenu={e => e.preventDefault()}
                                                                    controlsList="nodownload"
                                                                    className="mt-1 w-full"
                                                                >
                                                                    Your browser does not support the audio element.
                                                                </audio>
                                                                {playingTrackPair?.mainTrackId === mainTrack.id && playingTrackPair?.vocalTrackId === vocalTrack.id ? (
                                                                    <button
                                                                        onClick={() => stopTrackPair()}
                                                                        className="mt-1 py-1 px-2 bg-red-600 text-white text-sm rounded-md hover:bg-red-700"
                                                                    >
                                                                        Stop Playback
                                                                    </button>
                                                                ) : (
                                                                    <button
                                                                        onClick={() => playTrackPair(mainTrack, vocalTrack)}
                                                                        className="mt-1 py-1 px-2 bg-primary-brand-500 text-white text-sm rounded-md hover:bg-primary-brand-700"
                                                                    >
                                                                        Play with Main Track
                                                                    </button>
                                                                )}
                                                            </div>
                                                            {(selectedCollaboration.profile_id === Number(profileId) || vocalTrack.profile_id === Number(profileId)) && (
                                                                <button
                                                                    onClick={() => {
                                                                        setTrackToDelete(vocalTrack);
                                                                        openConfirmModal(
                                                                            () => handleDeleteTrack(vocalTrack.id),
                                                                            'Delete Vocal Track',
                                                                            `Are you sure you want to delete the vocal track "${vocalTrack.title}"? This action cannot be undone.`
                                                                        );
                                                                    }}
                                                                    className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300"
                                                                    title="Delete Vocal Track"
                                                                >
                                                                    <TrashIcon className="w-5 h-5" />
                                                                </button>
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                        </div>
                    ) : (
                        <p className="text-gray-300">No tracks uploaded yet.</p>
                    )}
                </div>
            )}

            {/* Edit Collaboration Form */}
            {showEditForm && selectedCollaboration && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className="bg-[#111827] border border-white/10 p-6 rounded-xl shadow-xl max-w-md w-full text-gray-100">
                        <div className="flex justify-between items-center mb-4">
                            <h2 className="text-xl font-bold text-white">Edit Collaboration</h2>
                            <button
                                onClick={() => setShowEditForm(false)}
                                className="text-primary-brand-300 hover:text-primary-brand-200"
                            >
                                <XMarkIcon className="w-6 h-6" />
                            </button>
                        </div>
                        {error && <p className="text-red-400 text-sm mb-4">{error}</p>}
                        <form onSubmit={handleEditSubmit} className="space-y-6">
                            <div>
                                <label className="block text-sm font-medium text-gray-200">Title</label>
                                <input
                                    type="text"
                                    name="title"
                                    value={editForm.title}
                                    onChange={handleEditInputChange}
                                    required
                                    className="mt-1 block w-full px-3 py-2 border border-white/10 rounded-md shadow-sm bg-white/5 text-white"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-200">Description</label>
                                <textarea
                                    name="description"
                                    value={editForm.description}
                                    onChange={handleEditInputChange}
                                    rows="4"
                                    className="mt-1 block w-full px-3 py-2 border border-white/10 rounded-md shadow-sm bg-white/5 text-white"
                                />
                            </div>
                            <div>
                                <label className="flex items-center">
                                    <input
                                        type="checkbox"
                                        name="is_public"
                                        checked={editForm.is_public}
                                        onChange={handleEditInputChange}
                                        className="mr-2"
                                    />
                                    Public
                                </label>
                            </div>
                            <div>
                                <label className="flex items-center">
                                    <input
                                        type="checkbox"
                                        name="allow_uploads"
                                        checked={editForm.allow_uploads}
                                        onChange={handleEditInputChange}
                                        className="mr-2"
                                    />
                                    Allow Uploads
                                </label>
                            </div>
                            <button
                                type="submit"
                                className="w-full py-2 px-4 bg-primary-brand-500 text-white font-semibold rounded-md shadow-sm hover:bg-primary-brand-700"
                            >
                                Save Changes
                            </button>
                        </form>
                    </div>
                </div>
            )}

            {/* Track Upload Form */}
            {showTrackForm && selectedCollaboration && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className="bg-[#111827] border border-white/10 p-6 rounded-xl shadow-xl max-w-md w-full text-gray-100">
                        <div className="flex justify-between items-center mb-4">
                            <h2 className="text-xl font-bold text-white">Upload Track</h2>
                            <button
                                onClick={() => setShowTrackForm(false)}
                                className="text-primary-brand-300 hover:text-primary-brand-200"
                            >
                                <XMarkIcon className="w-6 h-6" />
                            </button>
                        </div>
                        {error && <p className="text-red-400 text-sm mb-4">{error}</p>}
                        <form onSubmit={handleTrackSubmit} className="space-y-6">
                            <div>
                                <label className="block text-sm font-medium text-gray-200">Track Title</label>
                                <input
                                    type="text"
                                    name="title"
                                    value={trackForm.title}
                                    onChange={handleTrackInputChange}
                                    required
                                    className="mt-1 block w-full px-3 py-2 border border-white/10 rounded-md shadow-sm bg-white/5 text-white"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-200">MP3 File</label>
                                <input
                                    type="file"
                                    name="mp3"
                                    onChange={handleTrackInputChange}
                                    accept="audio/mp3"
                                    required
                                    ref={mp3InputRef}
                                    className="mt-1 block w-full text-sm text-gray-300"
                                />
                            </div>
                            <div>
                                <label className="flex items-center">
                                    <input
                                        type="checkbox"
                                        name="is_master"
                                        checked={trackForm.is_master}
                                        onChange={handleTrackInputChange}
                                        className="mr-2"
                                    />
                                    Master Track
                                </label>
                            </div>
                            {isUploading && (
                                <div className="relative w-full bg-white/10 rounded-full h-6">
                                    <div
                                        className="bg-primary-brand-500 h-6 rounded-full flex items-center justify-center text-sm text-white px-2"
                                        style={{ width: `${uploadProgress}%` }}
                                    >
                                        {uploadProgress > 10 && uploadProgress < 100 && `${uploadProgress}%`}
                                        {uploadProgress === 100 && 'Processing...'}
                                    </div>
                                </div>
                            )}
                            <button
                                type="submit"
                                disabled={isUploading}
                                className={`w-full py-2 px-4 bg-primary-brand-500 text-white font-semibold rounded-md shadow-sm ${isUploading ? 'opacity-50 cursor-not-allowed' : 'hover:bg-primary-brand-700'}`}
                            >
                                {isUploading ? 'Uploading...' : 'Upload Track'}
                            </button>
                        </form>
                    </div>
                </div>
            )}

            {/* Invite Collaborator Form */}
            {showInviteForm && selectedCollaboration && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className="bg-[#111827] border border-white/10 p-6 rounded-xl shadow-xl max-w-md w-full text-gray-100">
                        <div className="flex justify-between items-center mb-4">
                            <h2 className="text-xl font-bold text-white">Invite Collaborator</h2>
                            <button
                                onClick={() => setShowInviteForm(false)}
                                className="text-primary-brand-300 hover:text-primary-brand-200"
                            >
                                <XMarkIcon className="w-6 h-6" />
                            </button>
                        </div>
                        {error && <p className="text-red-400 text-sm mb-4">{error}</p>}
                        <form onSubmit={handleInviteSubmit} className="space-y-6">
                            <div>
                                <label className="block text-sm font-medium text-gray-200">Email</label>
                                <input
                                    type="email"
                                    name="email"
                                    value={inviteForm.email}
                                    onChange={handleInviteInputChange}
                                    required
                                    className="mt-1 block w-full px-3 py-2 border border-white/10 rounded-md shadow-sm bg-white/5 text-white"
                                />
                            </div>
                            <div>
                                <label className="flex items-center">
                                    <input
                                        type="checkbox"
                                        name="can_upload"
                                        checked={inviteForm.can_upload}
                                        onChange={handleInviteInputChange}
                                        className="mr-2"
                                    />
                                    Allow Uploads
                                </label>
                            </div>
                            <button
                                type="submit"
                                className="w-full py-2 px-4 bg-primary-brand-500 text-white font-semibold rounded-md shadow-sm hover:bg-primary-brand-700"
                            >
                                Send Invitation
                            </button>
                        </form>
                    </div>
                </div>
            )}

            {/* Record Modal */}
            <RecordModal
                isOpen={showRecordModal}
                onClose={() => setShowRecordModal(false)}
                tracks={selectedCollaboration?.tracks || []}
                onStartRecording={startRecording}
                onStopRecording={stopRecording}
                isRecording={isRecording}
            />

            {/* Confirmation Modal */}
            <ConfirmDeleteModal
                isOpen={showConfirmModal}
                onClose={closeConfirmModal}
                onConfirm={confirmAction}
                title={confirmTitle}
                message={confirmMessage}
            />

            {/* Invite Response Modal */}
            <ConfirmInviteModal
                isOpen={showInviteModal}
                onClose={closeInviteModal}
                onConfirm={() => handleInviteAction(selectedInvite)}
                invite={selectedInvite}
            />
        </div>
    );
};

export default CollaborationsManager;