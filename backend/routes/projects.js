const express = require('express');
const pool = require('../config/database');
const authenticate = require('../middleware/authenticate');
const router = express.Router();

// Get public projects (no authentication required)
router.get('/public', async (req, res) => {
    try {
        const projects = await pool.query(
            `SELECT p.id, p.title, p.created_at, p.user_id,
                    COALESCE(pr.name, u.name) AS creator_name, pr.id AS profile_id, pr.picture_url
             FROM projects p
                      JOIN users u ON p.user_id = u.id
                      LEFT JOIN profiles pr ON p.user_id = pr.user_id
             WHERE p.is_public = ?
             ORDER BY p.created_at DESC`,
            [true]
        );
        res.json(projects.map(project => ({
            id: Number(project.id),
            title: project.title,
            created_at: project.created_at,
            user_id: Number(project.user_id),
            creator: project.creator_name,
            profile_id: project.profile_id ? Number(project.profile_id) : null,
            picture_url: project.picture_url || null
        })));
    } catch (err) {
        console.error('Error in GET /projects/public:', {
            message: err.message,
            stack: err.stack,
        });
        res.status(500).json({ error: 'Failed to fetch public projects: ' + err.message });
    }
});

// backend/routes/projects.js
router.get('/public/:projectId', async (req, res) => {
    const { projectId } = req.params;
    try {
        const projects = await pool.query(
            `SELECT p.id, p.title, p.created_at, p.is_public, p.user_id, p.bpm,
                    COALESCE(pr.name, u.name) AS creator_name, pr.id AS profile_id, pr.picture_url
             FROM projects p
                      JOIN users u ON p.user_id = u.id
                      LEFT JOIN profiles pr ON p.user_id = pr.user_id
             WHERE p.id = ? AND p.is_public = ?`,
            [projectId, true]
        );
        if (!projects.length) {
            return res.status(404).json({ error: `Public project ${projectId} not found` });
        }
        const tracks = await pool.query(
            'SELECT id, name, track_order, track_type, midi_notes, instrument_type, is_polyphonic, synth_settings FROM tracks WHERE project_id = ? ORDER BY track_order',
            [projectId]
        );
        const projectSamples = await pool.query(
            `SELECT ps.id, ps.track_id, ps.sample_id, ps.start_time, sl.mp3_url, sl.name
             FROM project_samples ps
                      JOIN sample_library sl ON ps.sample_id = sl.id
             WHERE ps.track_id IN (SELECT id FROM tracks WHERE project_id = ?)`,
            [projectId]
        );
        res.json({
            project: {
                id: Number(projects[0].id),
                title: projects[0].title,
                created_at: projects[0].created_at,
                is_public: projects[0].is_public,
                user_id: Number(projects[0].user_id),
                creator: projects[0].creator_name,
                profile_id: projects[0].profile_id ? Number(projects[0].profile_id) : null,
                picture_url: projects[0].picture_url || null,
                bpm: Number(projects[0].bpm) || 120,
            },
            tracks: tracks.map(track => {
                let midiNotes = null;
                if (track.midi_notes) {
                    try {
                        midiNotes = typeof track.midi_notes === 'string' ? JSON.parse(track.midi_notes) : track.midi_notes;
                    } catch (e) {
                        console.error(`Failed to parse midi_notes for track ${track.id}:`, {
                            midi_notes: track.midi_notes,
                            error: e.message,
                        });
                        midiNotes = null;
                    }
                }
                let synthSettings = null;
                if (track.synth_settings) {
                    try {
                        synthSettings = typeof track.synth_settings === 'string' ? JSON.parse(track.synth_settings) : track.synth_settings;
                    } catch (e) {
                        console.error(`Failed to parse synth_settings for track ${track.id}:`, {
                            synth_settings: track.synth_settings,
                            error: e.message,
                        });
                        synthSettings = null;
                    }
                }
                return {
                    id: Number(track.id),
                    name: track.name,
                    track_order: Number(track.track_order),
                    track_type: track.track_type,
                    midi_notes: midiNotes,
                    instrument_type: track.instrument_type || 'synth',
                    is_polyphonic: Boolean(track.is_polyphonic),
                    synth_settings: synthSettings,
                };
            }),
            projectSamples: projectSamples.map(sample => ({
                id: Number(sample.id),
                track_id: Number(sample.track_id),
                sample_id: Number(sample.sample_id),
                start_time: Number(sample.start_time),
                mp3_url: sample.mp3_url,
                name: sample.name,
            })),
        });
    } catch (err) {
        console.error('Error in GET /projects/public/:projectId:', {
            message: err.message,
            stack: err.stack,
            projectId,
        });
        res.status(500).json({ error: 'Failed to fetch public project: ' + err.message });
    }
});

