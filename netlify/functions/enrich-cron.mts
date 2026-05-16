/**
 * Netlify Scheduled Function — daily lead enrichment cron
 *
 * Runs every day at 6:00 AM UTC. Calls the manual-trigger API route
 * with the ENRICHMENT_CRON_SECRET header so the route knows this is a
 * legitimate scheduled invocation (no admin cookie present).
 *
 * Configure schedule in netlify.toml [functions."enrich-cron"] block,
 * OR via the `config.schedule` export below (Netlify supports both).
 *
 * Env vars required on Netlify (all "Same value across all deploy contexts"):
 *   ENRICHMENT_CRON_SECRET   — a long random string. Generate via:
 *                              node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
 *   URL                       — provided automatically by Netlify; the deploy URL
 *
 * To pause the cron without removing the function: rename the export
 * `schedule` below to `_schedule` and redeploy.
 */

import type { Config } from '@netlify/functions';

const DEFAULT_BATCH_SIZE = 5;

export default async (req: Request) => {
  // Netlify gives us the deploy URL in process.env.URL (e.g., https://atlantic-hub.netlify.app)
  const base = process.env.URL || 'https://atlantic-hub.netlify.app';
  const target = `${base}/api/admin/av/enrich`;

  const cronSecret = process.env.ENRICHMENT_CRON_SECRET;
  if (!cronSecret) {
    console.error('[enrich-cron] ENRICHMENT_CRON_SECRET not set — aborting');
    return new Response(
      JSON.stringify({ ok: false, error: 'cron_secret_missing' }),
      { status: 500, headers: { 'content-type': 'application/json' } }
    );
  }

  const start = Date.now();
  console.log(`[enrich-cron] POST ${target} (limit=${DEFAULT_BATCH_SIZE})`);

  let res: Response;
  try {
    res = await fetch(target, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-cron-secret': cronSecret
      },
      body: JSON.stringify({ limit: DEFAULT_BATCH_SIZE })
    });
  } catch (err) {
    console.error('[enrich-cron] fetch failed', (err as Error).message);
    return new Response(
      JSON.stringify({ ok: false, error: 'fetch_failed', message: (err as Error).message }),
      { status: 502, headers: { 'content-type': 'application/json' } }
    );
  }

  const elapsed = Date.now() - start;
  const body = await res.text();

  if (!res.ok) {
    console.error(`[enrich-cron] non-2xx from enrich endpoint: ${res.status} body=${body.slice(0, 500)}`);
    return new Response(
      JSON.stringify({ ok: false, status: res.status, body: body.slice(0, 500), elapsedMs: elapsed }),
      { status: 502, headers: { 'content-type': 'application/json' } }
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    parsed = { raw: body.slice(0, 500) };
  }

  console.log(`[enrich-cron] ✅ ok in ${elapsed}ms`, JSON.stringify(parsed));

  return new Response(
    JSON.stringify({ ok: true, elapsedMs: elapsed, result: parsed }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );
};

/**
 * Netlify scheduled function schedule.
 * Cron format: minute hour day-of-month month day-of-week (UTC)
 *
 * "0 6 * * *"  → every day at 06:00 UTC
 *                = 02:00 EDT / 01:00 EST (eastern time)
 *
 * If you want eastern-AM enrichment, change to "0 10 * * *" (= 06:00 EDT / 05:00 EST).
 */
export const config: Config = {
  schedule: '0 6 * * *'
};
