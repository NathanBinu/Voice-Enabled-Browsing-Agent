// import OpenAI from 'openai';
// import { v4 as uuid } from 'uuid';
// import { Command, CommandJSON } from '../types/schemas.js';
// import { log } from '../utils/logger.js';

// /**
//  * Configure OpenAI SDK to talk to OpenRouter:
//  * - baseURL points to OpenRouter
//  * - apiKey is your OpenRouter key
//  * - defaultHeaders carry the optional attribution headers OpenRouter supports
//  */
// const openai = new OpenAI({
//   apiKey: process.env.OPENROUTER_API_KEY,
//   baseURL: process.env.OPENAI_BASE_URL || 'https://openrouter.ai/api/v1',
//   // <- this is where those headers belong (NOT inside the create({...}) body)
//   defaultHeaders: {
//     'HTTP-Referer': 'http://localhost:3000',
//     'X-Title': 'Voice Browser Agent'
//   }
// });

// /** System prompt that forces JSON-only output matching our Zod schema. */
// // const SYSTEM = `You convert a user's transcript into a JSON command for a browser automation agent.
// // Always output ONLY valid JSON matching exactly this TypeScript type:
// // {
// //   "id": string, "utterance": string, "intent": string, "confidence": number,
// //   "entities": { "brand"?: string, "category"?: string, "price_max"?: number, "sort"?: string },
// //   "steps": Array<{
// //      "op":"navigate"|"search"|"click"|"type"|"filter"|"sort"|"extract"|"screenshot",
// //      "url"?: string, "selector"?: Record<string,any>, "text"?: string,
// //      "facet"?: string, "lte"?: number, "by"?: string, "order"?: "asc"|"desc",
// //      "target"?: string, "schema"?: string[], "limit"?: number
// //   }>,
// //   "timestamp": string
// // }
// // Do not include any markdown fences or extra text—return raw JSON only.`;

// const SYSTEM = `You convert a user's utterance into a JSON "Command" for a browser agent.
// OUTPUT RULES:
// - Output ONLY raw JSON matching this exact TypeScript shape (no prose, no markdown fences):
// {
//   "id": string, "utterance": string, "intent": string, "confidence": number,
//   "entities": { "brand"?: string, "category"?: string, "price_max"?: number, "sort"?: string },
//   "steps": Array<{
//      "op":"navigate"|"search"|"click"|"type"|"filter"|"sort"|"extract"|"screenshot",
//      "url"?: string, "selector"?: Record<string,any>, "text"?: string,
//      "facet"?: string, "lte"?: number, "by"?: string, "order"?: "asc"|"desc",
//      "target"?: string, "schema"?: string[], "limit"?: number
//   }>,
//   "timestamp": string
// }

// PLANNING GUIDELINES:
// - If the user asks a factual question (e.g., "price", "release date", "who/what/when/where/how"), plan to FIND THE ANSWER:
//   1) "navigate" to a suitable starting site (often "https://www.google.com").
//   2) "type" a concise query into the site's search box (e.g., name="q" on Google).
//   3) "click" a HIGH-CREDIBILITY, RELEVANT result (avoid ads; prefer official or authoritative sources).
//   4) "extract" the answer as short text. Set "target":"answer". Use "schema" with a few fields (e.g., ["answer","price","currency"]) if helpful.
// - Never hardcode answers. Always search or open a credible page and extract.
// - Respect region/currency hints (e.g., "in Canada" ⇒ prefer CAD pages or local domains). Do not assume location if not specified.
// - Use robust selectors when possible:
//   • role/name (getByRole) and placeholder are best (e.g., { "role":"textbox", "name":"Search" } or { "placeholder":"Search" } ).
//   • testid is fine when present.
//   • CSS selectors are allowed but keep them simple and stable.
// - Keep step count minimal and purposeful.
// - Include a "screenshot" step ONLY if the user explicitly asked for images/screenshots, or if extraction fails and visual proof is requested.
// - Avoid vague clicks like getByText with empty patterns—always include a clear text hint.
// `;

// /**
//  * Take a natural-language utterance → ask the LLM to emit Command JSON.
//  * We validate with Zod to ensure the executor receives a clean contract.
//  */
// export async function parseIntent(utterance: string): Promise<Command> {
//   const model = process.env.OPENAI_MODEL || 'openai/gpt-oss-120b';

//   // Remove extra_headers here – not allowed in params
//   const completion = await openai.chat.completions.create({
//     model,
//     messages: [
//       { role: 'system', content: SYSTEM },
//       { role: 'user', content: `Utterance: "${utterance}"` }
//     ],
//     temperature: 0.2
//   });
// //  const raw = completion.choices[0]?.message?.content ?? '{}';

// //   const parsed = JSON.parse(raw);
// //   parsed.id ??= uuid();
// //   parsed.utterance ??= utterance;
// //   parsed.timestamp ??= new Date().toISOString();
// //   parsed.confidence ??= 0.6;

// //   const cmd = CommandJSON.parse(parsed);
// //   log('Parsed intent:', cmd.intent, 'confidence:', cmd.confidence);
// //   return cmd;
//     let raw = completion.choices[0]?.message?.content ?? '{}';

