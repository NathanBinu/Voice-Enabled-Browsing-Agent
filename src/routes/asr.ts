import { Router } from 'express';
import multer from 'multer';
import { transcribeBuffer } from '../asr/deepgram.js';

const upload = multer();                   // parses multipart/form-data
export const asrRouter = Router();

/** POST /api/asr/transcribe
 * Accepts "audio" file (webm/ogg/wav) from the browser and returns transcript.
 */
asrRouter.post('/transcribe', upload.single('audio'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Missing audio' });

  const { text, confidence } = await transcribeBuffer(req.file.buffer);
  res.json({ transcript: text, asrConfidence: confidence });
});
