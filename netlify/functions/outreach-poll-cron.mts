/**
 * Netlify Scheduled Function -- outreach reply polling
 *
 * Polls Microsoft Graph + Gmail mailboxes every 15 minutes for new
 * replies, classifies them, and (when campaign.auto_advance_stage is on)
 * advances lead_status: positive replies -> qualified, unsubscribe ->
 * lost.
 *
 * HostGator SMTP mailboxes are skipped in v1 -- IMAP polling lands in v2.
 *
 * Env vars required on Netlify:
 *   ENRICHMENT_CRON_SECRET  -- reused (same secret as the existing two crons)
 *   URL                     -- provided automatically by Netlify.
 */

import type { Config } from '@netlify/functions';

export default async (_req: Request) => {
  const base = process.env.URL || 'https://atlantic-hub.netlify.app';
  const target = `${base}/api/admin/av/outreach/replies/poll`;

  const cronSecret = process.env.ENRICHMENT_CRON_SECRET;
  if (!cronSecret) {
    console.error('[outreach-poll-cron] ENRICHMENT_CRON_SECRET not set -- aborting');
    return new Response(
      JSON.stringify({ ok: false, error: 'cron_secret_missing' }),
      { status: 500, headers: { 'content-type': 'application/json' } }
    );
  }

  const start = Date.now();
  console.log(`[outreach-poll-cron] POST ${target}`);

  let res: Response;
  try {
    res = await fetch(target, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-cron-secret': cronSecret
      },
      body: '{}'
    });
  } catch (err) {
    console.error('[outreach-poll-cron] fetch failed', (err as Error).message);
    return new Response(
      JSON.stringify({ ok: false, error: 'fetch_failed', message: (err as Error).message }),
      { status: 502, headers: { 'content-type': 'application/json' } }
    );
  }

  const elapsed = Date.now() - start;
  const body = await res.text();
  if (!res.ok) {
    console.error(`[outreach-poll-cron] non-2xx: ${res.status} body=${body.slice(0, 500)}`);
    return new Response(
      JSON.stringify({ ok: false, status: res.status, body: body.slice(0, 500), elapsedMs: elapsed }),
      { status: 502, headers: { 'content-type': 'application/json' } }
    );
  }

  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { parsed = { raw: body.slice(0, 500) }; }
  console.log(`[outreach-poll-cron] ok in ${elapsed}ms`, JSON.stringify(parsed));
  return new Response(
    JSON.stringify({ ok: true, elapsedMs: elapsed, result: parsed }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );
};

/**
 * Cron format: minute hour day-of-month month day-of-week (UTC)
 *
 * "* /15 * * * *"  -> every 15 minutes
 *
 * 15 minutes is plenty for the SMB volume we expect. Microsoft Graph
 * and Gmail both rate-limit at thousands of requests per hour per app
 * so this is well within budget.
 */
export const config: Config = {
  // PAUSED to cut Netlify usage — re-enable on HostGator (#73). Was: '0 * * * *'
  // schedule: '0 */4 * * *'
};
