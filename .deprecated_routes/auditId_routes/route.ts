/**
 * GET   /api/admin/av/leads/[auditId]
 *   Returns the full lead row + last 50 notes + last 100 events.
 *
 * PATCH /api/admin/av/leads/[auditId]
 *   Body: { pipelineStageKey?, tags?, archived? (true|false) }
 *   Each mutation emits the right lead_events row and an audit_log_global row.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAvDb } from '@/lib/db/av';
import { guardAdminRequest } from '@/lib/api-guard';
import { isFlagEnabled } from '@/lib/feature-flags';
import { resolveLeadByAuditId } from '@/lib/av/leads';
import { writeLeadEvent, mapPlatformRoleToAvActorRole } from '@/lib/av/events';
import { writeAuditRow, extractClientIp } from '@/lib/audit';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

export const runtime = 'nodejs';

interface LeadDetailRow extends RowDataPacket {
  lead_id: number;
  audit_id: string;
  pipeline_stage_id: number | null;
  full_name: string;
  title: string | null;
  company: string | null;
  location: string | null;
  email: string | null;
  phone: string | null;
  linkedin_url: string | null;
  ai_score: number | null;
  ai_score_band: 'hot' | 'warm' | 'cool' | null;
  ai_score_reason: string | null;
  ai_score_breakdown: unknown;
  ai_audit: unknown;
  ai_email_subject: string | null;
  ai_email_body: string | null;
  ai_last_scored_at: string | null;
  ai_model_version: string | null;
  source_type: 'csv' | 'scrape' | 'manual' | 'api';
  source_payload: unknown;
  tags: unknown;
  last_activity_at: string | null;
  consent_basis: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  stage_key: string | null;
  stage_name: string | null;
}

interface NoteRow extends RowDataPacket {
  lead_note_id: number;
  author_user_id: number | null;
  author_role: 'owner' | 'operator' | 'client_user' | 'system';
  body: string;
  is_internal: number | boolean;
  created_at: string;
}

interface EventRow extends RowDataPacket {
  lead_event_id: number;
  event_type: string;
  event_payload: unknown;
  actor_user_id: number | null;
  actor_role: string | null;
  occurred_at: string;
}

export async function GET(req: NextRequest, ctx: { params: { auditId: string } }) {
  const guard = await guardAdminRequest(req, {
    targetResource: `/api/admin/av/leads/${ctx.params.auditId}`,
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;

  if (!(await isFlagEnabled('tab_av_enabled'))) {
    return NextResponse.json({ error: 'av tab disabled' }, { status: 503 });
  }

  try {
    const resolved = await resolveLeadByAuditId(ctx.params.auditId);
    if (!resolved) return NextResponse.json({ error: 'not found' }, { status: 404 });

    const db = getAvDb();
    const [leadRows] = await db.execute<LeadDetailRow[]>(
      `SELECT l.lead_id, l.audit_id, l.pipeline_stage_id,
              l.full_name, l.title, l.company, l.location, l.email, l.phone,
              l.linkedin_url,
              l.ai_score, l.ai_score_band, l.ai_score_reason,
              l.ai_score_breakdown, l.ai_audit,
              l.ai_email_subject, l.ai_email_body,
              l.ai_last_scored_at, l.ai_model_version,
              l.source_type, l.source_payload, l.tags,
              l.last_activity_at, l.consent_basis,
              l.archived_at, l.created_at, l.updated_at,
              s.stage_key, s.stage_name
       FROM leads l
       LEFT JOIN pipeline_stages s ON s.pipeline_stage_id = l.pipeline_stage_id
       WHERE l.lead_id = ? LIMIT 1`,
      [resolved.leadId]
    );
    if (leadRows.length === 0) return NextResponse.json({ error: 'not found' }, { status: 404 });
    const l = leadRows[0];

    const [noteRows] = await db.execute<NoteRow[]>(
      `SELECT lead_note_id, author_user_id, author_role, body, is_internal, created_at
       FROM lead_notes
       WHERE lead_id = ?
       ORDER BY created_at DESC
       LIMIT 50`,
      [resolved.leadId]
    );

    const [eventRows] = await db.execute<EventRow[]>(
      `SELECT lead_event_id, event_type, event_payload, actor_user_id, actor_role, occurred_at
       FROM lead_events
       WHERE lead_id = ?
       ORDER BY occurred_at DESC
       LIMIT 100`,
      [resolved.leadId]
    );

    return NextResponse.json({
      client: {
        slug: resolved.client.clientSlug,
        name: resolved.client.clientName,
        uuid: resolved.client.clientUuid
      },
      lead: {
        auditId: l.audit_id,
        fullName: l.full_name,
        title: l.title,
        company: l.company,
        location: l.location,
        email: l.email,
        phone: l.phone,
        linkedinUrl: l.linkedin_url,
        stageKey: l.stage_key,
        stageName: l.stage_name,
        aiScore: l.ai_score,
        aiScoreBand: l.ai_score_band,
        aiScoreReason: l.ai_score_reason,
        aiScoreBreakdown: l.ai_score_breakdown ?? null,
        aiAudit: l.ai_audit ?? null,
        aiEmailSubject: l.ai_email_subject,
        aiEmailBody: l.ai_email_body,
        aiLastScoredAt: l.ai_last_scored_at,
        aiModelVersion: l.ai_model_version,
        sourceType: l.source_type,
        sourcePayload: l.source_payload ?? null,
        tags: l.tags ?? null,
        lastActivityAt: l.last_activity_at,
        consentBasis: l.consent_basis,
        archivedAt: l.archived_at,
        createdAt: l.created_at,
        updatedAt: l.updated_at
      },
      notes: noteRows.map((n) => ({
        noteId: n.lead_note_id,
        authorUserId: n.author_user_id,
        authorRole: n.author_role,
        body: n.body,
        isInternal: Boolean(n.is_internal),
        createdAt: n.created_at
      })),
      events: eventRows.map((e) => ({
        eventId: e.lead_event_id,
        eventType: e.event_type,
        payload: e.event_payload ?? null,
        actorUserId: e.actor_user_id,
        actorRole: e.actor_role,
        occurredAt: e.occurred_at
      }))
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'server error', errorClass: (err as Error).name },
      { status: 500 }
    );
  }
}

interface PatchLeadBody {
  pipelineStageKey?: string | null;
  tags?: string[] | null;
  archived?: boolean;
}

export async function PATCH(req: NextRequest, ctx: { params: { auditId: string } }) {
  const guard = await guardAdminRequest(req, {
    targetResource: `/api/admin/av/leads/${ctx.params.auditId}`,
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;

  if (!(await isFlagEnabled('tab_av_enabled'))) {
    return NextResponse.json({ error: 'av tab disabled' }, { status: 503 });
  }

  let body: PatchLeadBody;
  try {
    body = (await req.json()) as PatchLeadBody;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const resolved = await resolveLeadByAuditId(ctx.params.auditId);
  if (!resolved) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const db = getAvDb();
  const updates: string[] = [];
  const params: unknown[] = [];
  const events: { type: 'stage_changed' | 'tag_added' | 'tag_removed' | 'archived'; payload: Record<string, unknown> }[] = [];
  let newPipelineStageId: number | null | undefined;

  if (body.pipelineStageKey !== undefined) {
    if (body.pipelineStageKey === null) {
      newPipelineStageId = null;
    } else {
      const [stageRows] = await db.execute<(RowDataPacket & { pipeline_stage_id: number })[]>(
        `SELECT pipeline_stage_id FROM pipeline_stages
         WHERE client_id = ? AND stage_key = ? AND archived_at IS NULL LIMIT 1`,
        [resolved.client.clientId, body.pipelineStageKey]
      );
      if (stageRows.length === 0) {
        return NextResponse.json({ error: 'unknown pipelineStageKey' }, { status: 400 });
      }
      newPipelineStageId = stageRows[0].pipeline_stage_id;
    }
    updates.push('pipeline_stage_id = ?');
    params.push(newPipelineStageId);
    events.push({
      type: 'stage_changed',
      payload: { pipelineStageKey: body.pipelineStageKey }
    });
  }

  if (body.tags !== undefined) {
    updates.push('tags = ?');
    params.push(body.tags ? JSON.stringify(body.tags) : null);
    // Coarse-grained: emit a single tag_added event with the new full set.
    // The detail panel uses the full snapshot rather than diffing.
    events.push({ type: 'tag_added', payload: { tags: body.tags } });
  }

  if (body.archived !== undefined) {
    updates.push('archived_at = ?');
    params.push(body.archived ? new Date() : null);
    if (body.archived) events.push({ type: 'archived', payload: {} });
  }

  if (updates.length === 0) {
    return NextResponse.json({ error: 'no fields to update' }, { status: 400 });
  }

  updates.push('last_activity_at = CURRENT_TIMESTAMP');
  params.push(resolved.leadId);

  try {
    await db.execute<ResultSetHeader>(
      `UPDATE leads SET ${updates.join(', ')} WHERE lead_id = ?`,
      params
    );

    const avActorRole = mapPlatformRoleToAvActorRole(guard.actor.role);
    for (const ev of events) {
      await writeLeadEvent({
        clientId: resolved.client.clientId,
        leadId: resolved.leadId,
        eventType: ev.type,
        payload: ev.payload,
        actorUserId: guard.actor.userId,
        actorRole: avActorRole
      });
    }

    await writeAuditRow({
      actorUserId: guard.actor.userId,
      actorRole: guard.actor.role,
      tenantId: 'av',
      targetResource: `/api/admin/av/leads/${ctx.params.auditId}`,
      action: 'av_lead_updated',
      ip: extractClientIp(req.headers),
      userAgent: req.headers.get('user-agent'),
      statusCode: 200
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: 'server error', errorClass: (err as Error).name },
      { status: 500 }
    );
  }
}
