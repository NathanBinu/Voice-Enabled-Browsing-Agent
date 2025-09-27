// import Browserbase from '@browserbasehq/sdk';
// import { chromium } from 'playwright';
// import { Command } from '../types/schemas.js';
// import { log } from '../utils/logger.js';

// /**
//  * Execute the command steps inside a Browserbase-hosted browser.
//  */
// export async function executeInBrowserbase(cmd: Command) {
//     log('Executor starting…');

//     // Read project id (required by the SDK) and fail fast if absent.
//     const projectId = process.env.BROWSERBASE_PROJECT_ID;
//     if (!projectId) {
//         throw new Error(
//         'BROWSERBASE_PROJECT_ID is required. Set it in your .env (e.g., proj_XXXXXXXX).'
//         );
//     }

//     // Create SDK client with your API key
//     const bb = new Browserbase({
//         apiKey: process.env.BROWSERBASE_API_KEY!
//     });

//     // 1) Create a new remote browser session on Browserbase (projectId required)
//     const session = await bb.sessions.create({ projectId });

//     // 2) Connect Playwright to that session via CDP
//     const browser = await chromium.connectOverCDP(session.connectUrl);

//     // Use the default context/page (best practice with Browserbase)
//     const context = browser.contexts()[0];
//     const page = context.pages()[0] ?? (await context.newPage());

//     // Collect artifacts to show the user (simple MVP).
//     const artifacts: { screenshots: string[]; table?: any[] } = { screenshots: [] };

//     try {
//         for (const step of cmd.steps) {
//         switch (step.op) {
//             case 'navigate': {
//             await page.goto(step.url!, { waitUntil: 'domcontentloaded' });
//             break;
//             }
//             case 'search': {
//             const box = await page.getByRole('textbox').first();
//             await box.fill(step.text || '');
//             await box.press('Enter');
//             break;
//             }
//             case 'filter': {
//             await page.getByText(new RegExp(step.facet!, 'i')).click();
//             break;
//             }
//             case 'sort': {
//             await page.getByText(new RegExp(step.by!, 'i')).click();
//             break;
//             }
//             case 'click': {
//             await page.getByText(new RegExp(step.text!, 'i')).click();
//             break;
//             }
//             case 'type': {
//             // Example if you later pass concrete selectors:
//             // await page.locator(String(step.selector)).fill(step.text ?? '');
//             break;
//             }
//             case 'extract': {
//             const items = await page.$$eval('a,div,li', (nodes: Element[]) =>
//                 nodes.slice(0, 40).map((n: Element) => {
//                 const el = n as HTMLAnchorElement;
//                 return {
//                     text: (n.textContent ?? '').trim(),
//                     href: el.href ?? undefined
//                 };
//                 })
//             );
//             artifacts.table = items.slice(0, step.limit ?? 10);
//             break;
//             }
//             case 'screenshot':
//             default:
//             // no-op; we always screenshot after each step
//             break;
//         }

//         // Screenshot after each step for transparency
//         const shot = `screenshot-${Date.now()}.png`;
//         await page.screenshot({ path: shot, fullPage: true });
//         artifacts.screenshots.push(shot);
//         }
//     } finally {
//         await browser.close();
//         // Optionally: await bb.sessions.end(session.id);
//     }

//     return artifacts;
// }

//-----------------------------------------------------------------------------------

import Browserbase from '@browserbasehq/sdk';
import { chromium, type Locator, type Page } from 'playwright';
import { Command } from '../types/schemas.js';
import { log } from '../utils/logger.js';

export type ExecArtifacts = { screenshots: string[]; table?: any[] };
export type ExecResult = { status: 'done'; answer: string; artifacts: ExecArtifacts };


/* helpers / utilities */

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Reusable timeouts
const TIMEOUT = { short: 5_000, medium: 15_000, long: 45_000 };

async function getHost(page: Page): Promise<string> {
  try { return new URL(page.url()).hostname; } catch { return ''; }
}