//     // --- sanitize common model quirks ---
//     // strip ```json fences and ``` if present
//     raw = raw.replace(/^\s*```json\s*|\s*```\s*$/g, '');
//     // cheap guard against stray control chars
//     raw = raw.replace(/[\u0000-\u001F]+/g, ' ');

//     // --- robust parse with a fallback ---
//     let parsedAny: any;
//     try {
//     parsedAny = JSON.parse(raw);
//     } catch {
//     // fallback: grab the outermost {...} block
//     const start = raw.indexOf('{');
//     const end = raw.lastIndexOf('}');
//     if (start !== -1 && end !== -1 && end > start) {
//         parsedAny = JSON.parse(raw.slice(start, end + 1));
//     } else {
//         throw new Error('LLM did not return valid JSON.');
//     }
//     }

//     // Fill defaults before strict validation
//     parsedAny.id ??= uuid();
//     parsedAny.utterance ??= utterance;
//     parsedAny.timestamp ??= new Date().toISOString();
//     parsedAny.confidence ??= 0.6;

//     const cmd = CommandJSON.parse(parsedAny);
//     log('Parsed intent:', cmd.intent, 'confidence:', cmd.confidence);
//     return cmd;
// }
// // Compare this snippet from src/asr/deepgram.ts:

//---------------------------------------------------------------------------------

import OpenAI from 'openai';
import { v4 as uuid } from 'uuid';
import { Command, CommandJSON } from '../types/schemas.js';
import { log, warn } from '../utils/logger.js';

const openai = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL || 'https://openrouter.ai/api/v1',
  defaultHeaders: {
    'HTTP-Referer': 'http://localhost:3000',
    'X-Title': 'Voice Browser Agent',
  },
});

const SYSTEM_BASE = `You convert a user's transcript into a JSON command for a browser automation agent.
Always output ONLY valid JSON matching exactly this TypeScript type:
{
  "id": string, "utterance": string, "intent": string, "confidence": number,
  "entities": { "brand"?: string, "category"?: string, "price_max"?: number, "sort"?: string },
  "steps": Array<{
     "op":"navigate"|"search"|"click"|"type"|"filter"|"sort"|"extract"|"screenshot",
     "url"?: string, "selector"?: Record<string,any>, "text"?: string,
     "facet"?: string, "lte"?: number, "by"?: string, "order"?: "asc"|"desc",
     "target"?: string, "schema"?: string[], "limit"?: number
  }>,
  "timestamp": string
}
Rules:
- Do not include markdown fences.
- Do not include explanations.
- If a field is unknown, OMIT it instead of using null.
- If the user asks a factual question, include a 'search' or 'type' step whose text is aimed at answering it directly.
- Only include a 'screenshot' step if the user explicitly asks for images/screenshots.`;

const SYSTEM_RETRY = `${SYSTEM_BASE}
Return the JSON between two lines:
BEGIN_JSON
{ ...valid json... }
END_JSON`;

/* ---------------- helpers ---------------- */

// remove every null recursively
function scrubNulls(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(scrubNulls);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) {
      if (val === null) continue;
      out[k] = scrubNulls(val);
    }
    return out;
  }
  return v;
}

// convert numeric-looking strings to numbers (e.g. "2199" -> 2199)
function coerceScalars(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(coerceScalars);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) {
      out[k] = coerceScalars(val);
    }
    return out;
  }
  if (typeof v === 'string') {
    const num = Number(v);
    if (Number.isFinite(num) && String(num) === v.trim()) return num;
  }
  return v;
}

// keep only keys the schema expects (prevents Zod from tripping on junk)
function pruneToSchemaShape(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj;

  const out: any = {};
  // top-level
  if (typeof obj.id === 'string') out.id = obj.id;
  if (typeof obj.utterance === 'string') out.utterance = obj.utterance;
  if (typeof obj.intent === 'string') out.intent = obj.intent;
  if (typeof obj.confidence === 'number') out.confidence = obj.confidence;

  // entities
  if (obj.entities && typeof obj.entities === 'object') {
    const e: any = {};
    if (typeof obj.entities.brand === 'string') e.brand = obj.entities.brand;
    if (typeof obj.entities.category === 'string') e.category = obj.entities.category;
    if (typeof obj.entities.price_max === 'number') e.price_max = obj.entities.price_max;
    if (typeof obj.entities.sort === 'string') e.sort = obj.entities.sort;
    out.entities = e;
  } else {
    out.entities = {};
  }

  // steps
  if (Array.isArray(obj.steps)) {
    const validOps = new Set(['navigate','search','click','type','filter','sort','extract','screenshot']);
    out.steps = obj.steps
      .filter((s: any) => s && typeof s === 'object' && validOps.has(s.op))
      .map((s: any) => {
        const step: any = { op: s.op };
        if (typeof s.url === 'string') step.url = s.url;
        if (s.selector && typeof s.selector === 'object') {
          // drop nulls from selector too
          const sel: any = {};
          for (const [k, v] of Object.entries(s.selector)) {
            if (v !== null && v !== undefined) sel[k] = v;
          }
          step.selector = sel;
        }
        if (typeof s.text === 'string') step.text = s.text;
        if (typeof s.facet === 'string') step.facet = s.facet;
        if (typeof s.lte === 'number') step.lte = s.lte;
        if (typeof s.by === 'string') step.by = s.by;
        if (s.order === 'asc' || s.order === 'desc') step.order = s.order;
        if (typeof s.target === 'string') step.target = s.target;
        if (Array.isArray(s.schema)) step.schema = s.schema.filter((x: unknown) => typeof x === 'string');
        if (typeof s.limit === 'number') step.limit = s.limit;
        return step;
      });
  } else {
    out.steps = [];
  }

  if (typeof obj.timestamp === 'string') out.timestamp = obj.timestamp;

  return out;
}

