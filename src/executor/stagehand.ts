// import Stagehand from '@browserbasehq/stagehand';
// import OpenAI from 'openai';
// import { chromium, type Page } from 'playwright';
// import { Command } from '../types/schemas.js';
// import { log } from '../utils/logger.js';

// /**
//  * Screenshots are OFF by default. Turn on by:
//  *  - putting a `screenshot` step in the Command, OR
//  *  - setting env ALWAYS_SCREENSHOT=1
//  */
// function wantsScreenshots(cmd: Command): boolean {
//   return Boolean(process.env.ALWAYS_SCREENSHOT === '1' ||
//                  cmd.steps?.some(s => s.op === 'screenshot'));
// }

// /** Build a query string from the command. No site/country is hard-coded. */
// function buildQuery(cmd: Command): string {
//   // 1) Prefer what the model planned to type/search
//   const typed = cmd.steps?.find(s => (s.op === 'type' || s.op === 'search') && s.text)?.text?.trim();
//   if (typed) return typed;

//   // 2) Otherwise compose from entities if present
//   const parts: string[] = [];
//   const e: any = cmd.entities || {};
//   if (e.brand) parts.push(String(e.brand));
//   if (e.category) parts.push(String(e.category));
//   if (e.model) parts.push(String(e.model));
//   if (e.variant) parts.push(String(e.variant));
//   if (e.country) parts.push(`in ${e.country}`);
//   if (e.currency) parts.push(`price in ${e.currency}`);
//   if (parts.length) return parts.join(' ').trim();

//   // 3) Fallback to utterance
//   return cmd.utterance;
// }

// /** Pulls visible texts + urls from a Google (or any web) result page. */
// async function collectResultBlocks(page: Page, limit = 8) {
//   // Try Google’s common containers first; fall back to general anchors/blocks
//   const blocks = await page.$$eval('div#search .g, div#search .MjjYud, div#search .D3KPxb, main a, main article, main div',
//     (nodes, max) => {
//       const out: { text: string; url?: string }[] = [];
//       for (const n of nodes) {
//         const text = (n.textContent || '').replace(/\s+/g, ' ').trim();
//         if (text.length < 40) continue; // skip tiny crumbs
//         let url: string | undefined;
//         const a = n.querySelector('a[href]');
//         if (a && 'href' in a) url = (a as HTMLAnchorElement).href;
//         out.push({ text, url });
//         if (out.length >= (max as number)) break;
//       }
//       return out;
//     }, limit
//   ).catch(() => []);

//   // Also collect top organic links for citations
//   const links = await page.$$eval('#search a[href^="http"]',
//     (as, max) => {
//       const seen = new Set<string>();
//       const urls: string[] = [];
//       for (const a of as as HTMLAnchorElement[]) {
//         if (!a.href) continue;
//         if (seen.has(a.href)) continue;
//         seen.add(a.href);
//         urls.push(a.href);
//         if (urls.length >= (max as number)) break;
//       }
//       return urls;
//     }, Math.max(5, limit)
//   ).catch(() => []);

//   return { blocks, links };
// }

// /** Reduce many blocks of text into one prompt-friendly chunk. */
// function fuseTexts(blocks: { text: string }[], cap = 6000) {
//   const joined = blocks.map(b => b.text).join('\n\n---\n\n');
//   return joined.length > cap ? joined.slice(0, cap) : joined;
// }

// /** Ask the LLM (via OpenRouter or OpenAI) to answer concisely from evidence. */
// async function answerFromEvidence(question: string, evidence: string, urls: string[]) {
//   const baseURL = process.env.OPENAI_BASE_URL || 'https://openrouter.ai/api/v1';
//   const apiKey  = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY;
//   const model   = process.env.OPENAI_MODEL || 'openai/gpt-4o-mini';

//   const client  = new OpenAI({ apiKey, baseURL });

//   const system = [
//     'You are a careful web assistant.',
//     'Answer **only** from the evidence provided, do not hallucinate.',
//     'If a price is requested, give a single current price or a short range in the user’s currency if visible.',
//     'Return a brief, plain sentence (1–2 lines) and include one or two quick citations as [1], [2] using the provided URLs.',
//   ].join(' ');

//   const citations = urls.slice(0, 3).map((u, i) => `[${i+1}] ${u}`).join('\n');

//   const { choices } = await client.chat.completions.create({
//     model,
//     messages: [
//       { role: 'system', content: system },
//       { role: 'user', content:
//         `Question: ${question}\n\nEVIDENCE (snippets from the web):\n${evidence}\n\nURLs:\n${citations}\n\nAnswer succinctly with cites like [1], [2].`
//       }
//     ],
//     temperature: 0.1
//   });

//   return choices?.[0]?.message?.content?.trim() || 'Sorry, I could not find a reliable answer in the retrieved results.';
// }

