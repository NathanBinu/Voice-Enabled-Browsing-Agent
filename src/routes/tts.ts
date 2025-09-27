import { Router } from 'express';
import { synthesize } from '../Feedback/tts.js';

export const ttsRouter = Router();

/** POST /api/tts/speak
 * Utility endpoint: text → mp3 path (uses Deepgram TTS).
 */
ttsRouter.post('/speak', async (req, res) => {
    const text: string = req.body?.text ?? '';
    if (!text) return res.status(400).json({ error: 'Missing text' });

    const path = await synthesize(text);
    res.json({ path });
});
