/**
 * GET|POST /api/admin/cron/run?group=frequent|daily
 *
 * Cron DISPATCHER (#73). One HostGator cron job pings this per group, and it
 * fans out (in parallel) to the individual sweep endpoints — so HostGator only
 * needs TWO cron jobs instead of eight. The actual work still runs in each
 * sweep's own route (its own function invocation + timeout); this just kicks
 * them off and reports back.
 *
 * Auth: x-cron-secret header must equal ENRICHMENT_CRON_SECRET (the dispatcher's
 * gate). Each downstream endpoint then re-validates its own secret. Exempted
 * from the operator wall in middleware.ts (PUBLIC_WEBHOOK_PATHS).
 *
 * Adding a job later = add one line to GROUPS; no new HostGator cron needed.
 */
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 60;

type SecretName = 'enrich' | 'publish';
interface Job { path: string; secret: SecretName }

/** Which sweeps run in each group. 'frequent' = every ~15 min, 'daily' = once
 *  a day, 'weekly' = once a week (Friday morning, the client digest). */
const GROUPS: Record<string, Job[]> = {
  frequent: [
    { path: '/api/admin/social/publish-due', secret: 'publish' },
    { path: '/api/admin/av/outreach/replies/poll', secret: 'enrich' }
  ],
  daily: [
    { path: '/api/admin/av/score-sweep', secret: 'enrich' },
    { path: '/api/admin/av/enrich', secret: 'enrich' },
    { path: '/api/admin/av/pain-sweep', secret: 'enrich' },
    { path: '/api/admin/pr/discover-sweep', secret: 'enrich' },
    { path: '/api/admin/av/nurture-wake', secret: 'enrich' },
    { path: '/api/client/guidance/prewarm', secret: 'enrich' }
  ],
  weekly: [
    // (#216 v2) Weekly digest sweep — iterates active clients, sends each
    // their summary email. Empty weeks are skipped server-side.
    { path: '/api/admin/av/digest-sweep', secret: 'enrich' }
  ]
};

function secretValue(name: SecretName): string {
  return (name === 'publish'
    ? process.env.SOCIAL_PUBLISH_CRON_SECRET
    : process.env.ENRICHMENT_CRON_SECRET) || '';
}

async function handle(req: NextRequest): Promise<NextResponse> {
  // Gate: the dispatcher itself requires the enrichment cron secret.
  const gate = process.env.ENRICHMENT_CRON_SECRET;
  if (!gate) return NextResponse.json({ ok: false, error: 'cron_secret_missing' }, { status: 500 });
  if ((req.headers.get('x-cron-secret') || '') !== gate) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const group = (req.nextUrl.searchParams.get('group') || '').toLowerCase();
  const jobs = GROUPS[group];
  if (!jobs) {
    return NextResponse.json({ ok: false, error: 'unknown group', groups: Object.keys(GROUPS) }, { status: 400 });
  }

  const base = process.env.URL || 'https://atlantic-hub.netlify.app';
  // Fire all jobs in the group concurrently — each is its own invocation, so
  // total time ≈ the slowest one (not the sum).
  const settled = await Promise.allSettled(
    jobs.map(async (job) => {
      const res = await fetch(`${base}${job.path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-cron-secret': secretValue(job.secret) },
        body: '{}'
      });
      return { path: job.path, ok: res.ok, status: res.status };
    })
  );

  const results = settled.map((s, i) =>
    s.status === 'fulfilled'
      ? s.value
      : { path: jobs[i].path, ok: false, status: null as number | null, error: (s.reason as Error)?.message ?? 'failed' }
  );
  return NextResponse.json({ ok: true, group, ran: results.length, results });
}

export async function GET(req: NextRequest) { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }
