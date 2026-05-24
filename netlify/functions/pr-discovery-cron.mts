/**
 * Netlify Scheduled Function -- autonomous PR discovery cadence.
 *
 * Runs every 2 hours and POSTs /api/admin/pr/discover-sweep with the
 * X-Cron-Secret header so the engine pulls on its own: internal pain-cluster +
 * standout-lead signals, the configured Reddit/RSS lanes, and the outreach-
 * performance sweep -- all deduped + idempotent, surfacing SUGGESTED
 * pr_opportunities the operator sees on the desk.
 *
 * This is the "high priority" tier of the cadence in the opening brief. The
 * MEDIUM (6-12h) and LOW (daily) tiers, and new source adapters (Qwoted,
 * Featured, SourceBottle, Help a B2B Writer), plug into the SAME route + runner
 * later -- no rewrite.
 *
 * Env vars required on Netlify:
 *   ENRICHMENT_CRON_SECRET  -- reused from the existing crons so there is no new
 *                              secret to manage. Set once via the Netlify UI.
 *   URL                      -- provided automatically by Netlify.
 *
 * To pause without deleting: rename `schedule` to `_schedule` and redeploy.
 */
import type { Config } from '@netlify/functions';

export default async (_req: Request) => {
  const base = process.env.URL || 'https://atlantic-hub.netlify.app';
  const target = `${base}/api/admin/pr/discover-sweep`;

  const cronSecret = process.env.ENRICHMENT_CRON_SECRET;
  if (!cronSecret) {
    console.error('[pr-discovery-cron] ENRICHMENT_CRON_SECRET not set -- aborting');
    return new Response(
      JSON.stringify({ ok: false, error: 'cron_secret_missing' }),
      { status: 500, headers: { 'content-type': 'application/json' } }
    );
  }

  const start = Date.now();
  console.log(`[pr-discovery-cron] POST ${target}`);

  let res: Response;
  try {
    res = await fetch(target, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-cron-secret': cronSecret },
      body: JSON.stringify({})
    });
  } catch (err) {
    console.error('[pr-discovery-cron] fetch failed', (err as Error).message);
    return new Response(
      JSON.stringify({ ok: false, error: 'fetch_failed', message: (err as Error).message }),
      { status: 502, headers: { 'content-type': 'application/json' } }
    );
  }

  const elapsed = Date.now() - start;
  const body = await res.text();

  if (!res.ok) {
    console.error(`[pr-discovery-cron] non-2xx: ${res.status} body=${body.slice(0, 500)}`);
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

  console.log(`[pr-discovery-cron] ok in ${elapsed}ms`, JSON.stringify(parsed));

  return new Response(
    JSON.stringify({ ok: true, elapsedMs: elapsed, result: parsed }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );
};

/**
 * Cron format: minute hour day-of-month month day-of-week (UTC).
 * "0 *\/2 * * *" -> top of every even hour (every 2 hours) = the high-priority tier.
 */
export const config: Config = {
  // Leaned down from every 2h to every 6h to cut Netlify usage.
  schedule: '0 */6 * * *'
};
