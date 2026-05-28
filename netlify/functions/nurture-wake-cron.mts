/**
 * Netlify Scheduled Function -- daily nurture wake sweep
 *
 * Runs daily at 07:30 UTC (between the score-sweep at 07:00 and the
 * pain-extract at 08:00). Wakes any lead in nurture / not_now whose
 * wake_at_date <= today: flips status back to "contacted", clears
 * wake_at_date, logs the event.
 *
 * Reuses ENRICHMENT_CRON_SECRET.
 */

import type { Config } from '@netlify/functions';

export default async (_req: Request) => {
  const base = process.env.URL || 'https://atlantic-hub.netlify.app';
  const target = `${base}/api/admin/av/nurture-wake`;

  const cronSecret = process.env.ENRICHMENT_CRON_SECRET;
  if (!cronSecret) {
    console.error('[nurture-wake-cron] ENRICHMENT_CRON_SECRET not set');
    return new Response(
      JSON.stringify({ ok: false, error: 'cron_secret_missing' }),
      { status: 500, headers: { 'content-type': 'application/json' } }
    );
  }

  const start = Date.now();
  console.log(`[nurture-wake-cron] POST ${target}`);

  let res: Response;
  try {
    res = await fetch(target, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-cron-secret': cronSecret },
      body: JSON.stringify({})
    });
  } catch (err) {
    console.error('[nurture-wake-cron] fetch failed', (err as Error).message);
    return new Response(
      JSON.stringify({ ok: false, error: 'fetch_failed', message: (err as Error).message }),
      { status: 502, headers: { 'content-type': 'application/json' } }
    );
  }

  const elapsed = Date.now() - start;
  const body = await res.text();
  if (!res.ok) {
    console.error(`[nurture-wake-cron] non-2xx ${res.status} body=${body.slice(0, 500)}`);
    return new Response(
      JSON.stringify({ ok: false, status: res.status, body: body.slice(0, 500), elapsedMs: elapsed }),
      { status: 502, headers: { 'content-type': 'application/json' } }
    );
  }

  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { parsed = { raw: body.slice(0, 500) }; }
  console.log(`[nurture-wake-cron] ok in ${elapsed}ms`, JSON.stringify(parsed));

  return new Response(
    JSON.stringify({ ok: true, elapsedMs: elapsed, result: parsed }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );
};

export const config: Config = {
  // PAUSED to cut Netlify usage — re-enable on HostGator (#73).
  // schedule: '30 7 * * *'
};
