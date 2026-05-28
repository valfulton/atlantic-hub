/**
 * Netlify Scheduled Function -- daily pain-point extraction sweep
 *
 * Runs daily at 08:00 UTC (one hour after the score-sweep at 07:00).
 * Calls POST /api/admin/av/pain-sweep with X-Cron-Secret so the route
 * runs the AI extractor against any lead missing or with stale
 * pain_point_profile.
 *
 * Reuses ENRICHMENT_CRON_SECRET so we are not juggling multiple secrets.
 */

import type { Config } from '@netlify/functions';

const DEFAULT_BATCH_SIZE = 50;

export default async (_req: Request) => {
  const base = process.env.URL || 'https://atlantic-hub.netlify.app';
  const target = `${base}/api/admin/av/pain-sweep`;

  const cronSecret = process.env.ENRICHMENT_CRON_SECRET;
  if (!cronSecret) {
    console.error('[pain-extract-cron] ENRICHMENT_CRON_SECRET not set -- aborting');
    return new Response(
      JSON.stringify({ ok: false, error: 'cron_secret_missing' }),
      { status: 500, headers: { 'content-type': 'application/json' } }
    );
  }

  const start = Date.now();
  console.log(`[pain-extract-cron] POST ${target} (limit=${DEFAULT_BATCH_SIZE})`);

  let res: Response;
  try {
    res = await fetch(target, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-cron-secret': cronSecret },
      body: JSON.stringify({ limit: DEFAULT_BATCH_SIZE })
    });
  } catch (err) {
    console.error('[pain-extract-cron] fetch failed', (err as Error).message);
    return new Response(
      JSON.stringify({ ok: false, error: 'fetch_failed', message: (err as Error).message }),
      { status: 502, headers: { 'content-type': 'application/json' } }
    );
  }

  const elapsed = Date.now() - start;
  const body = await res.text();
  if (!res.ok) {
    console.error(`[pain-extract-cron] non-2xx ${res.status} body=${body.slice(0, 500)}`);
    return new Response(
      JSON.stringify({ ok: false, status: res.status, body: body.slice(0, 500), elapsedMs: elapsed }),
      { status: 502, headers: { 'content-type': 'application/json' } }
    );
  }

  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { parsed = { raw: body.slice(0, 500) }; }
  console.log(`[pain-extract-cron] ok in ${elapsed}ms`, JSON.stringify(parsed));

  return new Response(
    JSON.stringify({ ok: true, elapsedMs: elapsed, result: parsed }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );
};

export const config: Config = {
  // PAUSED to cut Netlify usage — re-enable on HostGator (#73). Was: '0 */6 * * *'
  // schedule: '0 */6 * * *'
};