// List all projects for the authenticated user
router.get('/', authenticate, async (req, res) => {
    try {
        const queryResult = await pool.query(
            'SELECT id, title, created_at, is_public FROM projects WHERE user_id = ? ORDER BY created_at DESC',
            [req.user.id]
        );
        const projects = queryResult;
        res.json(Array.isArray(projects) ? projects : []);
    } catch (err) {
        console.error('Error in GET /projects:', {
            message: err.message,
            stack: err.stack,
            userId: req.user.id,
        });
        res.status(500).json({ error: 'Failed to fetch projects: ' + err.message });
    }
});

// Create a new project
router.post('/', authenticate, async (req, res) => {
    const { title, is_public = false } = req.body;
    if (!title) {
        return res.status(400).json({ error: 'Title is required' });
    }
    try {
        const result = await pool.query(
            'INSERT INTO projects (user_id, title, is_public) VALUES (?, ?, ?)',
            [req.user.id, title, is_public]
        );
        res.status(201).json({ id: Number(result.insertId), title, created_at: new Date(), is_public });
    } catch (err) {
        console.error('Error in POST /projects:', err);
        res.status(500).json({ error: 'Failed to create project: ' + err.message });
    }
});

// Get project details
router.get('/:projectId', authenticate, async (req, res) => {
    const { projectId } = req.params;
    try {
        const projects = await pool.query(
            'SELECT id, title, created_at, is_public FROM projects WHERE id = ? AND user_id = ?',
            [projectId, req.user.id]
        );
        if (!projects.length) {
            const existingProject = await pool.query(
                'SELECT id, user_id FROM projects WHERE id = ?',
                [projectId]
            );
            if (existingProject.length) {
                return res.status(403).json({ error: `Project ${projectId} exists but belongs to user ${existingProject[0].user_id}` });
            }
            return res.status(404).json({ error: `Project ${projectId} not found` });
        }
        const tracks = await pool.query(
            'SELECT id, project_id, name, track_order, track_type, midi_notes, volume, instrument_type, is_polyphonic, synth_settings, effects_settings FROM tracks WHERE project_id = ? ORDER BY track_order',
            [projectId]
        );
        const projectSamples = await pool.query(
            `SELECT ps.id, ps.track_id, ps.sample_id, ps.start_time, sl.mp3_url, sl.name
             FROM project_samples ps
                      JOIN sample_library sl ON ps.sample_id = sl.id
             WHERE ps.track_id IN (SELECT id FROM tracks WHERE project_id = ?)`,
            [projectId]
        );
        const librarySamples = await pool.query(
            'SELECT id, name, mp3_url FROM sample_library WHERE user_id = ?',
            [req.user.id]
        );

        const defaultSynthSettings = {
            synthParams: {
                harmonicity: 1,
                modulationIndex: 10,
                vibratoRate: 5,
                vibratoAmount: 0.5,
                detune: 0,
                pitchDecay: 0.05,
                octaves: 10,
                resonance: 1500,
                frequency: 100
            },
            envelope: {
                attack: 0.01,
                decay: 0.2,
                sustain: 0.5,
                release: 1
            },
            voice0: { detune: 0 }
        };

        res.json({
            project: { ...projects[0], id: Number(projects[0].id) },
            tracks: tracks.map(track => {
                let midiNotes = null;
                if (track.midi_notes) {
                    try {
                        midiNotes = typeof track.midi_notes === 'string' ? JSON.parse(track.midi_notes) : track.midi_notes;
                    } catch (e) {
                        console.error(`Failed to parse midi_notes for track ${track.id}:`, e.message);
                        midiNotes = null;
                    }
                }
                let synthSettings = null;
                if (track.synth_settings) {
                    try {
                        synthSettings = typeof track.synth_settings === 'string' ? JSON.parse(track.synth_settings) : track.synth_settings;
                    } catch (e) {
                        console.error(`Failed to parse synth_settings for track ${track.id}:`, e.message);
                        synthSettings = null;
                    }
                }
                let effectsSettings = {};
                if (track.effects_settings) {
                    try {
                        effectsSettings = typeof track.effects_settings === 'string' ? JSON.parse(track.effects_settings) : track.effects_settings;
                    } catch (e) {
                        console.error(`Failed to parse effects_settings for track ${track.id}:`, e.message);
                        effectsSettings = {};
                    }
                }
                if (track.track_type === 'midi' && !synthSettings) {
                    synthSettings = { ...defaultSynthSettings };
                    if (track.instrument_type === 'duosynth') {
                        synthSettings.synthParams = {
                            ...synthSettings.synthParams,
                            harmonicity: 1.5,
                            vibratoRate: 5,
                            vibratoAmount: 0.5
                        };
                    }
                }
                return {
                    ...track,
                    id: Number(track.id),
                    project_id: Number(track.project_id),
                    track_order: Number(track.track_order),
                    track_type: track.track_type,
                    midi_notes: midiNotes,
                    volume: Number(track.volume) || 1.0,
                    instrument_type: track.instrument_type || 'synth',
                    is_polyphonic: Boolean(track.is_polyphonic),
                    synth_settings: synthSettings,
                    effects_settings: effectsSettings
                };
            }),
            projectSamples: projectSamples.map(sample => ({
                ...sample,
                id: Number(sample.id),
                track_id: Number(sample.track_id),
                sample_id: Number(sample.sample_id),
                start_time: Number(sample.start_time),
            })),
            librarySamples: librarySamples.map(sample => ({ ...sample, id: Number(sample.id) })),
        });
    } catch (err) {
        console.error('Error in GET /projects/:projectId:', err);
        res.status(500).json({ error: 'Failed to fetch project: ' + err.message });
    }
});

