/**
 * Netlify Scheduled Function -- social publisher sweep
 *
 * Runs every ~10 minutes and asks the app to publish any social_outbox rows
 * that are due (status='scheduled' AND scheduled_for <= NOW()). This is what
 * makes a scheduled post fire on its own instead of waiting for an operator to
 * click "Publish".
 *
 * Calls POST /api/admin/social/publish-due with the X-Cron-Secret header so the
 * route knows this is a legitimate scheduled invocation. The route runs the
 * claim protocol (conditional UPDATE -> publishing), publishes via the existing
 * publishOutboxRow(), and recovers orphans -- see
 * app/api/admin/social/publish-due/route.ts + schema/028_social_publish_attempts.sql.
 *
 * Env vars required on Netlify:
 *   SOCIAL_PUBLISH_CRON_SECRET  -- dedicated shared secret for this cron. Must
 *                                  match the value the publish-due route reads.
 *                                  Set once via the Netlify UI.
 *   URL                          -- provided automatically by Netlify.
 *
 * To pause without deleting the function: rename `schedule` to `_schedule` in
 * the config export below and redeploy.
 */

import type { Config } from '@netlify/functions';

export default async (_req: Request) => {
  const base = process.env.URL || 'https://atlantic-hub.netlify.app';
  const target = `${base}/api/admin/social/publish-due`;

  const cronSecret = process.env.SOCIAL_PUBLISH_CRON_SECRET;
  if (!cronSecret) {
    console.error('[social-publish-cron] SOCIAL_PUBLISH_CRON_SECRET not set -- aborting');
    return new Response(
      JSON.stringify({ ok: false, error: 'cron_secret_missing' }),
      { status: 500, headers: { 'content-type': 'application/json' } }
    );
  }

  const start = Date.now();
  console.log(`[social-publish-cron] POST ${target}`);

  let res: Response;
  try {
    res = await fetch(target, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-cron-secret': cronSecret
      },
      body: JSON.stringify({})
    });
  } catch (err) {
    console.error('[social-publish-cron] fetch failed', (err as Error).message);
    return new Response(
      JSON.stringify({ ok: false, error: 'fetch_failed', message: (err as Error).message }),
      { status: 502, headers: { 'content-type': 'application/json' } }
    );
  }

  const elapsed = Date.now() - start;
  const body = await res.text();

  if (!res.ok) {
    console.error(`[social-publish-cron] non-2xx from publish-due: ${res.status} body=${body.slice(0, 500)}`);
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

  console.log(`[social-publish-cron] ok in ${elapsed}ms`, JSON.stringify(parsed));

  return new Response(
    JSON.stringify({ ok: true, elapsedMs: elapsed, result: parsed }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );
};

/**
 * Cron format: minute hour day-of-month month day-of-week (UTC)
 *
 * "*\/10 * * * *" -> every 10 minutes, all day. A row scheduled for a past time
 * therefore publishes within ~10 minutes of its scheduled_for. The publish-due
 * route's per-run + per-tenant caps keep each invocation bounded well under the
 * function time budget.
 */
export const config: Config = {
  schedule: '*/10 * * * *'
};
