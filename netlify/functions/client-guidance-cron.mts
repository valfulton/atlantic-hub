/**
 * Netlify Scheduled Function -- nightly client-guidance pre-warm (OPTIONAL).
 *
 * Recomposes each active client's guidance feed overnight so the morning
 * dashboard load is always a warm-cache read and the guidance keeps compounding
 * in intelligence_objects. The dashboard self-heals a cold/stale cache on load,
 * so this function is purely a latency optimization -- safe to pause.
 *
 * Calls POST /api/client/guidance/prewarm with the X-Cron-Secret header. That
 * route is NOT behind the middleware session wall and gates itself on the same
 * ENRICHMENT_CRON_SECRET (reused so deploy operators manage one secret), exactly
 * like netlify/functions/score-cron.mts.
 *
 * Env vars required on Netlify:
 *   ENRICHMENT_CRON_SECRET  -- reused; already set for the other crons.
 *   URL                      -- provided automatically by Netlify.
 *
 * To pause without deleting: rename `schedule` to `_schedule` and redeploy.
 */

import type { Config } from '@netlify/functions';

const DEFAULT_LIMIT = 200;

export default async (_req: Request) => {
  const base = process.env.URL || 'https://atlantic-hub.netlify.app';
  const target = `${base}/api/client/guidance/prewarm`;

  const cronSecret = process.env.ENRICHMENT_CRON_SECRET;
  if (!cronSecret) {
    console.error('[client-guidance-cron] ENRICHMENT_CRON_SECRET not set -- aborting');
    return new Response(
      JSON.stringify({ ok: false, error: 'cron_secret_missing' }),
      { status: 500, headers: { 'content-type': 'application/json' } }
    );
  }

  const start = Date.now();
  console.log(`[client-guidance-cron] POST ${target} (limit=${DEFAULT_LIMIT})`);

  let res: Response;
  try {
    res = await fetch(target, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-cron-secret': cronSecret
      },
      body: JSON.stringify({ limit: DEFAULT_LIMIT })
    });
  } catch (err) {
    console.error('[client-guidance-cron] fetch failed', (err as Error).message);
    return new Response(
      JSON.stringify({ ok: false, error: 'fetch_failed', message: (err as Error).message }),
      { status: 502, headers: { 'content-type': 'application/json' } }
    );
  }

  const elapsed = Date.now() - start;
  const body = await res.text();

  if (!res.ok) {
    console.error(`[client-guidance-cron] non-2xx: ${res.status} body=${body.slice(0, 500)}`);
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

  console.log(`[client-guidance-cron] ok in ${elapsed}ms`, JSON.stringify(parsed));

  return new Response(
    JSON.stringify({ ok: true, elapsedMs: elapsed, result: parsed }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );
};

/**
 * Cron format: minute hour day-of-month month day-of-week (UTC)
 * "30 8 * * *" -> every day at 08:30 UTC, after the 07:00 score sweep so the
 * freshest combined scores feed momentum before guidance recomposes.
 */
export const config: Config = {
  schedule: '30 8 * * *'
};