// Add a new track (support track_type)
router.post('/:projectId/tracks', authenticate, async (req, res) => {
    const { projectId } = req.params;
    const { name, track_type = 'sample' } = req.body;
    if (!name) {
        return res.status(400).json({ error: 'Track name is required' });
    }
    if (!['sample', 'midi'].includes(track_type)) {
        return res.status(400).json({ error: 'Invalid track type' });
    }
    try {
        const project = await pool.query(
            'SELECT id FROM projects WHERE id = ? AND user_id = ?',
            [projectId, req.user.id]
        );
        if (!project.length) {
            return res.status(404).json({ error: 'Project not found' });
        }
        const trackCount = await pool.query(
            'SELECT COUNT(*) as count FROM tracks WHERE project_id = ?',
            [projectId]
        );
        const trackOrder = Number(trackCount[0].count) + 1;

        let instrument_type = null;
        let synth_settings = null;
        let effects_settings = {}; // Initialize empty effects settings
        if (track_type === 'midi') {
            instrument_type = 'synth';
            synth_settings = {
                synthParams: {
                    harmonicity: 1,
                    modulationIndex: 10,
                    vibratoRate: 5,
                    vibratoAmount: 0.5,
                    detune: 0,
                    pitchDecay: 0.05,
                    octaves: 10,
                    resonance: 1500,
                    frequency: 100
                },
                envelope: {
                    attack: 0.01,
                    decay: 0.2,
                    sustain: 0.5,
                    release: 1
                },
                voice0: { detune: 0 }
            };
        }

        const result = await pool.query(
            'INSERT INTO tracks (project_id, name, track_order, track_type, instrument_type, synth_settings, effects_settings) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [projectId, name, trackOrder, track_type, instrument_type, synth_settings ? JSON.stringify(synth_settings) : null, JSON.stringify(effects_settings)]
        );
        res.status(201).json({
            id: Number(result.insertId),
            name,
            track_order: trackOrder,
            track_type,
            midi_notes: null,
            instrument_type,
            synth_settings,
            effects_settings
        });
    } catch (err) {
        console.error('Error in POST /projects/:projectId/tracks:', err);
        res.status(500).json({ error: 'Failed to add track: ' + err.message });
    }
});

