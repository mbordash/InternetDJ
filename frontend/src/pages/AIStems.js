import React, { useState, useContext, useEffect } from 'react';
import axios from 'axios';
import { AuthContext } from '../context/AuthContext';
import API_URL from '../utils/api';
import SITE_URL from '../utils/site';
import { Helmet } from "react-helmet-async";
function AIStems() {
    const { user } = useContext(AuthContext);
    const baseUrl = SITE_URL;
    const [type, setType] = useState('bass');
    const [prompt, setPrompt] = useState('');
    const [bpm, setBpm] = useState(128);
    const [key, setKey] = useState('C minor');
    const [duration, setDuration] = useState(3);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [userStems, setUserStems] = useState([]);
    const [dailyRemaining, setDailyRemaining] = useState(5);
    const [highlightedStemId, setHighlightedStemId] = useState(null);
    const [copyingStemId, setCopyingStemId] = useState(null);

    useEffect(() => {
        if (user && user.id) {
            fetchUserStems();
        }
    }, [user]);

    const fetchUserStems = async () => {
        try {
            const token = localStorage.getItem('token');
            const res = await axios.get(`${API_URL}/stems/my`, { headers: { Authorization: `Bearer ${token}` } });
            setUserStems(res.data.stems);
            setDailyRemaining(res.data.dailyRemaining);
        } catch (err) {
            console.error('Failed to fetch user stems', err);
        }
    };

    const generate = async () => {
        if (!user || !user.id) {
            setError('You must be logged in to generate stems.');
            return;
        }

        if (dailyRemaining <= 0) {
            setError('Daily limit of 5 stems reached');
            return;
        }

        setLoading(true);
        setError(null);
        try {
            const token = localStorage.getItem('token');
            if (!token) {
                throw new Error('No authentication token found');
            }

            const res = await axios.post(`${API_URL}/stems/generate`,
                { type, prompt, bpm, key, duration },
                { headers: { Authorization: `Bearer ${token}` }, withCredentials: true }
            );
            const { stemId } = res.data;

            const poll = setInterval(async () => {
                try {
                    const statusRes = await axios.get(`${API_URL}/stems/${stemId}`,
                        { headers: { Authorization: `Bearer ${token}` }, withCredentials: true }
                    );
                    const data = statusRes.data;
                    if (data.status === 'ready') {
                        clearInterval(poll);
                        fetchUserStems(); // Refresh list and remaining count
                        setHighlightedStemId(stemId);
                        setTimeout(() => setHighlightedStemId(null), 3000); // Highlight for 3 seconds
                        setLoading(false);
                    } else if (data.status === 'failed') {
                        clearInterval(poll);
                        setError('Generation failed. Please try again.');
                        setLoading(false);
                    }
                } catch (pollErr) {
                    clearInterval(poll);
                    setError('Failed to check status: ' + (pollErr.response?.data?.error || pollErr.message));
                    setLoading(false);
                }
            }, 5000); // Poll every 5s (adjust based on gen time)
        } catch (err) {
            setError('Failed to start generation: ' + (err.response?.data?.error || err.message));
            setLoading(false);
        }
    };

    const copyToSampleLibrary = async (stemId) => {
        setCopyingStemId(stemId);
        try {
            const token = localStorage.getItem('token');
            await axios.post(`${API_URL}/sample-library/from-stem`,
                { stemId },
                { headers: { Authorization: `Bearer ${token}` }, withCredentials: true }
            );
            alert('Stem copied to your sample library!'); // Replace with toast if using a library
            fetchUserStems(); // Optional: Refresh stems if needed
        } catch (err) {
            alert('Failed to copy stem: ' + (err.response?.data?.error || err.message));
        } finally {
            setCopyingStemId(null);
        }
    };

    if (error) {
        return (
            <div className="text-gray-100 pt-2 min-h-screen flex items-center justify-center">
                <div className="container mx-auto px-4 py-8 text-center">
                    <p className="text-red-400 text-lg">{error}</p>
                    {!user ? (
                        <a
                            href="/login"
                            className="inline-block spotify-pill px-4 py-2 rounded-full transition-colors mt-4"
                        >
                            Log In
                        </a>
                    ) : (
                        <button
                            onClick={() => {
                                setError(null);
                            }}
                            className="inline-block spotify-pill px-4 py-2 rounded-full transition-colors mt-4"
                        >
                            Try Again
                        </button>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className="text-gray-100 pt-2 min-h-screen">
            <Helmet>
                <title>AI Music Stem Generator - InternetDJ</title>
                <meta
                    name="description"
                    content="Use our free AI music stem generator to create royalty-free AI bass stems, synth stems, effects, and drums. Perfect for music producers importing into DAWs like Ableton or Logic Pro."
                />
                <link rel="canonical" href={`${baseUrl}/ai-stems`} />
                <meta property="og:title" content="AI Music Stem Generator - InternetDJ" />
                <meta property="og:description" content="Generate AI-powered music stems for bass, synth, effects, and drums to import into your DAW. Best AI stem generator for creators." />
                <meta property="og:url" content={`${baseUrl}/ai-stems`} />
                <meta property="og:site_name" content="InternetDJ" />
                <meta name="twitter:card" content="summary_large_image" />
                <meta name="twitter:title" content="AI Music Stem Generator - InternetDJ" />
                <meta name="twitter:description" content="Generate AI-powered music stems for bass, synth, effects, and drums to import into your DAW. Best AI stem generator for creators." />
                <meta name="twitter:site" content="@internetdjco" />
            </Helmet>
            <div className="container mx-auto px-4 py-8">
                <h1 className="text-3xl font-bold mb-8 text-white text-center">AI Music Stem Generator</h1>
                <p className="text-center text-gray-300 mb-6 max-w-2xl mx-auto">
                    Discover the best AI music stem generator for creating high-quality, royalty-free stems. Generate AI bass stems, synth stems, effects, and drums tailored to your prompt, BPM, and key—perfect for music producers using DAWs like Ableton, Logic Pro, or FL Studio. Or try our own online DAW at <a href="/projects" className="text-primary-brand-300 hover:text-primary-brand-200 hover:underline">InternetDJ Projects</a> to integrate stems directly into your tracks.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="spotify-surface p-6">
                        <h2 className="text-xl font-bold mb-4 text-white">Generate AI Music Stems</h2>
                        <label htmlFor="type" className="block text-sm font-medium text-gray-300 mb-1">Stem Type</label>
                        <select
                            id="type"
                            value={type}
                            onChange={(e) => setType(e.target.value)}
                            className="w-full p-3 border border-white/10 rounded mb-4 bg-white/5 text-white"
                        >
                            <option value="bass">Bass</option>
                            <option value="synth">Synth</option>
                            <option value="effects">Effects</option>
                            <option value="drums">Drums</option>
                        </select>
                        <label htmlFor="prompt" className="block text-sm font-medium text-gray-300 mb-1">Prompt</label>
                        <textarea
                            id="prompt"
                            className="w-full p-3 border border-white/10 rounded mb-4 bg-white/5 text-white"
                            rows="3"
                            placeholder="e.g., 'deep rolling line with sub hits'"
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                        />
                        <div className="grid grid-cols-3 gap-4 mb-4">
                            <div>
                                <label htmlFor="bpm" className="block text-sm font-medium text-gray-300 mb-1">BPM</label>
                                <select
                                    id="bpm"
                                    value={bpm}
                                    onChange={(e) => setBpm(e.target.value)}
                                    className="w-full p-3 border border-white/10 rounded bg-white/5 text-white"
                                >
                                    {Array.from({length: 13}, (_, i) => 60 + i * 10).map(b => (
                                        <option key={b} value={b}>{b}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label htmlFor="key" className="block text-sm font-medium text-gray-300 mb-1">Key</label>
                                <select
                                    id="key"
                                    value={key}
                                    onChange={(e) => setKey(e.target.value)}
                                    className="w-full p-3 border border-white/10 rounded bg-white/5 text-white"
                                >
                                    {['C major', 'C minor', 'C# major', 'C# minor', 'D major', 'D minor', 'D# major', 'D# minor', 'E major', 'E minor', 'F major', 'F minor', 'F# major', 'F# minor', 'G major', 'G minor', 'G# major', 'G# minor', 'A major', 'A minor', 'A# major', 'A# minor', 'B major', 'B minor'].map(k => (
                                        <option key={k} value={k}>{k}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label htmlFor="duration" className="block text-sm font-medium text-gray-300 mb-1">Duration (sec)</label>
                                <select
                                    id="duration"
                                    value={duration}
                                    onChange={(e) => setDuration(Number(e.target.value))}
                                    className="w-full p-3 border border-white/10 rounded bg-white/5 text-white"
                                >
                                    <option value={2}>2</option>
                                    <option value={3}>3</option>
                                    <option value={4}>4</option>
                                    <option value={5}>5</option>
                                    <option value={6}>6</option>
                                    <option value={7}>7</option>
                                    <option value={8}>8</option>
                                    <option value={9}>9</option>
                                    <option value={10}>10</option>
                                </select>
                            </div>
                        </div>
                        <p className="text-sm text-gray-300 mb-2">You have {dailyRemaining} stems left today.</p>
                        <button
                            onClick={generate}
                            disabled={loading || !prompt || dailyRemaining <= 0}
                            className="w-full py-3 spotify-pill rounded-full"
                        >
                            {loading ? 'Generating...' : 'Create Stem'}
                        </button>
                    </div>
                    <div>
                        <h2 className="text-2xl font-bold mb-4 text-white">Your Recent AI-Generated Music Stems</h2>
                        <p className="text-gray-300 mb-6">
                            Note: Stems are automatically deleted after 24 hours.
                        </p>
                        {userStems.length === 0 ? (
                            <p className="text-gray-300">No recent stems found.</p>
                        ) : (
                            userStems.map(s => (
                                <div
                                    key={s.id}
                                    className={`spotify-surface p-4 mb-4 transition-colors duration-300 ${s.id === highlightedStemId ? 'ring-2 ring-primary-brand-400' : ''}`}
                                >
                                    <p className="font-semibold text-white">{s.type.toUpperCase()} Stem</p>
                                    <p className="text-sm text-gray-300">{s.prompt}</p>
                                    <p className="text-sm text-gray-300">BPM: {s.bpm}, Key: {s.key}, Duration: {s.duration}s</p>
                                    <p className="text-sm text-gray-300">Status: {s.status}</p>
                                    {s.status === 'ready' && s.url && (
                                        <div className="mt-2 space-y-2">
                                            <audio controls src={s.url} className="w-full" />
                                            <div className="flex space-x-2">
                                                <a
                                                    href={s.url}
                                                    download={`${s.type}-${s.id}.wav`}
                                                    className="inline-block spotify-pill px-3 py-1 rounded-full text-sm"
                                                >
                                                    Download WAV
                                                </a>
                                                <button
                                                    onClick={() => copyToSampleLibrary(s.id)}
                                                    disabled={copyingStemId === s.id}
                                                    className="inline-block spotify-pill px-3 py-1 rounded-full text-sm disabled:opacity-50"
                                                >
                                                    {copyingStemId === s.id ? 'Copying...' : 'Add to DAW Sample Library'}
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

export default AIStems;