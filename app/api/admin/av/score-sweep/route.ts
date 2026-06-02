// CRON-ONLY — invoked by Netlify/worker schedule (some also via a manual "run now" button).
// Zero/limited in-app fetch call sites is BY DESIGN. Do NOT delete in a dead-code sweep.
// See Atlantic_Hub_Playbook/Hidden_Pages_Audit.md (PR A).

/**
 * POST /api/admin/av/score-sweep
 *
 * Daily sweep that re-scores leads where ai_last_scored_at IS NULL --
 * the safety net for the fire-and-forget insert-time scoring path.
 * If a Netlify function dies mid-insert, or OpenAI rate-limited an
 * insert burst, those leads get picked up here on the next cron pass.
 *
 * Auth: same dual-mode pattern as /api/admin/av/enrich:
 *   (a) admin session cookie (manual trigger), OR
 *   (b) X-Cron-Secret header matching ENRICHMENT_CRON_SECRET (the
 *       scheduled Netlify function path).
 *
 * Body: { limit?: number }  -- default 50, max 50 per call.
 *
 * Cost: ~$0.005-0.015 per lead at gpt-4o-mini. A full 50-lead sweep
 * costs ~$0.25-0.75. Bounded by the 50-lead cap so the daily ceiling
 * is predictable.
 *
 * Time budget: stops mid-sweep if we get within 5s of the 60s maxDuration
 * so the function returns gracefully rather than timing out hard.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { getAvDb } from '@/lib/db/av';
import { scoreAndAuditLead } from '@/lib/ai/score_and_audit';
import { logEvent } from '@/lib/events/log';
import type { RowDataPacket } from 'mysql2';

export const runtime = 'nodejs';
export const maxDuration = 60;

const DEFAULT_BATCH = 50;
const MAX_BATCH = 50;
const SOFT_DEADLINE_MS = 55_000; // stop picking up new leads 5s before hard timeout

interface CandidateRow extends RowDataPacket {
  id: number;
  company: string;
}

export async function POST(req: NextRequest) {
  // ---------- Path B: cron-secret header ----------
  const cronSecret = process.env.ENRICHMENT_CRON_SECRET;
  const incomingCronSecret = req.headers.get('x-cron-secret');
  const cronAuthorized = !!cronSecret && !!incomingCronSecret && cronSecret === incomingCronSecret;

  // ---------- Path A: admin cookie ----------
  let actorUserId: number | null = null;
  if (!cronAuthorized) {
    const guard = await guardAdminRequest(req, {
      targetResource: '/api/admin/av/score-sweep',
      tenantId: 'av'
    });
    if (!guard.ok) return guard.response;
    if (guard.actor.role === 'client_user') {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    actorUserId = guard.actor.userId;
  }

  let payload: { limit?: unknown } = {};
  try {
    payload = await req.json();
  } catch {
    // empty body OK
  }
  const limit = Math.min(
    MAX_BATCH,
    Math.max(
      1,
      typeof payload.limit === 'number' && Number.isFinite(payload.limit)
        ? Math.floor(payload.limit)
        : DEFAULT_BATCH
    )
  );

  const triggerSource = cronAuthorized ? 'cron' : 'manual';
  const start = Date.now();

  let candidates: CandidateRow[] = [];
  try {
    const db = getAvDb();
    // LIMIT inlined because mysql2 + HostGator MariaDB throws on prepared
    // LIMIT ?. Limit is validated above (1..50) so concat is safe.
    const [rows] = await db.query<CandidateRow[]>(
      `SELECT id, company
         FROM leads
        WHERE archived_at IS NULL
          AND ai_last_scored_at IS NULL
        ORDER BY id ASC
        LIMIT ${limit}`
    );
    candidates = rows;
  } catch (err) {
    await logEvent({
      eventType: 'scoring.cron_error',
      source: 'cron',
      status: 'failure',
      payload: { stage: 'select_candidates', trigger_source: triggerSource },
      errorMessage: (err as Error).message.slice(0, 500)
    });
    return NextResponse.json(
      { error: 'candidate_select_failed', message: (err as Error).message.slice(0, 300) },
      { status: 500 }
    );
  }

  let scored = 0;
  let skipped = 0;
  let failed = 0;
  let stoppedEarly = false;
  const perLead: Array<{ leadId: number; company: string; outcome: string }> = [];

  for (const c of candidates) {
    if (Date.now() - start > SOFT_DEADLINE_MS) {
      stoppedEarly = true;
      break;
    }
    try {
      const result = await scoreAndAuditLead(c.id);
      if (result === null) {
        failed += 1;
        perLead.push({ leadId: c.id, company: c.company, outcome: 'failed' });
      } else if (result.skipped) {
        skipped += 1;
        perLead.push({ leadId: c.id, company: c.company, outcome: `skipped:${result.skipReason}` });
      } else {
        scored += 1;
        perLead.push({ leadId: c.id, company: c.company, outcome: `scored:${result.aiScoreBand}` });
      }
    } catch (err) {
      failed += 1;
      perLead.push({ leadId: c.id, company: c.company, outcome: 'threw' });
      console.error('[score-sweep:lead]', c.id, (err as Error).message);
    }
  }

  const elapsedMs = Date.now() - start;
  await logEvent({
    eventType: 'scoring.cron_run',
    userId: actorUserId,
    source: 'cron',
    status: failed > 0 && scored === 0 ? 'failure' : stoppedEarly ? 'partial' : 'success',
    payload: {
      trigger_source: triggerSource,
      attempted: candidates.length,
      scored,
      skipped,
      failed,
      stopped_early: stoppedEarly,
      limit_requested: limit
    },
    executionTimeMs: elapsedMs
  });

  return NextResponse.json({
    ok: true,
    triggerSource,
    elapsedMs,
    attempted: candidates.length,
    scored,
    skipped,
    failed,
    stoppedEarly,
    perLead
  });
}