// Delete a track
router.delete('/:projectId/tracks/:trackId', authenticate, async (req, res) => {
    const { projectId, trackId } = req.params;
    try {
        const project = await pool.query(
            'SELECT id FROM projects WHERE id = ? AND user_id = ?',
            [projectId, req.user.id]
        );
        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }
        const track = await pool.query(
            'SELECT id FROM tracks WHERE id = ? AND project_id = ?',
            [trackId, projectId]
        );
        if (!track) {
            return res.status(404).json({ error: 'Track not found' });
        }
        await pool.query('DELETE FROM tracks WHERE id = ?', [trackId]);
        const [tracks] = await pool.query(
            'SELECT id FROM tracks WHERE project_id = ? ORDER BY track_order',
            [projectId]
        );
        for (let i = 0; i < tracks.length; i++) {
            await pool.query(
                'UPDATE tracks SET track_order = ? WHERE id = ?',
                [i + 1, tracks[i].id]
            );
        }
        res.status(200).json({ message: 'Track deleted' });
    } catch (err) {
        console.error('Error in DELETE /projects/:projectId/tracks/:trackId:', err);
        res.status(500).json({ error: 'Failed to delete track: ' + err.message });
    }
});

// Update MIDI notes for a MIDI track
router.put('/:projectId/tracks/:trackId/midi', authenticate, async (req, res) => {
    const { projectId, trackId } = req.params;
    const { midi_notes } = req.body;
    if (!midi_notes) {
        return res.status(400).json({ error: 'MIDI notes are required' });
    }
    try {
        const [project] = await pool.query(
            'SELECT id FROM projects WHERE id = ? AND user_id = ?',
            [projectId, req.user.id]
        );
        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }
        const [track] = await pool.query(
            'SELECT id, track_type FROM tracks WHERE id = ? AND project_id = ?',
            [trackId, projectId]
        );
        if (!track) {
            return res.status(404).json({ error: 'Track not found' });
        }
        if (track.track_type !== 'midi') {
            return res.status(400).json({ error: 'Track is not a MIDI track' });
        }
        // Validate and store midi_notes as JSON
        try {
            JSON.parse(JSON.stringify(midi_notes)); // Ensure it's JSON-serializable
        } catch (e) {
            return res.status(400).json({ error: 'Invalid MIDI notes format' });
        }
        await pool.query(
            'UPDATE tracks SET midi_notes = ? WHERE id = ?',
            [JSON.stringify(midi_notes), trackId]
        );
        res.status(200).json({ message: 'MIDI notes updated', midi_notes });
    } catch (err) {
        console.error('Error in PUT /projects/:projectId/tracks/:trackId/midi:', err);
        res.status(500).json({ error: 'Failed to update MIDI notes: ' + err.message });
    }
});

