import { NextFunction, Request, Response } from 'express';
import { Command } from '../types/schemas.js';

/**
 * Middleware that blocks execution when confidence is low.
 * - if below threshold, returns a "confirm" response (202) to the client
 * - if too many retries, returns a "retry-limit" (409) to stop looping forever
 */
export function confidenceGate(threshold = 0.7, maxRetries = 2) {
    return (req: Request, res: Response, next: NextFunction) => {
        const cmd = req.body as Command;
        const retries = Number(req.query.retries ?? 0);

        // Confidence OK → let the route handler execute the plan.
        if (cmd.confidence >= threshold) return next();

        // Too many attempts → stop gracefully.
        if (retries >= maxRetries) {
        return res.status(409).json({
            status: 'retry-limit',
            message: 'I’m still not confident about your request. Please rephrase later.'
        });
        }

        // Ask the user to confirm/clarify (client will speak this via TTS).
        return res.status(202).json({
        status: 'confirm',
        paraphrase: `Did you mean: ${cmd.utterance}?`,
        hint: 'Say “yes” to proceed or re-record a clearer instruction.',
        next: `/api/agent/execute?retries=${retries + 1}`
        });
    };
}
