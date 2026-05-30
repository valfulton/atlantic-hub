import { NextRequest, NextResponse } from 'next/server';
import { getAvDb } from '@/lib/db/av';
import { guardAdminRequest } from '@/lib/api-guard';
import { isFlagEnabled, mysqlBoolToJs } from '@/lib/feature-flags';
import { getClientDealModel, leadMonthlyCents, annualCents } from '@/lib/sales/deal_model';
import { listLeadAudits } from '@/lib/ai/lead_audits';
import { prospectIntelFrom } from '@/lib/client/lead_detail';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

export const runtime = 'nodejs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function safeParse(val: string | object | null | undefined): object | null {
  if (val === null || val === undefined) return null;
  if (typeof val === 'object') return val;
  try { return JSON.parse(val); } catch { return null; }
}

/** (#252 Inc 3) True when source_payload carries an apollo_organization_id —
 *  gates the "Find another POC" button which can only re-call Apollo when
 *  the lead originally came from organization_top_people. */
function hasApolloOrgFrom(raw: string | object | null): boolean {
  const o = safeParse(raw);
  if (!o || typeof o !== 'object') return false;
  const v = (o as Record<string, unknown>)['apollo_organization_id'];
  return typeof v === 'string' && v.trim().length > 0;
}

interface LeadDetailRow extends RowDataPacket {
  id: number;
  audit_id: string;
  company: string;
  contact_name: string | null;
  email: string;
  phone: string | null;
  website: string | null;
  industry: string | null;
  contact_title: string | null;
  enrichment_status: string | null;
  enriched_at: string | null;
  /** (#207) Address columns (#180) so the operator Identity tab can show
   *  the geography that's already feeding the AI prompts. */
  address_street: string | null;
  address_city: string | null;
  address_state: string | null;
  address_postal: string | null;
  address_country: string | null;
  /** (#212) Estimated employee count extracted from Apollo's
   *  source_payload.apollo_estimated_num_employees JSON field. May be
   *  null for non-Apollo leads or Apollo orgs Apollo didn't size. */
  employee_count_est: string | null;
  challenge: string | null;
  audit_content: string | null;
  audit_generated: string | null;
  is_approved: unknown;
  approval_date: string | null;
  approved_by: string | null;
  submission_date: string;
  lead_status: string;
  follow_up_date: string | null;
  notes: string | null;
  ai_score: number | null;
  ai_score_band: string | null;
  ai_score_reason: string | null;
  ai_score_breakdown: string | object | null;
  ai_audit: string | object | null;
  ai_email_subject: string | null;
  ai_email_body: string | null;
  ai_last_scored_at: string | null;
  ai_model_version: string | null;
  ai_engagement_score: number | null;
  ai_combined_score: number | null;
  engagement_score_updated_at: string | null;
  score_history: string | object | null;
  pain_point_profile: string | object | null;
  pain_extracted_at: string | null;
  assigned_to_user_id: number | null;
  handed_to_owner_at: string | null;
  wake_at_date: string | null;
  parked_reason: string | null;
  tags: string | object | null;
  last_activity_at: string | null;
  client_id: number | null;
  pipeline_stage_id: number | null;
  source_type: string;
  target_business: 'av' | 'ebw' | 'both';
  deal_unit_count: number | null;
  deal_flat_cents: number | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  /** (#253) Raw provenance + smart-scrape stash for the prospect-intel panel. */
  source_payload: string | object | null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { audit_id: string } }
) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/leads/[audit_id]',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;

  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  if (!(await isFlagEnabled('tab_av_enabled'))) {
    return NextResponse.json({ error: 'av tab disabled' }, { status: 403 });
  }

  if (!UUID_RE.test(params.audit_id)) {
    return NextResponse.json({ error: 'invalid audit_id' }, { status: 400 });
  }

  try {
    const db = getAvDb();
    const [rows] = await db.execute<LeadDetailRow[]>(
      `SELECT id, audit_id, company, contact_name, contact_title, email, phone, website, industry,
              enrichment_status, enriched_at,
              address_street, address_city, address_state, address_postal, address_country,
              JSON_UNQUOTE(JSON_EXTRACT(source_payload, '$.apollo_estimated_num_employees')) AS employee_count_est,
              source_payload,
              challenge, audit_content, audit_generated, is_approved, approval_date,
              approved_by, submission_date, lead_status, follow_up_date, notes,
              ai_score, ai_score_band, ai_score_reason, ai_score_breakdown, ai_audit,
              ai_email_subject, ai_email_body, ai_last_scored_at, ai_model_version,
              ai_engagement_score, ai_combined_score, engagement_score_updated_at, score_history,
              pain_point_profile, pain_extracted_at,
              assigned_to_user_id, handed_to_owner_at, wake_at_date, parked_reason,
              tags, last_activity_at, client_id, pipeline_stage_id, source_type,
              target_business, deal_unit_count, deal_flat_cents, archived_at,
              created_at, updated_at
       FROM leads
       WHERE audit_id = ?
       LIMIT 1`,
      [params.audit_id]
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }

    const r = rows[0];
    // Resolve the owning client's deal model (null for AV-pipeline leads) and
    // compute this lead's monthly/annual value so the detail page can show it.
    const dealModel = await getClientDealModel(r.client_id).catch(() => null);
    const dealUnitCount = r.deal_unit_count == null ? null : Number(r.deal_unit_count);
    const dealFlatCents = r.deal_flat_cents == null ? null : Number(r.deal_flat_cents);
    const dealMonthlyCents = leadMonthlyCents(dealModel, { dealUnitCount, dealFlatCents });
    // Every seller-lens audit this lead has (multi-lens, no-drift) for the picker.
    const auditLenses = await listLeadAudits(r.id).catch(() => []);
    return NextResponse.json({
      lead: {
        id: r.id,
        auditId: r.audit_id,
        company: r.company,
        contactName: r.contact_name,
        contactTitle: r.contact_title,
        enrichmentStatus: r.enrichment_status,
        enrichedAt: r.enriched_at,
        email: r.email,
        phone: r.phone,
        website: r.website,
        industry: r.industry,
        addressStreet: r.address_street,
        addressCity: r.address_city,
        addressState: r.address_state,
        addressPostal: r.address_postal,
        addressCountry: r.address_country,
        employeeCount: r.employee_count_est && /^\d+$/.test(r.employee_count_est)
          ? Number(r.employee_count_est)
          : null,
        challenge: r.challenge,
        auditContent: r.audit_content,
        auditGenerated: r.audit_generated,
        isApproved: mysqlBoolToJs(r.is_approved),
        approvalDate: r.approval_date,
        approvedBy: r.approved_by,
        submissionDate: r.submission_date,
        leadStatus: r.lead_status,
        followUpDate: r.follow_up_date,
        notes: r.notes,
        aiScore: r.ai_score,
        aiScoreBand: r.ai_score_band,
        aiScoreReason: r.ai_score_reason,
        aiScoreBreakdown: safeParse(r.ai_score_breakdown as string | object | null),
        aiAudit: safeParse(r.ai_audit as string | object | null),
        aiEmailSubject: r.ai_email_subject,
        aiEmailBody: r.ai_email_body,
        aiLastScoredAt: r.ai_last_scored_at,
        aiModelVersion: r.ai_model_version,
        aiEngagementScore: r.ai_engagement_score === null ? 0 : Number(r.ai_engagement_score),
        aiCombinedScore: r.ai_combined_score === null ? null : Number(r.ai_combined_score),
        engagementScoreUpdatedAt: r.engagement_score_updated_at,
        scoreHistory: safeParse(r.score_history as string | object | null),
        painPointProfile: safeParse(r.pain_point_profile as string | object | null),
        painExtractedAt: r.pain_extracted_at,
        assignedToUserId: r.assigned_to_user_id === null ? null : Number(r.assigned_to_user_id),
        handedToOwnerAt: r.handed_to_owner_at,
        wakeAtDate: r.wake_at_date,
        parkedReason: r.parked_reason,
        tags: safeParse(r.tags as string | object | null),
        lastActivityAt: r.last_activity_at,
        clientId: r.client_id,
        pipelineStageId: r.pipeline_stage_id,
        sourceType: r.source_type,
        targetBusiness: r.target_business,
        dealUnitCount,
        dealFlatCents,
        dealModel,
        dealMonthlyCents,
        dealAnnualCents: annualCents(dealMonthlyCents),
        auditLenses,
        // (#253) Distilled prospect-research the smart scraper pulled from the
        // lead's website. Renders identical on the operator + client views
        // (shared ProspectIntelPanel component). Returns null when no Smart
        // enrich has run yet, in which case the page hides the panel cleanly.
        prospectIntel: prospectIntelFrom(r.source_payload),
        // (#252 Inc 3) True when source_payload has an apollo_organization_id.
        // Gates the "Find another POC" button — it only works for leads that
        // originally came from Apollo (we need the org id to re-call).
        hasApolloOrg: hasApolloOrgFrom(r.source_payload),
        archivedAt: r.archived_at,
        createdAt: r.created_at,
        updatedAt: r.updated_at
      }
    });
  } catch (err) {
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}

