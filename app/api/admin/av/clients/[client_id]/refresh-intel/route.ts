/**
 * POST /api/admin/av/clients/[client_id]/refresh-intel  (#203)
 *
 * One-click "force-regenerate the AI intel for this client's leads" -- replaces
 * the phpMyAdmin SQL pattern documented in Atlantic_Hub_Playbook/phpMyAdmin_Command_Reference.md
 * (section "Force-refresh AI-generated content").
 *
 * Body: { audits?: boolean, callScripts?: boolean, outreach?: boolean }
 *   At least one must be true.
 *
 * What each toggle does:
 *   - audits        -> nulls ai_last_scored_at + audit_content + ai_score_reason for this
 *                       client's leads, then regenerates inline up to the soft deadline.
 *   - callScripts   -> nulls pain_extracted_at + pain_point_profile, regenerates inline.
 *   - outreach      -> deletes outreach_messages where status in ('draft', 'pending_approval')
 *                       for this client's leads. Already-sent emails are NEVER touched.
 *
 * Inline regeneration is bounded by SOFT_DEADLINE_MS so the function returns gracefully
 * rather than timing out hard on Netlify (60s maxDuration). If we hit the deadline mid-batch,
 * the response sets stoppedEarly=true and the user can click the button again to drain the
 * remaining leads -- the columns are already nulled so the next pass picks them up.
 *
 * Owner/staff only -- forbidden for client_users.
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

// (#206 + later tightening) After moving to longer Mode-A prompts in #201/#202,
// individual gpt-4o-mini calls can run 12-20s. 30s leaves room for one in-flight
// 20s call to finish before Netlify's 60s ceiling.
const SOFT_DEADLINE_MS = 30_000;

interface RefreshResult {
  totalLeads: number;
  audits: { reset: number; regenerated: number; failed: number };
  callScripts: { reset: number; regenerated: number; failed: number };
  outreach: { deleted: number };
  stoppedEarly: boolean;
  elapsedMs: number;
}

export async function POST(req: NextRequest, { params }: { params: { client_id: string } }) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/clients/refresh-intel:POST',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  if (!(await isFlagEnabled('tab_av_enabled'))) {
    return NextResponse.json({ error: 'av tab disabled' }, { status: 403 });
  }

  const clientId = Number.parseInt(params.client_id, 10);
  if (!Number.isFinite(clientId) || clientId <= 0) {
    return NextResponse.json({ error: 'invalid client id' }, { status: 400 });
  }

  let body: { audits?: unknown; callScripts?: unknown; outreach?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
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
    totalLeads: 0,
    audits: { reset: 0, regenerated: 0, failed: 0 },
    callScripts: { reset: 0, regenerated: 0, failed: 0 },
    outreach: { deleted: 0 },
    stoppedEarly: false,
    elapsedMs: 0
  };

  try {
    // Pull every non-archived lead this client owns. Ordered by recency so the
    // freshest leads regenerate first if we hit the deadline.
    const [leadRows] = await db.execute<(RowDataPacket & { id: number })[]>(
      `SELECT id FROM leads
        WHERE client_id = ? AND archived_at IS NULL
        ORDER BY last_activity_at DESC, id DESC`,
      [clientId]
    );
    const leadIds = leadRows.map((r) => r.id);
    result.totalLeads = leadIds.length;

    if (leadIds.length === 0) {
      result.elapsedMs = Date.now() - start;
      return NextResponse.json({ ok: true, ...result });
    }

    // ---- AUDITS ----
    if (doAudits) {
      const [upd] = await db.execute<ResultSetHeader>(
        `UPDATE leads
            SET ai_last_scored_at = NULL,
                audit_content     = NULL,
                ai_score_reason   = NULL
          WHERE client_id = ? AND archived_at IS NULL`,
        [clientId]
      );
      result.audits.reset = upd.affectedRows;

      for (const id of leadIds) {
        if (Date.now() - start > SOFT_DEADLINE_MS) {
          result.stoppedEarly = true;
          break;
        }
        try {
          const res = await scoreAndAuditLead(id);
          if (res && !res.skipped) result.audits.regenerated += 1;
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
          WHERE client_id = ? AND archived_at IS NULL`,
        [clientId]
      );
      result.callScripts.reset = upd.affectedRows;

      for (const id of leadIds) {
        if (Date.now() - start > SOFT_DEADLINE_MS) {
          result.stoppedEarly = true;
          break;
        }
        try {
          const res = await extractPainProfileForLead(id);
          if (res !== null) result.callScripts.regenerated += 1;
        } catch (err) {
          result.callScripts.failed += 1;
          console.error('[refresh-intel:pain]', id, (err as Error).message);
        }
      }
    }

    // ---- OUTREACH DRAFTS ----
    // No inline regeneration here -- outreach drafts are per-campaign and generated
    // on demand by the operator. We just clear the stale drafts.
    if (doOutreach) {
      const placeholders = leadIds.map(() => '?').join(',');
      const [del] = await db.execute<ResultSetHeader>(
        `DELETE FROM outreach_messages
          WHERE lead_id IN (${placeholders})
            AND status IN ('draft', 'pending_approval')`,
        leadIds
      );
      result.outreach.deleted = del.affectedRows;
    }

    // (#177 fix) Bust the dashboard-guidance cache for every client_user under
    // this client, so the next dashboard load recomposes from the freshly
    // regenerated lead data instead of serving the old cached cards. Stale
    // guidance was the reason Skip's dashboard kept showing Carrier HVAC's pain
    // even after we re-extracted pain profiles in EHP voice.
    try {
      const [delResult] = await db.execute<ResultSetHeader>(
        `DELETE FROM intelligence_objects
          WHERE object_type IN ('next_best_moves', 'momentum_signals')
            AND tenant_id IN (
              SELECT CONCAT('client:', client_user_id) FROM client_users WHERE client_id = ?
            )`,
        [clientId]
      );
      // Just log this -- never let it block the response.
      console.log(`[refresh-intel] cleared ${delResult.affectedRows} cached guidance objects for client ${clientId}`);
    } catch (err) {
      console.error('[refresh-intel:guidance-clear]', (err as Error).message);
    }

    result.elapsedMs = Date.now() - start;

    await logEvent({
      eventType: 'client.refresh_intel',
      userId: guard.actor.userId,
      source: 'manual',
      executionTimeMs: result.elapsedMs,
      payload: {
        client_id: clientId,
        do_audits: doAudits,
        do_call_scripts: doCallScripts,
        do_outreach: doOutreach,
        ...result
      }
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error('[refresh-intel]', (err as Error).message);
    return NextResponse.json(
      { error: 'refresh_failed', message: (err as Error).message.slice(0, 300) },
      { status: 500 }
    );
  }
}
