import { NextRequest, NextResponse } from 'next/server';
import { getAvDb } from '@/lib/db/av';
import { guardAdminRequest } from '@/lib/api-guard';
import { isFlagEnabled } from '@/lib/feature-flags';
import type { RowDataPacket } from 'mysql2';

export const runtime = 'nodejs';

interface LeadRow extends RowDataPacket {
  id: number;
  audit_id: string;
  company: string;
  contact_name: string | null;
  email: string;
  industry: string | null;
  lead_status: 'new' | 'contacted' | 'qualified' | 'converted' | 'lost';
  ai_score_band: 'hot' | 'warm' | 'cool' | null;
  submission_date: string;
  source_type: string;
  client_id: number | null;
}

const VALID_STAGES = new Set(['new', 'contacted', 'qualified', 'converted', 'lost']);
const VALID_SOURCES = new Set(['audit_form', 'csv', 'scrape', 'manual', 'api']);

export async function GET(req: NextRequest) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/leads',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;

  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  if (!(await isFlagEnabled('tab_av_enabled'))) {
    return NextResponse.json({ error: 'av tab disabled' }, { status: 403 });
  }

  const url = new URL(req.url);
  const stageRaw = url.searchParams.get('stage') ?? '';
  const sourceRaw = url.searchParams.get('source_type') ?? '';

  const stageFilter = VALID_STAGES.has(stageRaw) ? stageRaw : null;
  const sourceFilter = VALID_SOURCES.has(sourceRaw) ? sourceRaw : null;

  try {
    const db = getAvDb();
    const conditions: string[] = ['archived_at IS NULL'];
    const params: string[] = [];

    if (stageFilter) {
      conditions.push('lead_status = ?');
      params.push(stageFilter);
    }
    if (sourceFilter) {
      conditions.push('source_type = ?');
      params.push(sourceFilter);
    }

    const [rows] = await db.execute<LeadRow[]>(
      `SELECT id, audit_id, company, contact_name, email, industry,
              lead_status, ai_score_band, submission_date, source_type, client_id
       FROM leads
       WHERE ${conditions.join(' AND ')}
       ORDER BY submission_date DESC
       LIMIT 500`,
      params
    );

    const leads = rows.map((r) => ({
      id: r.id,
      auditId: r.audit_id,
      company: r.company,
      contactName: r.contact_name,
      email: r.email,
      industry: r.industry,
      leadStatus: r.lead_status,
      aiScoreBand: r.ai_score_band,
      submissionDate: r.submission_date,
      sourceType: r.source_type,
      clientId: r.client_id
    }));

    return NextResponse.json({ leads });
  } catch (err) {
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}