// Rename a track
router.put('/:projectId/tracks/:trackId', authenticate, async (req, res) => {
    const { projectId, trackId } = req.params;
    const { name, volume, instrument_type, is_polyphonic, synth_settings, effects_settings } = req.body;

    // Validate inputs
    if (name === undefined && volume === undefined && instrument_type === undefined && is_polyphonic === undefined && synth_settings === undefined && effects_settings === undefined) {
        console.log('Validation failed: No fields provided');
        return res.status(400).json({ error: 'At least one field is required' });
    }
    if (name !== undefined && !name.trim()) {
        return res.status(400).json({ error: 'Track name cannot be empty' });
    }
    if (volume !== undefined && (typeof volume !== 'number' || volume < 0 || volume > 1)) {
        return res.status(400).json({ error: 'Volume must be a number between 0 and 1' });
    }
    if (instrument_type !== undefined && !['synth', 'amsynth', 'fmsynth', 'metalsynth', 'duosynth', 'membranesynth', 'drumsampler'].includes(instrument_type)) {
        return res.status(400).json({ error: 'Invalid instrument type' });
    }
    if (is_polyphonic !== undefined && typeof is_polyphonic !== 'boolean') {
        return res.status(400).json({ error: 'is_polyphonic must be a boolean' });
    }
    if (synth_settings !== undefined && instrument_type !== 'drumsampler') {
        try {
            if (typeof synth_settings !== 'object' || synth_settings === null) {
                return res.status(400).json({ error: 'synth_settings must be an object' });
            }
            const { synthParams, envelope, voice0 } = synth_settings;
            if (synthParams && typeof synthParams !== 'object') {
                return res.status(400).json({ error: 'synthParams must be an object' });
            }
            if (envelope && typeof envelope !== 'object') {
                return res.status(400).json({ error: 'envelope must be an object' });
            }
            if (voice0 && typeof voice0 !== 'object') {
                return res.status(400).json({ error: 'voice0 must be an object' });
            }
            if (synthParams) {
                if (synthParams.harmonicity !== undefined && (typeof synthParams.harmonicity !== 'number' || synthParams.harmonicity < 0.1 || synthParams.harmonicity > 5)) {
                    return res.status(400).json({ error: 'harmonicity must be a number between 0.1 and 5' });
                }
                if (synthParams.modulationIndex !== undefined && (typeof synthParams.modulationIndex !== 'number' || synthParams.modulationIndex < 0 || synthParams.modulationIndex > 20)) {
                    return res.status(400).json({ error: 'modulationIndex must be a number between 0 and 20' });
                }
                if (synthParams.vibratoRate !== undefined && (typeof synthParams.vibratoRate !== 'number' || synthParams.vibratoRate < 0 || synthParams.vibratoRate > 10)) {
                    return res.status(400).json({ error: 'vibratoRate must be a number between 0 and 10' });
                }
                if (synthParams.detune !== undefined && (typeof synthParams.detune !== 'number' || synthParams.detune < -100 || synthParams.detune > 100)) {
                    return res.status(400).json({ error: 'detune must be a number between -100 and 100' });
                }
                if (instrument_type === 'duosynth' && synthParams.vibratoAmount !== undefined && (typeof synthParams.vibratoAmount !== 'number' || synthParams.vibratoAmount < 0 || synthParams.vibratoAmount > 5)) {
                    return res.status(400).json({ error: 'vibratoAmount must be a number between 0 and 5' });
                }
            }
            if (envelope) {
                if (envelope.attack !== undefined && (typeof envelope.attack !== 'number' || envelope.attack < 0.001 || envelope.attack > 1)) {
                    return res.status(400).json({ error: 'attack must be a number between 0.001 and 1' });
                }
                if (envelope.decay !== undefined && (typeof envelope.decay !== 'number' || envelope.decay < 0.001 || envelope.decay > 1)) {
                    return res.status(400).json({ error: 'decay must be a number between 0.001 and 1' });
                }
                if (envelope.sustain !== undefined && (typeof envelope.sustain !== 'number' || envelope.sustain < 0 || envelope.sustain > 1)) {
                    return res.status(400).json({ error: 'sustain must be a number between 0 and 1' });
                }
                if (envelope.release !== undefined && (typeof envelope.release !== 'number' || envelope.release < 0.001 || envelope.release > 2)) {
                    return res.status(400).json({ error: 'release must be a number between 0.001 and 2' });
                }
            }
            if (voice0 && voice0.detune !== undefined && (typeof voice0.detune !== 'number' || voice0.detune < -50 || voice0.detune > 50)) {
                return res.status(400).json({ error: 'voice0.detune must be a number between -50 and 50' });
            }
            JSON.stringify(synth_settings);
        } catch (e) {
            return res.status(400).json({ error: 'Invalid synth_settings format' });
        }
    }
    if (effects_settings !== undefined) {
        try {
            if (typeof effects_settings !== 'object' || effects_settings === null) {
                console.log('Validation failed: effects_settings is not an object', effects_settings);
                return res.status(400).json({ error: 'effects_settings must be an object' });
            }
            for (const [effect, params] of Object.entries(effects_settings)) {
                if (!['reverb', 'delay', 'distortion'].includes(effect)) {
                    console.log('Validation failed: Unsupported effect', effect);
                    return res.status(400).json({ error: `Unsupported effect: ${effect}` });
                }
                if (typeof params !== 'object' || params === null) {
                    console.log('Validation failed: Effect params not an object', { effect, params });
                    return res.status(400).json({ error: `${effect} parameters must be an object` });
                }
                if (effect === 'reverb') {
                    if (params.decay !== undefined && (typeof params.decay !== 'number' || params.decay < 0.1 || params.decay > 10)) {
                        console.log('Validation failed: Invalid reverb.decay', params.decay);
                        return res.status(400).json({ error: 'reverb.decay must be a number between 0.1 and 10' });
                    }
                    if (params.wet !== undefined && (typeof params.wet !== 'number' || params.wet < 0 || params.wet > 1)) {
                        console.log('Validation failed: Invalid reverb.wet', params.wet);
                        return res.status(400).json({ error: 'reverb.wet must be a number between 0 and 1' });
                    }
                }
                if (effect === 'delay') {
                    if (params.delayTime !== undefined && (typeof params.delayTime !== 'number' || params.delayTime < 0 || params.delayTime > 2)) {
                        console.log('Validation failed: Invalid delay.delayTime', params.delayTime);
                        return res.status(400).json({ error: 'delay.delayTime must be a number between 0 and 2' });
                    }
                    if (params.wet !== undefined && (typeof params.wet !== 'number' || params.wet < 0 || params.wet > 1)) {
                        console.log('Validation failed: Invalid delay.wet', params.wet);
                        return res.status(400).json({ error: 'delay.wet must be a number between 0 and 1' });
                    }
                }
                if (effect === 'distortion') {
                    if (params.distortion !== undefined && (typeof params.distortion !== 'number' || params.distortion < 0 || params.distortion > 1)) {
                        console.log('Validation failed: Invalid distortion.distortion', params.distortion);
                        return res.status(400).json({ error: 'distortion.distortion must be a number between 0 and 1' });
                    }
                    if (params.wet !== undefined && (typeof params.wet !== 'number' || params.wet < 0 || params.wet > 1)) {
                        console.log('Validation failed: Invalid distortion.wet', params.wet);
                        return res.status(400).json({ error: 'distortion.wet must be a number between 0 and 1' });
                    }
                }
            }
            console.log('effects_settings validated successfully:', effects_settings);
            JSON.stringify(effects_settings);
        } catch (e) {
            console.log('Validation failed: Invalid effects_settings format', e.message);
            return res.status(400).json({ error: 'Invalid effects_settings format' });
        }
    }

    try {
        const [project] = await pool.query(
            'SELECT id FROM projects WHERE id = ? AND user_id = ?',
            [projectId, req.user.id]
        );
        if (!project) {
            console.log('Project not found:', projectId);
            return res.status(404).json({ error: 'Project not found' });
        }
        const [track] = await pool.query(
            'SELECT id, track_type FROM tracks WHERE id = ? AND project_id = ?',
            [trackId, projectId]
        );
        if (!track) {
            console.log('Track not found:', trackId);
            return res.status(404).json({ error: 'Track not found' });
        }
        if ((instrument_type !== undefined || is_polyphonic !== undefined || synth_settings !== undefined) && track.track_type !== 'midi') {
            console.log('Validation failed: MIDI-only settings on non-MIDI track');
            return res.status(400).json({ error: 'Instrument type, polyphonic settings, and synth settings are only valid for MIDI tracks' });
        }

        const updates = [];
        const values = [];
        if (name !== undefined) {
            updates.push('name = ?');
            values.push(name.trim());
        }
        if (volume !== undefined) {
            updates.push('volume = ?');
            values.push(volume);
        }
        if (instrument_type !== undefined) {
            updates.push('instrument_type = ?');
            values.push(instrument_type);
        }
        if (is_polyphonic !== undefined) {
            updates.push('is_polyphonic = ?');
            values.push(is_polyphonic);
        }
        if (synth_settings !== undefined) {
            updates.push('synth_settings = ?');
            values.push(JSON.stringify(synth_settings));
        }
        if (effects_settings !== undefined) {
            updates.push('effects_settings = ?');
            values.push(JSON.stringify(effects_settings));
        }
        values.push(trackId);

        const setClause = updates.join(', ');
        await pool.query(`UPDATE tracks SET ${setClause} WHERE id = ?`, values);
        res.status(200).json({ message: 'Track updated' });
    } catch (err) {
        console.error('Error in PUT /projects/:projectId/tracks/:trackId:', {
            message: err.message,
            stack: err.stack,
            projectId,
            trackId,
            body: req.body
        });
        res.status(500).json({ error: 'Failed to update track: ' + err.message });
    }
});

