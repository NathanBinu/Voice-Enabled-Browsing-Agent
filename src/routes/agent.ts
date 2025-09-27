// import { Router } from 'express';
// import { synthesize } from '../Feedback/tts.js';
// import { executeInBrowserbase } from '../executor/browserbase.js';
// import { confidenceGate } from '../middleware/confidenceGate.js';
// import { parseIntent } from '../nlu/intent.js';
// import { planFromCommand } from '../planner/plan.js';

// export const agentRouter = Router();

// /** POST /api/agent/parse
//  * Convert a transcript (utterance) → Command JSON via LLM.
//  */
// agentRouter.post('/parse', async (req, res) => {
//   const utterance: string = req.body?.utterance ?? '';
//   if (!utterance) return res.status(400).json({ error: 'Missing utterance' });

//   const cmd = await parseIntent(utterance);
//   res.json(cmd);
// });

// /** POST /api/agent/execute
//  * Execute a Command JSON (blocked by confidenceGate when low confidence).
//  */
// agentRouter.post('/execute', confidenceGate(0.7, 2), async (req, res) => {
//   // Build a plan (MVP pass-through).
//   const cmd = planFromCommand(req.body);

//   // Execute the plan in a real browser session (Browserbase).
//     //const artifacts: { screenshots: string[]; table?: any[] } = await executeInBrowserbase(cmd);
//     const { artifacts, answer } = await executeInBrowserbase(cmd);

//     // Generate a short human-friendly summary for TTS.
//     const summary =
//         answer?.trim()
//             ? answer
//             : (artifacts.table && artifacts.table.length > 0)
//                 ? `I found ${artifacts.table.length} result${artifacts.table.length === 1 ? '' : 's'} and saved screenshots.`
//                 : `I completed the requested steps and saved screenshots.`;


//   // Speak the summary using Deepgram TTS.
//   const audioPath = await synthesize(summary);

//   // Send everything to the client.
//   res.json({
//     status: 'done',
//     summary,
//     tts: audioPath,
//     artifacts,
//     answer  // include the exact answer text too
//   });
// });

//------------------------------------------------------------------------------------------------

import { Router } from 'express';
import { synthesize } from '../Feedback/tts.js';
import { executeInBrowserbase } from '../executor/browserbase.js';
import { executeWithStagehand } from '../executor/stagehand.js';
import { confidenceGate } from '../middleware/confidenceGate.js';
import { parseIntent } from '../nlu/intent.js';
import { planFromCommand } from '../planner/plan.js';
import { log, warn } from '../utils/logger.js';

export const agentRouter = Router();

agentRouter.post('/parse', async (req, res) => {
  const utterance: string = req.body?.utterance ?? '';
  if (!utterance) return res.status(400).json({ error: 'Missing utterance' });

  const cmd = await parseIntent(utterance);
  res.json(cmd);
});

agentRouter.post('/execute', confidenceGate(0.7, 2), async (req, res) => {
    const cmd = planFromCommand(req.body);
  
    const useStagehand = process.env.USE_STAGEHAND !== '0';
    log(`Executor selected: ${useStagehand ? 'Stagehand' : 'Browserbase'}`);
  
    let result: any;
    try {
      result = useStagehand
        ? await executeWithStagehand(cmd)
        : await executeInBrowserbase(cmd);
    } catch (e) {
      // Absolute safety net: if Stagehand throws, or anything else does,
      // fall back to Browserbase executor.
      warn(`Primary executor failed: ${(e as Error).message}. Falling back to Browserbase…`);
      result = await executeInBrowserbase(cmd);
    }
  
    const spoken =
      (result as any).answer ??
      (result?.artifacts?.table?.length
        ? `I found ${result.artifacts.table.length} results.`
        : `I completed the requested steps.`);
  
    const audioPath = await synthesize(spoken);
  
    res.json({
      status: 'done',
      answer: spoken,
      tts: audioPath,
      artifacts: result.artifacts,
    });
});