/**
 * PATCH /api/admin/av/leads/[audit_id]
 *
 * Updates allowed editable fields on a lead and writes a lead_events row
 * for each meaningful change in the same transaction. Whitelist of fields:
 *   leadStatus, pipelineStageId, followUpDate, notes, tags, targetBusiness,
 *   archived (boolean — soft delete)
 *
 * Requests with no recognised fields return 400. Empty-string and null
 * are accepted for nullable text columns to allow clearing.
 */

const VALID_LEAD_STATUS = new Set([
  'new',
  'contacted',
  'qualified',
  'converted',
  'lost',
  'nurture',
  'not_now',
  'referred',
  'case_study'
]);
const VALID_TARGET_BUSINESS = new Set(['av', 'ebw', 'both']);

export async function PATCH(
  req: NextRequest,
  { params }: { params: { audit_id: string } }
) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/leads/[audit_id]:PATCH',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;

  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  if (!(await isFlagEnabled('tab_av_enabled'))) {
    return NextResponse.json({ error: 'av tab disabled' }, { status: 403 });
  }
  if (!UUID_RE.test(params.audit_id)) {
    return NextResponse.json({ error: 'invalid audit_id' }, { status: 400 });
  }

  let payload: Record<string, unknown> = {};
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json body' }, { status: 400 });
  }

  // Build the SET clause from the whitelist
  const updates: string[] = [];
  const values: unknown[] = [];
  const eventPayload: Record<string, unknown> = {};

  if (typeof payload.leadStatus === 'string') {
    if (!VALID_LEAD_STATUS.has(payload.leadStatus)) {
      return NextResponse.json({ error: 'invalid leadStatus' }, { status: 400 });
    }
    updates.push('lead_status = ?');
    values.push(payload.leadStatus);
    eventPayload.leadStatus = payload.leadStatus;
  }

  if (payload.pipelineStageId === null || typeof payload.pipelineStageId === 'number') {
    updates.push('pipeline_stage_id = ?');
    values.push(payload.pipelineStageId);
    eventPayload.pipelineStageId = payload.pipelineStageId;
  }

  if (payload.followUpDate === null || typeof payload.followUpDate === 'string') {
    // Accept YYYY-MM-DD or full ISO; MySQL will coerce. Reject obviously bad input.
    if (payload.followUpDate !== null && !/^\d{4}-\d{2}-\d{2}/.test(payload.followUpDate)) {
      return NextResponse.json({ error: 'followUpDate must be YYYY-MM-DD or ISO datetime' }, { status: 400 });
    }
    updates.push('follow_up_date = ?');
    values.push(payload.followUpDate);
    eventPayload.followUpDate = payload.followUpDate;
  }

  if (typeof payload.notes === 'string' || payload.notes === null) {
    if (typeof payload.notes === 'string' && payload.notes.length > 8000) {
      return NextResponse.json({ error: 'notes max 8000 chars' }, { status: 400 });
    }
    updates.push('notes = ?');
    values.push(payload.notes);
    eventPayload.notesChanged = true;
  }

  if (payload.tags !== undefined) {
    // Accept a plain object (will be stringified) or null
    if (payload.tags === null) {
      updates.push('tags = ?');
      values.push(null);
    } else if (typeof payload.tags === 'object') {
      updates.push('tags = ?');
      values.push(JSON.stringify(payload.tags));
    } else {
      return NextResponse.json({ error: 'tags must be object or null' }, { status: 400 });
    }
    eventPayload.tagsChanged = true;
  }

  // Manual override of which pipeline this lead belongs to. Defaults set at
  // insert time using the inferTargetBusiness heuristic; this lets you reclassify.
  if (typeof payload.targetBusiness === 'string') {
    if (!VALID_TARGET_BUSINESS.has(payload.targetBusiness)) {
      return NextResponse.json({ error: 'targetBusiness must be av|ebw|both' }, { status: 400 });
    }
    updates.push('target_business = ?');
    values.push(payload.targetBusiness);
    eventPayload.targetBusiness = payload.targetBusiness;
  }

  // Deal metrics (per-client economics). deal_unit_count drives per_head value
  // (e.g. # employees); deal_flat_cents is the flat-mode monthly value. Both
  // accept null to clear.
  if (payload.dealUnitCount === null || typeof payload.dealUnitCount === 'number') {
    const v = payload.dealUnitCount;
    if (v !== null && (!Number.isFinite(v) || v < 0 || v > 10_000_000)) {
      return NextResponse.json({ error: 'dealUnitCount must be a non-negative integer or null' }, { status: 400 });
    }
    updates.push('deal_unit_count = ?');
    values.push(v === null ? null : Math.floor(v));
    eventPayload.dealUnitCount = v;
  }

  if (payload.dealFlatCents === null || typeof payload.dealFlatCents === 'number') {
    const v = payload.dealFlatCents;
    if (v !== null && (!Number.isFinite(v) || v < 0 || v > 100_000_000_00)) {
      return NextResponse.json({ error: 'dealFlatCents must be a non-negative integer or null' }, { status: 400 });
    }
    updates.push('deal_flat_cents = ?');
    values.push(v === null ? null : Math.floor(v));
    eventPayload.dealValueChanged = true;
  }

  // Soft delete / undelete. archived=true → archived_at = NOW().
  // archived=false → archived_at = NULL (restore). Filtered out of the
  // leads list by the WHERE archived_at IS NULL clause on GET.
  if (typeof payload.archived === 'boolean') {
    if (payload.archived) {
      updates.push('archived_at = NOW()');
    } else {
      updates.push('archived_at = NULL');
    }
    eventPayload.archived = payload.archived;
  }

  if (!updates.length) {
    return NextResponse.json({ error: 'no recognised fields to update' }, { status: 400 });
  }

  // Always bump last_activity_at so the leads list re-ranks.
  updates.push('last_activity_at = NOW()');

  try {
    const db = getAvDb();
    const [leadRows] = await db.execute<(RowDataPacket & { id: number; client_id: number | null })[]>(
      'SELECT id, client_id FROM leads WHERE audit_id = ? LIMIT 1',
      [params.audit_id]
    );
    if (leadRows.length === 0) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }
    const lead = leadRows[0];

    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();

      const sql = `UPDATE leads SET ${updates.join(', ')} WHERE id = ?`;
      const [result] = await conn.execute<ResultSetHeader>(sql, [...values, lead.id]);

      // Decide the event_type: stage_changed if leadStatus moved, else 'updated'
      // (lead_events ENUM doesn't include 'updated' — use 'stage_changed' for status moves,
      // 'tag_added' as the generic-update slot if no status moved.)
      let eventType: string = 'stage_changed';
      if (!eventPayload.leadStatus) {
        eventType = eventPayload.tagsChanged ? 'tag_added' : 'note_added';
      }

      await conn.execute<ResultSetHeader>(
        `INSERT INTO lead_events (client_id, lead_id, event_type, event_payload, actor_user_id, actor_role)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          lead.client_id,
          lead.id,
          eventType,
          JSON.stringify(eventPayload),
          guard.actor.userId,
          guard.actor.role
        ]
      );

      // (#192) On ARCHIVE, sweep this lead's stale per-client guidance + the
      // client-lens audit row so an archived lead never surfaces stale "next
      // best move" cards on the owner's dashboard, and a future restore-to-the
      // -same-client regenerates fresh intel grounded in whatever the brief
      // says NOW. The 'av' lens row stays as forensic history.
      // Same #188 cleanup pattern; runs inside the same transaction so a
      // partial archive can't leave dangling intel.
      let archiveGuidanceCleaned = 0;
      let archiveLensCleaned = 0;
      if (eventPayload.archived === true && lead.client_id != null) {
        const [delGuidance] = await conn.execute<ResultSetHeader>(
          `DELETE FROM intelligence_objects
            WHERE tenant_id = ?
              AND object_type IN ('next_best_moves','momentum_signals')
              AND lead_id = ?`,
          [`client:${lead.client_id}`, lead.id]
        );
        archiveGuidanceCleaned = delGuidance.affectedRows ?? 0;
        const [delLens] = await conn.execute<ResultSetHeader>(
          `DELETE FROM lead_audits WHERE lead_id = ? AND lens = ?`,
          [lead.id, `client:${lead.client_id}`]
        );
        archiveLensCleaned = delLens.affectedRows ?? 0;
      }

      await conn.commit();
      return NextResponse.json({
        ok: true,
        updated: result.affectedRows,
        archiveGuidanceCleaned,
        archiveLensCleaned
      });
    } catch (txErr) {
      await conn.rollback();
      throw txErr;
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error('[av:lead:patch]', (err as Error).message);
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}