// Normalize quotes, strip code fences, clean trailing commas
function normalizeMaybeJson(s: string): string {
  let t = s.trim();
  // remove ```json ... ```
  t = t.replace(/^```(?:json)?\s*|\s*```$/g, '');
  // smart quotes → straight
  t = t.replace(/[\u201C\u201D]/g, '"').replace(/[\u2018\u2019]/g, "'");
  // remove BOM & NBSP
  t = t.replace(/^\uFEFF/, '').replace(/\u00A0/g, ' ');
  // trailing commas in objects/arrays
  t = t.replace(/,\s*([}\]])/g, '$1');
  return t;
}

function carveBetweenMarkers(s: string): string | null {
  const start = s.indexOf('BEGIN_JSON');
  const end = s.indexOf('END_JSON', start + 10);
  if (start >= 0 && end > start) return s.slice(start + 'BEGIN_JSON'.length, end);
  return null;
}
function carveLargestJsonBlock(s: string): string | null {
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a >= 0 && b > a) return s.slice(a, b + 1);
  return null;
}
function tryParseJson(s: string): any {
  return JSON.parse(normalizeMaybeJson(s));
}

/* ---------------- main ---------------- */

export async function parseIntent(utterance: string): Promise<Command> {
  const model = process.env.OPENAI_MODEL || 'openai/gpt-oss-120b';

  // ---------- Attempt 1: ask for structured JSON ----------
  try {
    const c1 = await openai.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: SYSTEM_BASE },
        { role: 'user', content: `Utterance: "${utterance}"` },
      ],
      temperature: 0,
      // Some routers/models ignore this; that's fine—we fall back below.
      response_format: { type: 'json_object' as const },
      max_tokens: 1200,
    });

    const raw1 = c1.choices[0]?.message?.content ?? '';
    if (!raw1) throw new Error('Empty content');

    let parsed1 = scrubNulls(tryParseJson(raw1));
    parsed1 = coerceScalars(parsed1);
    parsed1 = pruneToSchemaShape(parsed1);

    (parsed1 as any).id ??= uuid();
    (parsed1 as any).utterance ??= utterance;
    (parsed1 as any).timestamp ??= new Date().toISOString();
    (parsed1 as any).confidence ??= 0.6;

    const cmd1 = CommandJSON.parse(parsed1);
    log('Parsed intent (attempt 1):', cmd1.intent, 'confidence:', cmd1.confidence);
    return cmd1;
  } catch (e) {
    warn(`Intent parse attempt 1 failed: ${(e as Error).message}`);
  }

  // ---------- Attempt 2: plain text + BEGIN/END markers ----------
  try {
    const c2 = await openai.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: SYSTEM_RETRY },
        { role: 'user', content: `Utterance: "${utterance}"` },
      ],
      temperature: 0.1,
      max_tokens: 1400,
    });

    const raw2 = c2.choices[0]?.message?.content ?? '';
    if (!raw2) throw new Error('Empty content');

    let candidate = carveBetweenMarkers(raw2) ?? carveLargestJsonBlock(raw2);
    if (!candidate) throw new Error('No JSON block found');

    let parsed2 = scrubNulls(tryParseJson(candidate));
    parsed2 = coerceScalars(parsed2);
    parsed2 = pruneToSchemaShape(parsed2);

    (parsed2 as any).id ??= uuid();
    (parsed2 as any).utterance ??= utterance;
    (parsed2 as any).timestamp ??= new Date().toISOString();
    (parsed2 as any).confidence ??= 0.6;

    const cmd2 = CommandJSON.parse(parsed2);
    log('Parsed intent (attempt 2):', cmd2.intent, 'confidence:', cmd2.confidence);
    return cmd2;
  } catch (e) {
    warn(`Intent parse attempt 2 failed: ${(e as Error).message}`);
  }

  // ---------- Final fallback ----------
  warn('Falling back to a minimal search plan due to unparseable model output.');
  const fallback = {
    id: uuid(),
    utterance,
    intent: 'search',
    confidence: 0.6,
    entities: {},
    steps: [
      { op: 'navigate', url: 'https://www.google.com' },
      { op: 'type', selector: { name: 'q' }, text: utterance },
      { op: 'click', selector: { name: 'btnK' } },
      { op: 'extract', target: 'answer', schema: ['text'], limit: 5 },
    ],
    timestamp: new Date().toISOString(),
  } satisfies Command;

  return fallback;
}



