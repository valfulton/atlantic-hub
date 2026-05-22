/**
 * POST /api/admin/social/publish-due
 *
 * Activation route for the social publisher: finds scheduled social_outbox rows
 * whose time has come and publishes them, so a queued post fires on its own
 * instead of waiting for an operator to click "Publish". Called every ~10 min by
 * netlify/functions/social-publish-cron.mts.
 *
 * Auth: same dual-mode pattern as /api/admin/av/score-sweep:
 *   (a) admin session cookie (manual trigger from an operator), OR
 *   (b) X-Cron-Secret header matching SOCIAL_PUBLISH_CRON_SECRET (the scheduled
 *       Netlify function path). Because this lives under /api/admin/* it is also
 *       listed in middleware.ts PUBLIC_WEBHOOK_PATHS so the cron (no operator
 *       cookie) reaches the handler; the secret check below is the real gate.
 *
 * CLAIM PROTOCOL (see schema/028_social_publish_attempts.sql):
 *   1. ORPHAN RECOVERY: rows stuck in 'publishing' with claimed_at older than
 *      ORPHAN_MINUTES (a prior run died mid-publish) are re-queued to 'scheduled'
 *      (or failed once they exhaust retries) so they get another pass.
 *   2. CLAIM: each due row is claimed with a conditional UPDATE to
 *      status='publishing', claimed_at=NOW() WHERE id=? AND status='scheduled'.
 *      Only the run whose UPDATE affects exactly 1 row owns the post; overlapping
 *      runs affect 0 rows and skip it -> never double-post.
 *   3. PUBLISH the claimed row via the EXISTING publishOutboxRow().
 *
 * Safety: ONLY status='scheduled' rows are ever auto-published. Drafts
 * (status='draft') and rows awaiting client approval are never touched here -
 * the operator/approval flow promotes a row to 'scheduled' only once it is
 * authorized to go out (docs/SOCIAL_ONBOARDING_AND_AUTHORIZATION_SPEC.md).
 *
 * Fairness: a total BATCH_CAP per run plus a PER_TENANT_CAP so one busy tenant
 * cannot starve others or stampede a provider's rate limit in a single cycle.
 * Smart-cadence (hot-lead prime-time) timing is a follow-up; v1 just fires due
 * rows in scheduled_for order.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { getAvDb } from '@/lib/db/av';
import { publishOutboxRow } from '@/lib/social/publish';
import { logEvent } from '@/lib/events/log';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

export const runtime = 'nodejs';
export const maxDuration = 60;

const BATCH_CAP = 25; // most rows we will publish in one cron cycle
const PER_TENANT_CAP = 5; // most rows per tenant per cycle (fairness + rate safety)
const MAX_RETRIES = 3; // give up on a row after this many failed attempts
const ORPHAN_MINUTES = 15; // a 'publishing' row older than this is considered orphaned
const SOFT_DEADLINE_MS = 55_000; // stop claiming new rows 5s before the hard timeout

interface DueRow extends RowDataPacket {
  id: number;
  tenant_id: string;
  retries: number;
}

interface OrphanRow extends RowDataPacket {
  id: number;
  retries: number;
}

export async function POST(req: NextRequest) {
  // ---------- Path B: cron-secret header ----------
  const cronSecret = process.env.SOCIAL_PUBLISH_CRON_SECRET;
  const incomingCronSecret = req.headers.get('x-cron-secret');
  const cronAuthorized = !!cronSecret && !!incomingCronSecret && cronSecret === incomingCronSecret;

  // ---------- Path A: admin cookie ----------
  let actorUserId: number | null = null;
  if (!cronAuthorized) {
    const guard = await guardAdminRequest(req, {
      targetResource: '/api/admin/social/publish-due:POST',
      tenantId: 'av'
    });
    if (!guard.ok) return guard.response;
    if (guard.actor.role === 'client_user') {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    actorUserId = guard.actor.userId;
  }

  const triggerSource = cronAuthorized ? 'cron' : 'manual';
  const start = Date.now();
  const db = getAvDb();

  // ---------- Step 1: orphan recovery ----------
  let orphansRequeued = 0;
  let orphansFailed = 0;
  try {
    const [orphans] = await db.query<OrphanRow[]>(
      `SELECT id, retries
         FROM social_outbox
        WHERE status = 'publishing'
          AND claimed_at IS NOT NULL
          AND claimed_at < (NOW() - INTERVAL ${ORPHAN_MINUTES} MINUTE)
        ORDER BY claimed_at ASC
        LIMIT ${BATCH_CAP}`
    );
    for (const o of orphans) {
      if (o.retries >= MAX_RETRIES) {
        await db.execute<ResultSetHeader>(
          `UPDATE social_outbox
              SET status = 'failed',
                  error_message = 'orphaned in publishing; exceeded retry cap',
                  updated_at = NOW()
            WHERE id = ? AND status = 'publishing'`,
          [o.id]
        );
        orphansFailed += 1;
      } else {
        // Re-queue: clear the claim so a later cycle can pick it up cleanly.
        await db.execute<ResultSetHeader>(
          `UPDATE social_outbox
              SET status = 'scheduled', claimed_at = NULL, updated_at = NOW()
            WHERE id = ? AND status = 'publishing'`,
          [o.id]
        );
        orphansRequeued += 1;
      }
    }
  } catch (err) {
    await logEvent({
      eventType: 'social.publish_cron_error',
      source: 'cron',
      status: 'failure',
      payload: { stage: 'orphan_recovery', trigger_source: triggerSource },
      errorMessage: (err as Error).message.slice(0, 500)
    });
    // Non-fatal: continue to the publish pass.
  }

  // ---------- Step 2: select due scheduled rows ----------
  let due: DueRow[] = [];
  try {
    // LIMIT is inlined (constant, never user input) because mysql2 + HostGator
    // MariaDB throws ER_WRONG_ARGUMENTS on a prepared LIMIT ?.
    const [rows] = await db.query<DueRow[]>(
      `SELECT id, tenant_id, retries
         FROM social_outbox
        WHERE status = 'scheduled'
          AND scheduled_for IS NOT NULL
          AND scheduled_for <= NOW()
        ORDER BY scheduled_for ASC, id ASC
        LIMIT ${BATCH_CAP}`
    );
    due = rows;
  } catch (err) {
    await logEvent({
      eventType: 'social.publish_cron_error',
      source: 'cron',
      status: 'failure',
      payload: { stage: 'select_due', trigger_source: triggerSource },
      errorMessage: (err as Error).message.slice(0, 500)
    });
    return NextResponse.json(
      { error: 'due_select_failed', message: (err as Error).message.slice(0, 300) },
      { status: 500 }
    );
  }

  // ---------- Step 3: claim + publish (per-tenant fairness cap) ----------
  const perTenantCount = new Map<string, number>();
  let published = 0;
  let failed = 0;
  let skippedRace = 0;
  let cappedByTenant = 0;
  let stoppedEarly = false;
  const results: Array<{ outboxId: number; tenant: string; outcome: string }> = [];

  for (const row of due) {
    if (Date.now() - start > SOFT_DEADLINE_MS) {
      stoppedEarly = true;
      break;
    }
    const used = perTenantCount.get(row.tenant_id) ?? 0;
    if (used >= PER_TENANT_CAP) {
      cappedByTenant += 1;
      continue;
    }

    // CLAIM: only the run whose conditional UPDATE affects 1 row owns the post.
    let claimed = false;
    try {
      const [res] = await db.execute<ResultSetHeader>(
        `UPDATE social_outbox
            SET status = 'publishing', claimed_at = NOW(), updated_at = NOW()
          WHERE id = ? AND status = 'scheduled' AND scheduled_for <= NOW()`,
        [row.id]
      );
      claimed = res.affectedRows === 1;
    } catch (err) {
      console.error('[social:publish-due:claim]', row.id, (err as Error).message);
    }
    if (!claimed) {
      skippedRace += 1;
      results.push({ outboxId: row.id, tenant: row.tenant_id, outcome: 'skipped_race' });
      continue;
    }

    perTenantCount.set(row.tenant_id, used + 1);

    // PUBLISH via the existing entrypoint (it logs social.published /
    // social.publish_failed + writes social_publish_log + flips the row state).
    try {
      const result = await publishOutboxRow(row.id);
      if (result.ok) {
        published += 1;
        results.push({ outboxId: row.id, tenant: row.tenant_id, outcome: 'published' });
      } else {
        failed += 1;
        results.push({ outboxId: row.id, tenant: row.tenant_id, outcome: `failed:${result.error ?? 'unknown'}`.slice(0, 120) });
      }
    } catch (err) {
      // publishOutboxRow only throws if the row vanished; leave the row in
      // 'publishing' for orphan recovery to handle next cycle.
      failed += 1;
      results.push({ outboxId: row.id, tenant: row.tenant_id, outcome: 'threw' });
      console.error('[social:publish-due:publish]', row.id, (err as Error).message);
    }
  }

  const elapsedMs = Date.now() - start;
  await logEvent({
    eventType: 'social.publish_cron_run',
    userId: actorUserId,
    source: 'cron',
    status: failed > 0 && published === 0 ? 'failure' : stoppedEarly ? 'partial' : 'success',
    payload: {
      trigger_source: triggerSource,
      due: due.length,
      published,
      failed,
      skipped_race: skippedRace,
      capped_by_tenant: cappedByTenant,
      orphans_requeued: orphansRequeued,
      orphans_failed: orphansFailed,
      stopped_early: stoppedEarly
    },
    executionTimeMs: elapsedMs
  });

  return NextResponse.json({
    ok: true,
    triggerSource,
    elapsedMs,
    due: due.length,
    published,
    failed,
    skippedRace,
    cappedByTenant,
    orphansRequeued,
    orphansFailed,
    stoppedEarly,
    results
  });
}