/** Map country */
function countryToCcTld(country?: string) {
  if (!country) return 'com';
  const n = country.toLowerCase();
  if (n.includes('canada')) return 'ca';
  if (n.includes('united kingdom') || n.includes('uk') || n.includes('britain')) return 'co.uk';
  if (n.includes('australia')) return 'com.au';
  return 'com';
}

/** Pick a currency when user implies a region. */
function guessCurrency(country?: string, currency?: string) {
  if (currency) return currency.toUpperCase();
  if (!country) return 'USD';
  const n = country.toLowerCase();
  if (n.includes('canada')) return 'CAD';
  if (n.includes('united kingdom') || n.includes('uk')) return 'GBP';
  if (n.includes('euro')) return 'EUR';
  if (n.includes('australia')) return 'AUD';
  return 'USD';
}

/** Build a google query URL with ccTLD and optional Shopping tab. */
function googleQueryUrl(q: string, country?: string, shopping = false) {
  const tld = countryToCcTld(country);
  const base = `https://www.google.${tld}/search`;
  const params = new URLSearchParams({
    q,
    hl: tld === 'ca' ? 'en-CA' : 'en',
    gl: tld === 'ca' ? 'CA' : 'US',
  });
  if (shopping) params.set('tbm', 'shop');
  return `${base}?${params.toString()}`;
}

/** Build a Locator from a flexible selector object. */
function locatorFromSelector(page: Page, sel?: any): Locator | null {
  if (!sel) return null;

  if (sel.css) return page.locator(String(sel.css));
  if (sel.testid) return page.getByTestId(String(sel.testid));

  // role + optional accessible name
  if (sel.role) {
    const role = sel.role as Parameters<Page['getByRole']>[0];
    const opts = (sel.name ? { name: String(sel.name) } : undefined) as Parameters<
      Page['getByRole']
    >[1];
    return page.getByRole(role, opts);
  }

  // common attribute selectors
  if (sel.name) return page.locator(`[name="${String(sel.name)}"]`);
  if (sel.id) return page.locator(`#${String(sel.id)}`);
  if (sel.ariaLabel) return page.locator(`[aria-label="${String(sel.ariaLabel)}"]`);

  if (sel.placeholder) return page.getByPlaceholder(String(sel.placeholder));
  if (sel.text) return page.getByText(new RegExp(escapeRegExp(String(sel.text)), 'i'));

  return null;
}

/** Ensure a unique element (helps strict actions like click/fill). */
async function uniqueLocator(page: Page, base: Locator, textHint?: string): Promise<Locator> {
  let target = base;
  let count = await target.count();

  if (count > 1 && textHint) {
    target = target.filter({ hasText: new RegExp(escapeRegExp(textHint), 'i') });
    count = await target.count();
  }
  if (count > 1) {
    target = target.locator(':visible');
    count = await target.count();
  }
  if (count > 1) {
    target = target.filter({ hasNot: page.locator('[disabled]') });
    count = await target.count();
  }
  return count > 1 ? target.first() : target;
}

/** Try to close common overlays that block inputs (cookies, geo, modals). */
async function dismissOverlays(page: Page): Promise<void> {
  const candidates: Locator[] = [
    page.getByRole('button', { name: /^(close|dismiss|got it|accept|agree|continue)$/i }),
    page.locator('[aria-label="Close"], [aria-label="close"]'),
    // BestBuy specific (geo/country, cookie)
    page.getByRole('button', { name: /united states|canada/i }),
    page.getByRole('button', { name: /continue to canada|go to canada/i }),
    page.locator('[data-testid="header-country-selector"], [data-testid="language-tunnel"]'),
    page.getByRole('button', { name: /accept all cookies|accept cookies/i }),
    // Generic “X” on dialogs
    page.locator('button:has(svg[aria-label="Close"])'),
  ];

  for (const c of candidates) {
    const vis = c.locator(':visible');
    if ((await vis.count().catch(() => 0)) > 0) {
      await vis.first().click({ timeout: 1000 }).catch(() => {});
      await page.waitForTimeout(200).catch(() => {});
    }
  }
}