// Place a sample in a project
router.post('/:projectId/samples', authenticate, async (req, res) => {
    const { projectId } = req.params;
    const { track_id, sample_id, start_time } = req.body;
    if (!track_id || !sample_id || start_time == null) {
        return res.status(400).json({
            error: 'Track ID, sample ID, and start time are required',
        });
    }
    try {
        const project = await pool.query(
            'SELECT id FROM projects WHERE id = ? AND user_id = ?',
            [projectId, req.user.id]
        );
        if (!project.length) {
            return res.status(404).json({ error: 'Project not found' });
        }
        const track = await pool.query(
            'SELECT id FROM tracks WHERE id = ? AND project_id = ?',
            [track_id, projectId]
        );
        if (!track.length) {
            return res.status(404).json({ error: 'Track not found' });
        }
        const sample = await pool.query(
            'SELECT id FROM sample_library WHERE id = ? AND user_id = ?',
            [sample_id, req.user.id]
        );
        if (!sample.length) {
            return res.status(404).json({ error: 'Sample not found in library' });
        }
        const result = await pool.query(
            'INSERT INTO project_samples (track_id, sample_id, start_time) VALUES (?, ?, ?)',
            [track_id, sample_id, start_time]
        );
        const newSample = await pool.query(
            `SELECT ps.id, ps.track_id, ps.sample_id, ps.start_time, sl.mp3_url, sl.name
       FROM project_samples ps
       JOIN sample_library sl ON ps.sample_id = sl.id
       WHERE ps.id = ?`,
            [result.insertId]
        );
        res.status(201).json({
            ...newSample[0],
            id: Number(newSample[0].id),
            track_id: Number(newSample[0].track_id),
            sample_id: Number(newSample[0].sample_id),
            start_time: Number(newSample[0].start_time),
        });
    } catch (err) {
        console.error('Error in POST /projects/:projectId/samples:', err);
        res.status(500).json({ error: 'Failed to place sample: ' + err.message });
    }
});

