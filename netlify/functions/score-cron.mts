/**
 * Netlify Scheduled Function -- daily AI score sweep
 *
 * Runs every day at 07:00 UTC, one hour after the existing 06:00 UTC
 * Hunter enrichment cron so newly-enriched leads get scored on the same
 * morning pass.
 *
 * Calls POST /api/admin/av/score-sweep with the X-Cron-Secret header so
 * the route knows this is a legitimate scheduled invocation.
 *
 * The sweep picks up leads where ai_last_scored_at IS NULL -- the safety
 * net for the fire-and-forget insert-time scoring path. If a Netlify
 * function dies mid-insert, or OpenAI rate-limited an insert burst, those
 * leads land here on the next morning pass.
 *
 * Env vars required on Netlify:
 *   ENRICHMENT_CRON_SECRET  -- reused from the existing enrichment cron
 *                              so deploy operators don't manage a second
 *                              secret. Set once via the Netlify UI.
 *   URL                      -- provided automatically by Netlify.
 *
 * To pause without deleting the function: rename `schedule` to `_schedule`
 * in the config export below and redeploy.
 */

import type { Config } from '@netlify/functions';

const DEFAULT_BATCH_SIZE = 50;

export default async (_req: Request) => {
  const base = process.env.URL || 'https://atlantic-hub.netlify.app';
  const target = `${base}/api/admin/av/score-sweep`;

  const cronSecret = process.env.ENRICHMENT_CRON_SECRET;
  if (!cronSecret) {
    console.error('[score-cron] ENRICHMENT_CRON_SECRET not set -- aborting');
    return new Response(
      JSON.stringify({ ok: false, error: 'cron_secret_missing' }),
      { status: 500, headers: { 'content-type': 'application/json' } }
    );
  }

  const start = Date.now();
  console.log(`[score-cron] POST ${target} (limit=${DEFAULT_BATCH_SIZE})`);

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
    console.error('[score-cron] fetch failed', (err as Error).message);
    return new Response(
      JSON.stringify({ ok: false, error: 'fetch_failed', message: (err as Error).message }),
      { status: 502, headers: { 'content-type': 'application/json' } }
    );
  }

  const elapsed = Date.now() - start;
  const body = await res.text();

  if (!res.ok) {
    console.error(`[score-cron] non-2xx from score-sweep: ${res.status} body=${body.slice(0, 500)}`);
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

  console.log(`[score-cron] ok in ${elapsed}ms`, JSON.stringify(parsed));

  return new Response(
    JSON.stringify({ ok: true, elapsedMs: elapsed, result: parsed }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );
};

/**
 * Cron format: minute hour day-of-month month day-of-week (UTC)
 *
 * "0 7 * * *"  -> every day at 07:00 UTC
 *                = 03:00 EDT / 02:00 EST
 *
 * Sequenced one hour after the enrich-cron (06:00 UTC) so any leads
 * Hunter enriched this morning get re-scored with their new contact data
 * the same morning.
 */
export const config: Config = {
  // PAUSED to cut Netlify usage — re-enable on HostGator (#73).
  // schedule: '0 7 * * *'
};
