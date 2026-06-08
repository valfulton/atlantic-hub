/**
 * lib/scrape/browserless.ts  (#534, val 2026-06-08)
 *
 * Browser-automation client for Browserless.io. Hits their /function endpoint
 * with a JavaScript snippet that runs inside their headless Chrome — returns
 * whatever the script returns. No puppeteer-core install required; the hub
 * stays small on Netlify.
 *
 * Free tier: 1,000 calls/month. Token lives in BROWSERLESS_TOKEN.
 *
 * Why /function instead of /content or /scrape:
 *   - /content returns raw HTML — useless for sites with JS-rendered results
 *     or multi-step interactions (qPublic, mdlandrec, GA SOS).
 *   - /scrape needs JSON selectors and is brittle.
 *   - /function lets us write actual Playwright/Puppeteer code that runs in
 *     their Chrome and returns the structured result we want. Most flexible.
 *
 * Docs: https://docs.browserless.io/baas/start/quick-start
 */

const BROWSERLESS_BASE = process.env.BROWSERLESS_BASE_URL ?? 'https://production-sfo.browserless.io';

export interface BrowserlessRunOptions {
  /** Per-call timeout in ms. Default 25s — Netlify functions cap at ~26s. */
  timeoutMs?: number;
  /** Optional context object passed into the script as `context`. */
  context?: Record<string, unknown>;
}

export interface BrowserlessResult<T = unknown> {
  ok: boolean;
  data: T | null;
  error: string | null;
  /** Approximate elapsed time in ms; helpful for quota tracking. */
  elapsedMs: number;
}

/**
 * Run a JS function inside a Browserless Chrome session.
 *
 * The script body should be a JS expression returning either a Promise or a
 * direct value. It has access to `page` (a Puppeteer Page bound to a fresh
 * tab) and `context` (whatever caller passed).
 *
 * Example:
 *   const r = await runBrowserlessFunction<{ owner: string }>(
 *     `async ({ page, context }) => {
 *       await page.goto(context.url, { waitUntil: 'domcontentloaded' });
 *       return { owner: await page.$eval('#owner', el => el.textContent?.trim()) };
 *     }`,
 *     { context: { url: 'https://example.com/parcel/123' } }
 *   );
 */
export async function runBrowserlessFunction<T = unknown>(
  scriptBody: string,
  opts: BrowserlessRunOptions = {}
): Promise<BrowserlessResult<T>> {
  const token = process.env.BROWSERLESS_TOKEN;
  if (!token) {
    return {
      ok: false,
      data: null,
      error: 'BROWSERLESS_TOKEN not set — add it in Netlify environment variables to enable browser automation.',
      elapsedMs: 0
    };
  }
  const timeoutMs = opts.timeoutMs ?? 25_000;
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(`${BROWSERLESS_BASE}/function?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        code: scriptBody,
        context: opts.context ?? {}
      })
    });
    const elapsedMs = Date.now() - started;
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, data: null, error: `Browserless ${res.status}: ${text.slice(0, 240)}`, elapsedMs };
    }
    // Browserless /function returns the script's return value as the response body.
    // If the script returns an object, the body is JSON. If a string, it's text.
    const contentType = res.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      const data = (await res.json()) as T;
      return { ok: true, data, error: null, elapsedMs };
    }
    const text = await res.text();
    return { ok: true, data: text as unknown as T, error: null, elapsedMs };
  } catch (err) {
    return {
      ok: false,
      data: null,
      error: (err as Error).name === 'AbortError'
        ? `Browserless call timed out after ${timeoutMs}ms`
        : (err as Error).message,
      elapsedMs: Date.now() - started
    };
  } finally {
    clearTimeout(tid);
  }
}

/**
 * Convenience: is Browserless configured? Used by adapters to short-circuit
 * to "pending worker" stub when the token isn't present.
 */
export function isBrowserlessAvailable(): boolean {
  return Boolean(process.env.BROWSERLESS_TOKEN);
}