// /**
//  * Stagehand executor:
//  * - spins up a Browserbase session managed by Stagehand
//  * - performs a generic Google search (no site/country hard-coding)
//  * - extracts answer using an LLM over the retrieved snippets
//  * - returns { answer, artifacts, (optional) screenshots }
//  */
// export async function executeWithStagehand(cmd: Command) {
//   log('Stagehand executor starting…');

//   const query = buildQuery(cmd);
//   const takeScreens = wantsScreenshots(cmd);

//   // 1) Start a Stagehand session (it gives us a Playwright Page under the hood)
//   const sh = new (Stagehand as any)({
//     // Stagehand detects Browserbase via this key:
//     apiKey: process.env.BROWSERBASE_API_KEY,
//     // Let Stagehand manage Playwright + Browserbase connection for us
//     headless: true
//   });

//   await sh.init?.(); // tolerate older/newer Stagehand versions

//   // Always get a Playwright Page from Stagehand
//   const page: Page = sh.page || sh.browser?.contexts?.()[0]?.pages?.()[0] || await (async () => {
//     // fallback: if Stagehand exposes a playwright browser directly
//     const browser = (sh.playwright || chromium);
//     const b = await browser.launch?.() || await chromium.launch();
//     const ctx = await b.newContext();
//     return ctx.newPage();
//   })();

//   const artifacts: { screenshots: string[]; table?: any[] } = { screenshots: [] };

//   try {
//     // 2) Navigate to Google and run the query
//     await page.goto('https://www.google.com', { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => {});
//     // Accept consent if it appears (quick heuristics)
//     const agree = page.getByRole('button', { name: /accept|agree|got it/i }).first();
//     if (await agree.isVisible().catch(() => false)) await agree.click().catch(() => {});

//     const box = await (async () => {
//       const c1 = page.locator('input[name="q"]').first();
//       if (await c1.isVisible().catch(() => false)) return c1;
//       const c2 = page.getByRole('combobox', { name: /search/i }).first();
//       if (await c2.isVisible().catch(() => false)) return c2;
//       return page.getByRole('textbox').first();
//     })();

//     await box.fill(query);
//     await box.press('Enter');

//     await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});

//     // 3) Gather snippets + URLs
//     const { blocks, links } = await collectResultBlocks(page, 12);
//     artifacts.table = blocks.slice(0, 10); // raw evidence for transparency

//     // 4) Ask the LLM to answer *from the fetched text only*
//     const evidence = fuseTexts(blocks);
//     const answer = await answerFromEvidence(cmd.utterance, evidence, links);

//     // 5) Optional screenshots (off by default)
//     if (takeScreens) {
//       const shot = `screenshot-${Date.now()}.png`;
//       await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
//       artifacts.screenshots.push(shot);
//     }

//     return { status: 'done', answer, artifacts };
//   } finally {
//     // Close via Stagehand if possible; otherwise close Playwright page/context
//     try { await sh.close?.(); } catch {}
//     try { await page.context()?.browser()?.close(); } catch {}
//   }
// }

//------------------------------------------------------------------------------------------------


import { z } from 'zod';
import { Command } from '../types/schemas.js';
import { log, warn } from '../utils/logger.js';
//import { Stagehand } from "@browserbasehq/stagehand";

// ---------- Safe Stagehand loader (handles default/named/CJS) ----------
function getStagehandCtor(): any {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('@browserbasehq/stagehand');
    return (mod && (mod.Stagehand || mod.default || mod)) ?? null;
  } catch {
    return null;
  }
}

// ---------- Small helpers ----------
const toSingleLine = (s?: string) =>
  (s ?? '').replace(/\s+/g, ' ').trim();

const selHint = (sel?: Record<string, unknown>) => {
  if (!sel) return '';
  const parts: string[] = [];
  for (const [k, v] of Object.entries(sel)) {
    if (v == null) continue;
    parts.push(`${k}=${JSON.stringify(String(v))}`);
  }
  return parts.length ? `(${parts.join(', ')})` : '';
};

type Artifacts = { screenshots: string[]; table?: Array<Record<string, unknown>> };
type ExecResult = { answer: string; artifacts: Artifacts };

// Build a zod object from a list like ["price","currency"] => { price: z.string(), currency: z.string().optional() }
function schemaFromList(list?: string[]) {
  if (!list?.length) return null;
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const key of list) {
    // keep it permissive (string OR number) and optional except the first key
    shape[key] = key === list[0]
      ? z.union([z.string(), z.number()])
      : z.union([z.string(), z.number()]).optional();
  }
  return z.object(shape);
}

