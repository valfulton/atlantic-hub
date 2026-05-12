import { NextRequest, NextResponse } from 'next/server';
import { getAvDb } from '@/lib/db/av';
import { guardAdminRequest } from '@/lib/api-guard';
import { isFlagEnabled, mysqlBoolToJs } from '@/lib/feature-flags';
import type { RowDataPacket } from 'mysql2';

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
      `SELECT id, audit_id, company, contact_name, email, phone, website, industry,
              challenge, audit_content, audit_generated, is_approved, approval_date,
              approved_by, submission_date, lead_status, follow_up_date, notes,
              ai_score, ai_score_band, ai_score_reason, ai_score_breakdown, ai_audit,
              ai_email_subject, ai_email_body, ai_last_scored_at, ai_model_version,
              tags, last_activity_at, client_id, pipeline_stage_id, source_type,
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
        createdAt: r.created_at,
        updatedAt: r.updated_at
      }
    });
  } catch (err) {
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}