// Remove a sample from a project
router.delete('/:projectId/samples/:sampleId', authenticate, async (req, res) => {
    const { projectId, sampleId } = req.params;
    try {
        const project = await pool.query(
            'SELECT id FROM projects WHERE id = ? AND user_id = ?',
            [projectId, req.user.id]
        );
        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }
        const sample = await pool.query(
            'SELECT id FROM project_samples WHERE id = ? AND track_id IN (SELECT id FROM tracks WHERE project_id = ?)',
            [sampleId, projectId]
        );
        if (!sample) {
            return res.status(404).json({ error: 'Sample not found' });
        }
        await pool.query('DELETE FROM project_samples WHERE id = ?', [sampleId]);
        res.status(200).json({ message: 'Sample removed from project' });
    } catch (err) {
        console.error('Error in DELETE /projects/:projectId/samples/:sampleId:', err);
        res.status(500).json({ error: 'Failed to remove sample: ' + err.message });
    }
});

router.delete('/:projectId', authenticate, async (req, res) => {
    const { projectId } = req.params;
    const userId = req.user.id;

    let connection;
    try {
        // Start transaction
        connection = await pool.getConnection();
        await connection.beginTransaction();

        // Verify project ownership
        const project = await connection.query(
            'SELECT id, user_id FROM projects WHERE id = ? AND user_id = ?',
            [projectId, userId]
        );
        if (!project.length) {
            await connection.rollback();
            return res.status(404).json({ error: 'Project not found or you lack permission' });
        }

        // Delete the project (cascades to tracks and project_samples)
        await connection.query('DELETE FROM projects WHERE id = ?', [projectId]);

        // Commit transaction
        await connection.commit();
        res.status(200).json({ message: 'Project deleted successfully' });
    } catch (err) {
        if (connection) await connection.rollback();
        console.error('Error in DELETE /projects/:projectId:', {
            message: err.message,
            stack: err.stack,
            projectId,
            userId,
        });
        res.status(500).json({ error: 'Failed to delete project: ' + err.message });
    } finally {
        if (connection) connection.release();
    }
});

router.put('/:projectId', authenticate, async (req, res) => {
    const { projectId } = req.params;
    const { title, is_public } = req.body;
    try {
        const project = await pool.query(
            'SELECT id FROM projects WHERE id = ? AND user_id = ?',
            [projectId, req.user.id]
        );
        if (!project.length) {
            return res.status(404).json({ error: 'Project not found' });
        }
        const updates = {};
        const values = [];
        if (title !== undefined) {
            if (!title.trim()) {
                return res.status(400).json({ error: 'Title cannot be empty' });
            }
            updates.title = title.trim();
            values.push(title.trim());
        }
        if (is_public !== undefined) {
            updates.is_public = is_public;
            values.push(is_public);
        }
        if (Object.keys(updates).length === 0) {
            return res.status(400).json({ error: 'No valid fields to update' });
        }
        const setClause = Object.keys(updates).map(key => `${key} = ?`).join(', ');
        values.push(projectId);
        await pool.query(
            `UPDATE projects SET ${setClause} WHERE id = ?`,
            values
        );
        res.status(200).json({ message: 'Project updated' });
    } catch (err) {
        console.error('Error in PUT /projects/:projectId:', err);
        res.status(500).json({ error: 'Failed to update project: ' + err.message });
    }
});

module.exports = router;