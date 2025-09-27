import { Command } from '../types/schemas.js';

/**
 * Planner hook. For MVP, we simply pass through the LLM's steps.
 * Later, you can enrich: add postconditions, expand macros, etc.
 */
export function planFromCommand(cmd: Command): Command {
    return cmd;
}
