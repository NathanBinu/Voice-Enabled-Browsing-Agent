import 'dotenv/config'; // load .env before other imports
import express from 'express';
import path from 'node:path';
import { agentRouter } from './routes/agent.js';
import { asrRouter } from './routes/asr.js';
import { ttsRouter } from './routes/tts.js';
import { log } from './utils/logger.js';

const app = express();
app.use(express.json({ limit: '10mb' }));         // allow JSON bodies

// Serve the tiny web client from /web
app.use('/', express.static(path.join(process.cwd(), 'web')));

// Wire API routes
app.use('/api/asr', asrRouter);
app.use('/api/agent', agentRouter);
app.use('/api/tts', ttsRouter);

// Start the server
const port = Number(process.env.PORT || 3000);
app.listen(port, () => log(`Server running at http://localhost:${port}`));