/** Google consent (sometimes in an iframe). */
async function acceptGoogleConsent(page: Page): Promise<void> {
  // top window
  const buttons = [
    page.getByRole('button', { name: /^(i agree|accept all|agree)$/i }),
    page.getByRole('button', { name: /^(accept|got it|accept all cookies)$/i }),
  ];
  for (const b of buttons) {
    const vis = b.locator(':visible');
    if ((await vis.count().catch(() => 0)) > 0) {
      await vis.first().click({ timeout: 1000 }).catch(() => {});
      await page.waitForTimeout(200).catch(() => {});
      return;
    }
  }
  // iframe variant
  for (const frame of page.frames()) {
    if (!/consent\.google\./i.test(frame.url())) continue;
    const fbtn = frame.getByRole('button', { name: /^(i agree|accept all|agree)$/i });
    if ((await fbtn.count().catch(() => 0)) > 0) {
      await fbtn.first().click({ timeout: 1000 }).catch(() => {});
      await page.waitForTimeout(200).catch(() => {});
      return;
    }
  }
}

/** Heuristic: find a likely "Search" / "Submit" button. */
async function resolveSearchButton(page: Page): Promise<Locator | null> {
  const candidates: Locator[] = [
    page.getByRole('button', { name: /^(search|go|submit)/i }),
    page.locator('button[aria-label*="search" i]'),
    page.locator('button[type="submit"]'),
    page.locator('input[type="submit"]'),
  ];
  for (const c of candidates) {
    const visible = c.locator(':visible');
    if ((await visible.count().catch(() => 0)) > 0) return visible.first();
  }
  return null;
}

/** Find a search input (site-aware for Google; broad fallbacks otherwise). */
async function resolveSearchInput(page: Page): Promise<Locator> {
  const host = await getHost(page);

  // Google
  if (/^www\.google\./i.test(host)) {
    const g1 = page.locator('input[name="q"]');
    if ((await g1.locator(':visible').count().catch(() => 0)) > 0) return g1.locator(':visible').first();

    const g2 = page.getByRole('combobox', { name: /search/i });
    if ((await g2.locator(':visible').count().catch(() => 0)) > 0) return g2.locator(':visible').first();
  }

  // General heuristics
  const candidates: Locator[] = [
    page.getByRole('searchbox'),
    page.getByPlaceholder(/search/i),
    page.locator('input[type="search"]'),
    page.getByRole('textbox', { name: /search/i }),
    page.locator('input[aria-label*="search" i]'),
    page.locator('input[id*="search" i]'),
    page.locator('input[name*="search" i]'),
    page.getByRole('combobox', { name: /search/i }),
  ];

  for (const c of candidates) {
    const vis = c.locator(':visible');
    if ((await vis.count().catch(() => 0)) > 0) return vis.first();
  }

  // last resort
  return page.getByRole('textbox').locator(':visible').first();
}

/** Extract a price from current page text, preferring CAD/C$. */
async function extractPriceFromPage(page: Page, preferCurrency = 'CAD'): Promise<string | null> {
  const host = await getHost(page);

  // 1) Google Shopping / generic Google search
  if (/^www\.google\./i.test(host)) {
    const txt = await page.locator('body').innerText();

    const cadRe = /(CAD\$|C\$)\s?(\d{2,5}(?:[.,]\d{2})?)/gi;
    const cadMatches = [...txt.matchAll(cadRe)];
    if (cadMatches.length) {
      const nums = cadMatches.map(m => Number(m[2].replace(/,/g, ''))).filter(n => n > 20);
      if (nums.length) return `I’m seeing Canadian prices starting around CAD $${Math.min(...nums).toFixed(2)}.`;
    }

    const dollarRe = /\$\s?(\d{2,5}(?:[.,]\d{2})?)/gi;
    const dollarMatches = [...txt.matchAll(dollarRe)];
    if (dollarMatches.length && host.endsWith('.ca')) {
      const nums = dollarMatches.map(m => Number(m[1].replace(/,/g, ''))).filter(n => n > 20);
      if (nums.length) return `I’m seeing prices starting around CAD $${Math.min(...nums).toFixed(2)}.`;
    }
  }

  // 2) Generic page
  const bodyText = await page.locator('body').innerText();

  const cadRe = /(CAD\$|C\$)\s?(\d{2,5}(?:[.,]\d{2})?)/gi;
  const cadMatches = [...bodyText.matchAll(cadRe)];
  if (cadMatches.length) {
    const nums = cadMatches.map(m => Number(m[2].replace(/,/g, ''))).filter(n => n > 20);
    if (nums.length) return `I’m seeing Canadian prices starting around CAD $${Math.min(...nums).toFixed(2)}.`;
  }

  const hostIsCa = host.endsWith('.ca');
  const dollarRe = /\$\s?(\d{2,5}(?:[.,]\d{2})?)/gi;
  const dm = [...bodyText.matchAll(dollarRe)];
  if (dm.length) {
    const nums = dm.map(m => Number(m[1].replace(/,/g, ''))).filter(n => n > 20);
    if (nums.length) {
      const sym = hostIsCa || preferCurrency === 'CAD' ? 'CAD $' : '$';
      return `I’m seeing prices starting around ${sym}${Math.min(...nums).toFixed(2)}.`;
    }
  }
  return null;
}