// ---------- Main executor ----------
export async function executeWithStagehand(cmd: Command): Promise<ExecResult> {
  log('Stagehand executor starting…');

  const StagehandCtor = getStagehandCtor();
  if (typeof StagehandCtor !== 'function') {
    throw new Error('Stagehand constructor not found. Check @browserbasehq/stagehand install/export.');
  }

  // Create Stagehand using Browserbase (headless)
  const stagehand = new StagehandCtor({
    env: 'BROWSERBASE',
    apiKey: process.env.BROWSERBASE_API_KEY,
    projectId: process.env.BROWSERBASE_PROJECT_ID,
    headless: true,
    verbose: 0, // set to 1 if you want more logs in terminal
  });

  const artifacts: Artifacts = { screenshots: [] };
  let extractedRows: Array<Record<string, unknown>> = [];
  let spoken: string | undefined;

  try {
    await stagehand.init();
    const page = stagehand.page;

    // Iterate your Command steps and translate to Stagehand actions
    for (const step of cmd.steps ?? []) {
      try {
        switch (step.op) {
          case 'navigate': {
            if (!step.url) break;
            await page.goto(step.url);
            break;
          }

          case 'type': {
            const text = toSingleLine(step.text);
            const hint = selHint(step.selector);
            const instruction = hint
              ? `Focus the input ${hint}, type ${JSON.stringify(text)}.`
              : `Find the main input/search box, focus it, type ${JSON.stringify(text)}.`;
            await page.act(instruction);
            break;
          }

          case 'search': {
            const text = toSingleLine(step.text);
            const hint = selHint(step.selector);
            const instruction = hint
              ? `Focus the input ${hint}, type ${JSON.stringify(text)}, then press Enter to submit.`
              : `Find the site search, type ${JSON.stringify(text)}, then press Enter.`;
            await page.act(instruction);
            break;
          }

          case 'click': {
            const txt = toSingleLine(step.text);
            const hint = selHint(step.selector);
            const instruction = hint
              ? `Click the element ${hint}${txt ? ` with visible text like ${JSON.stringify(txt)}` : ''}.`
              : `Click the most relevant element (button/link)${txt ? ` with text like ${JSON.stringify(txt)}` : ''}.`;
            await page.act(instruction);
            break;
          }

          case 'filter': {
            const facet = toSingleLine(step.facet);
            const hint = selHint(step.selector);
            const instruction = hint
              ? `Using ${hint}, apply the filter/value ${JSON.stringify(facet)}.`
              : `Apply a filter/value matching ${JSON.stringify(facet)}.`;
            await page.act(instruction);
            break;
          }

          case 'sort': {
            const by = toSingleLine(step.by);
            const order = step.order ? ` (${step.order})` : '';
            const hint = selHint(step.selector);
            const instruction = hint
              ? `Use ${hint} to sort by ${JSON.stringify(by + order)}.`
              : `Sort the results by ${JSON.stringify(by + order)}.`;
            await page.act(instruction);
            break;
          }

          case 'extract': {
            // If you supplied schema fields (strings), build a zod schema. Otherwise treat instruction freeform.
            const schema =
              (Array.isArray(step.schema) && step.schema.length > 0)
                ? schemaFromList(step.schema)
                : null;

            let instruction = toSingleLine(step.text);
            // Fall back to common target names
            if (!instruction && step.target) {
              if (step.target === 'price') {
                instruction = 'Extract the best single price visible on this page (with currency if present).';
              } else if (step.target === 'answer') {
                instruction = 'Extract a single concise factual answer to the user question from this page.';
              }
            }
            if (!instruction) {
              instruction = 'Extract the most relevant text snippet answering the user request.';
            }

            if (schema) {
              const result = await page.extract({ instruction, schema });
              // normalize to row objects
              const rows = Array.isArray(result) ? result : [result];
              extractedRows = rows.map((r) => (typeof r === 'object' && r ? r : { value: r })) as any[];
            } else {
              const result = await page.extract(instruction);
              const rows = Array.isArray(result) ? result : [result];
              extractedRows = rows.map((r) => (typeof r === 'object' && r ? r : { text: String(r) })) as any[];
            }

            // the first row—if it looks like an answer—becomes the spoken line
            const first = extractedRows[0];
            if (first) {
              if ('price' in first && first.price != null) {
                const cur = (first as any).currency ? ` ${(first as any).currency}` : '';
                spoken = `I'm seeing prices starting around ${first.price}${cur}.`;
              } else if ('text' in first && first.text) {
                spoken = String((first as any).text);
              } else {
                spoken = Object.values(first).filter(Boolean).join(' · ');
              }
            }
            break;
          }

          case 'screenshot': {
            // By design: we do NOT capture screenshots unless you later choose to add them.
            // If you want them, uncomment the next two lines:
            // const buf = await page.screenshot({ fullPage: true });
            // artifacts.screenshots.push(`data:image/png;base64,${buf.toString('base64')}`);
            break;
          }

          default:
            // no-op
            break;
        }
      } catch (e) {
        warn(`Stagehand step "${step.op}" failed: ${(e as Error).message}`);
      }
    }

    // attach extracted table if any
    if (extractedRows.length) {
      artifacts.table = extractedRows;
    }

    // Default spoken fallback
    if (!spoken) {
      if (artifacts.table?.length) {
        spoken = `I found ${artifacts.table.length} result${artifacts.table.length > 1 ? 's' : ''}.`;
      } else {
        spoken = `I completed the requested steps.`;
      }
    }

    return { answer: spoken, artifacts };
  } finally {
    try { await stagehand.close(); } catch {}
  }
}
