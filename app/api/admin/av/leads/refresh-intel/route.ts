/**
 * POST /api/admin/av/leads/refresh-intel  (#205)
 *
 * Bulk / per-lead variant of the per-client refresh-intel endpoint (#203).
 * Caller passes an explicit list of audit_ids -- works for one lead (per-row
 * refresh on the intel-freshness page) and for many leads (bulk "refresh
 * selected" toolbar).
 *
 * Body: {
 *   auditIds: string[],
 *   audits?: boolean,
 *   callScripts?: boolean,
 *   outreach?: boolean
 * }
 *
 * Behavior mirrors the per-client endpoint:
 *   - audits        -> null ai_last_scored_at + audit_content + ai_score_reason,
 *                       regenerate inline via scoreAndAuditLead.
 *   - callScripts   -> null pain_extracted_at + pain_point_profile,
 *                       regenerate inline via extractPainProfileForLead.
 *   - outreach      -> delete outreach_messages where status in ('draft','pending_approval').
 *
 * Bounded by SOFT_DEADLINE_MS so Netlify's 60s ceiling never trips a hard timeout.
 * If we stop early, the columns are already nulled -- call again to resume.
 *
 * Owner/staff only. Forbidden for client_users.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { isFlagEnabled } from '@/lib/feature-flags';
import { getAvDb } from '@/lib/db/av';
import { scoreAndAuditLead } from '@/lib/ai/score_and_audit';
import { extractPainProfileForLead } from '@/lib/ai/pain_extractor';
import { logEvent } from '@/lib/events/log';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

export const runtime = 'nodejs';
export const maxDuration = 60;

// (#206) Lowered from 55s to 40s. Each AI call can take 5-10s, so 55s left no
// room for the final in-flight call to finish before Netlify's 60s ceiling.
// At 40s, the worst case is ~50s total (40s + one in-flight ~10s call) which
// stays under the platform timeout cleanly.
const SOFT_DEADLINE_MS = 40_000;
const MAX_LEADS_PER_REQUEST = 200;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RefreshResult {
  requestedLeads: number;
  matchedLeads: number;
  audits: { reset: number; regenerated: number; failed: number };
  callScripts: { reset: number; regenerated: number; failed: number };
  outreach: { deleted: number };
  stoppedEarly: boolean;
  elapsedMs: number;
}

export async function POST(req: NextRequest) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/leads/refresh-intel:POST',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  if (!(await isFlagEnabled('tab_av_enabled'))) {
    return NextResponse.json({ error: 'av tab disabled' }, { status: 403 });
  }

  let body: { auditIds?: unknown; audits?: unknown; callScripts?: unknown; outreach?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const auditIds = Array.isArray(body.auditIds)
    ? body.auditIds.filter((x): x is string => typeof x === 'string' && UUID_RE.test(x)).slice(0, MAX_LEADS_PER_REQUEST)
    : [];
  if (auditIds.length === 0) {
    return NextResponse.json({ error: 'no valid auditIds' }, { status: 400 });
  }

  const doAudits = body.audits === true;
  const doCallScripts = body.callScripts === true;
  const doOutreach = body.outreach === true;
  if (!doAudits && !doCallScripts && !doOutreach) {
    return NextResponse.json({ error: 'nothing_selected' }, { status: 400 });
  }

  const db = getAvDb();
  const start = Date.now();
  const result: RefreshResult = {
    requestedLeads: auditIds.length,
    matchedLeads: 0,
    audits: { reset: 0, regenerated: 0, failed: 0 },
    callScripts: { reset: 0, regenerated: 0, failed: 0 },
    outreach: { deleted: 0 },
    stoppedEarly: false,
    elapsedMs: 0
  };

  try {
    // Resolve audit_ids -> internal numeric ids (only non-archived).
    const placeholders = auditIds.map(() => '?').join(',');
    const [leadRows] = await db.execute<(RowDataPacket & { id: number })[]>(
      `SELECT id FROM leads
        WHERE audit_id IN (${placeholders}) AND archived_at IS NULL`,
      auditIds
    );
    const leadIds = leadRows.map((r) => r.id);
    result.matchedLeads = leadIds.length;
    if (leadIds.length === 0) {
      result.elapsedMs = Date.now() - start;
      return NextResponse.json({ ok: true, ...result });
    }

    const idPh = leadIds.map(() => '?').join(',');

    // ---- AUDITS ----
    if (doAudits) {
      const [upd] = await db.execute<ResultSetHeader>(
        `UPDATE leads
            SET ai_last_scored_at = NULL,
                audit_content     = NULL,
                ai_score_reason   = NULL
          WHERE id IN (${idPh})`,
        leadIds
      );
      result.audits.reset = upd.affectedRows;

      for (const id of leadIds) {
        if (Date.now() - start > SOFT_DEADLINE_MS) {
          result.stoppedEarly = true;
          break;
        }
        try {
          const r = await scoreAndAuditLead(id);
          if (r && !r.skipped) result.audits.regenerated += 1;
        } catch (err) {
          result.audits.failed += 1;
          console.error('[refresh-intel:audit]', id, (err as Error).message);
        }
      }
    }

    // ---- CALL SCRIPTS ----
    if (doCallScripts && !result.stoppedEarly) {
      const [upd] = await db.execute<ResultSetHeader>(
        `UPDATE leads
            SET pain_extracted_at = NULL,
                pain_point_profile = NULL
          WHERE id IN (${idPh})`,
        leadIds
      );
      result.callScripts.reset = upd.affectedRows;

      for (const id of leadIds) {
        if (Date.now() - start > SOFT_DEADLINE_MS) {
          result.stoppedEarly = true;
          break;
        }
        try {
          const r = await extractPainProfileForLead(id);
          if (r !== null) result.callScripts.regenerated += 1;
        } catch (err) {
          result.callScripts.failed += 1;
          console.error('[refresh-intel:pain]', id, (err as Error).message);
        }
      }
    }

    // ---- OUTREACH DRAFTS ----
    if (doOutreach) {
      const [del] = await db.execute<ResultSetHeader>(
        `DELETE FROM outreach_messages
          WHERE lead_id IN (${idPh})
            AND status IN ('draft', 'pending_approval')`,
        leadIds
      );
      result.outreach.deleted = del.affectedRows;
    }

    result.elapsedMs = Date.now() - start;

    await logEvent({
      eventType: 'leads.refresh_intel',
      userId: guard.actor.userId,
      source: 'manual',
      executionTimeMs: result.elapsedMs,
      payload: {
        do_audits: doAudits,
        do_call_scripts: doCallScripts,
        do_outreach: doOutreach,
        ...result
      }
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error('[leads:refresh-intel]', (err as Error).message);
    return NextResponse.json(
      { error: 'refresh_failed', message: (err as Error).message.slice(0, 300) },
      { status: 500 }
    );
  }
}