/** Fallback: try Canadian retailers directly (BestBuy / Apple). */
async function tryCanadianRetailers(page: Page, query: string) {
  const retailers = [
    `https://www.bestbuy.ca/en-CA/search?search=${encodeURIComponent(query)}`,
    `https://www.apple.com/ca/shop/search?search=${encodeURIComponent(query)}`,
  ];
  for (const url of retailers) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT.long });
      await page.waitForLoadState('networkidle', { timeout: TIMEOUT.medium }).catch(() => {});
      const ans = await extractPriceFromPage(page, 'CAD');
      if (ans) return ans;
    } catch { /* ignore and try next */ }
  }
  return null;
}

/* ---------------------------- main executor ---------------------------- */

export async function executeInBrowserbase(cmd: Command) {
  log('Executor starting…');

  const projectId = process.env.BROWSERBASE_PROJECT_ID;
  if (!projectId) throw new Error('BROWSERBASE_PROJECT_ID is required in .env');

  const bb = new Browserbase({ apiKey: process.env.BROWSERBASE_API_KEY! });

  // 1) Start a remote Browserbase session
  const session = await bb.sessions.create({ projectId });

  // 2) Attach Playwright
  const browser = await chromium.connectOverCDP(session.connectUrl);
  const context = browser.contexts()[0];
  const page = context.pages()[0] ?? (await context.newPage());

  //const artifacts: { screenshots: string[]; table?: any[] } = { screenshots: [] };
  const artifacts: ExecArtifacts = { screenshots: [] };
  let answer = '';

  try {
    let justTyped = false;

    for (const step of cmd.steps) {
      switch (step.op) {
        case 'navigate': {
          // If user intends a price + country, prefer google.<ccTLD>
          const country = cmd.entities?.country;
          const url = step.url || googleQueryUrl('', country, true);
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT.long });
          await page.waitForLoadState('networkidle', { timeout: TIMEOUT.medium }).catch(() => {});
          const host = await getHost(page);
          if (/^www\.google\./i.test(host)) await acceptGoogleConsent(page);
          await dismissOverlays(page);
          await page.waitForTimeout(300).catch(() => {});
          break;
        }

        case 'type': {
          const llmLoc = locatorFromSelector(page, step.selector);
          let target: Locator | null = null;

          await dismissOverlays(page);

          // Short attempt with LLM selector
          if (llmLoc) {
            try {
              await llmLoc.waitFor({ state: 'visible', timeout: TIMEOUT.short });
              target = await uniqueLocator(page, llmLoc, step.text);
            } catch { target = null; }
          }

          // Robust fallback
          if (!target) target = await resolveSearchInput(page);

          await target.waitFor({ state: 'visible', timeout: TIMEOUT.long });
          await target.focus({ timeout: TIMEOUT.short }).catch(() => {});
          await target.fill(step.text ?? '', { timeout: TIMEOUT.medium });

          justTyped = true;
          break;
        }

        case 'click': {
          const loc = locatorFromSelector(page, step.selector);

          const tryClick = async (t: Locator, hint?: string) => {
            await t.waitFor({ state: 'visible', timeout: TIMEOUT.short }).catch(() => {});
            const unique = await uniqueLocator(page, t, hint);
            await unique.click({ timeout: TIMEOUT.short });
          };

          if (loc) {
            try { await tryClick(loc, step.text); justTyped = false; break; } catch {}
          }
          if (step.text) {
            try {
              const byText = page.getByText(new RegExp(escapeRegExp(step.text), 'i'));
              await tryClick(byText, step.text); justTyped = false; break;
            } catch {}
          }
          const guess = await resolveSearchButton(page);
          if (guess) {
            try { await tryClick(guess); justTyped = false; break; } catch {}
          }

          if (justTyped) { // submit the form
            await page.keyboard.press('Enter').catch(() => {});
            justTyped = false;
            break;
          }

          throw new Error('Click step could not find an actionable element.');
        }

        case 'search': {
          // Build a region/currency-aware Google Shopping query
          const country = cmd.entities?.country || 'Canada';
          const currency = guessCurrency(country, cmd.entities?.currency); // likely CAD
          const q = `${step.text || ''} price ${currency} site:.${countryToCcTld(country) === 'ca' ? 'ca' : 'com'}`;

          await page.goto(googleQueryUrl(q, country, true), {
            waitUntil: 'domcontentloaded',
            timeout: TIMEOUT.long
          });
          await page.waitForLoadState('networkidle', { timeout: TIMEOUT.medium }).catch(() => {});
          await acceptGoogleConsent(page);
          await dismissOverlays(page);
          break;
        }

        case 'filter': {
          const loc = locatorFromSelector(page, step.selector)
                    ?? page.getByText(new RegExp(escapeRegExp(step.facet ?? ''), 'i'));
          const target = await uniqueLocator(page, loc, step.facet);
          await target.click();
          break;
        }

        case 'sort': {
          const loc = locatorFromSelector(page, step.selector)
                    ?? page.getByText(new RegExp(escapeRegExp(step.by ?? ''), 'i'));
          const target = await uniqueLocator(page, loc, step.by);
          await target.click();
          break;
        }

        case 'extract': {
          const items = await page.$$eval('a,div,li', (nodes: Element[]) =>
            nodes.slice(0, 40).map((n: Element) => {
              const el = n as HTMLAnchorElement;
              return { text: (n.textContent ?? '').trim(), href: el.href ?? undefined };
            })
          );
          artifacts.table = items.slice(0, step.limit ?? 10);
          break;
        }

        case 'screenshot':
        default:
          // no-op; we still capture a shot after each step
          break;
      }

      // Screenshot for transparency
      const shot = `screenshot-${Date.now()}.png`;
      await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
      artifacts.screenshots.push(shot);
    }

    /* ---------- Build a spoken answer (price focus, region-aware) ---------- */

    let answer: string | null = null;

    // 1) Try pulling a price from wherever we ended up.
    answer = await extractPriceFromPage(page, guessCurrency(cmd.entities?.country, cmd.entities?.currency));

    // 2) If nothing, try Google web results (non-shopping) with site bias.
    if (!answer) {
      const country = cmd.entities?.country || 'Canada';
      const q = `${cmd.utterance} price ${guessCurrency(country, cmd.entities?.currency)} site:.ca`;
      await page.goto(googleQueryUrl(q, country, false), { waitUntil: 'domcontentloaded', timeout: TIMEOUT.long });
      await page.waitForLoadState('networkidle', { timeout: TIMEOUT.medium }).catch(() => {});
      await acceptGoogleConsent(page);
      await dismissOverlays(page);
      answer = await extractPriceFromPage(page, 'CAD');
    }

    // 3) Retailer fallback (BestBuy/Apple Canada)
    if (!answer) {
      answer = await tryCanadianRetailers(page, cmd.utterance);
    }

    // If still nothing, be honest.
    if (!answer) {
      answer = 'Sorry, I couldn’t find a clear Canadian price yet.';
    }

    // Return answer + artifacts (your route can TTS this string)
    return { status: 'done', answer, artifacts };

  } finally {
    await browser.close();
  }
}
