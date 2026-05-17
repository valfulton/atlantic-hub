import { NextRequest, NextResponse } from 'next/server';
import { getAvDb } from '@/lib/db/av';
import { guardAdminRequest } from '@/lib/api-guard';
import { isFlagEnabled, mysqlBoolToJs } from '@/lib/feature-flags';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

export const runtime = 'nodejs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function safeParse(val: string | object | null | undefined): object | null {
  if (val === null || val === undefined) return null;
  if (typeof val === 'object') return val;
  try { return JSON.parse(val); } catch { return null; }
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
  tags: string | object | null;
  last_activity_at: string | null;
  client_id: number | null;
  pipeline_stage_id: number | null;
  source_type: string;
  target_business: 'av' | 'ebw' | 'both';
  archived_at: string | null;
  created_at: string;
  updated_at: string;
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
              challenge, audit_content, audit_generated, is_approved, approval_date,
              approved_by, submission_date, lead_status, follow_up_date, notes,
              ai_score, ai_score_band, ai_score_reason, ai_score_breakdown, ai_audit,
              ai_email_subject, ai_email_body, ai_last_scored_at, ai_model_version,
              tags, last_activity_at, client_id, pipeline_stage_id, source_type,
              target_business, archived_at,
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
        tags: safeParse(r.tags as string | object | null),
        lastActivityAt: r.last_activity_at,
        clientId: r.client_id,
        pipelineStageId: r.pipeline_stage_id,
        sourceType: r.source_type,
        targetBusiness: r.target_business,
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

const VALID_LEAD_STATUS = new Set(['new', 'contacted', 'qualified', 'converted', 'lost']);
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

      await conn.commit();
      return NextResponse.json({ ok: true, updated: result.affectedRows });
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
