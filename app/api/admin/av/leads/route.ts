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
  contact_title: string | null;
  email: string;
  industry: string | null;
  lead_status: 'new' | 'contacted' | 'qualified' | 'converted' | 'lost';
  ai_score: number | null;
  ai_score_band: 'hot' | 'warm' | 'cool' | null;
  submission_date: string;
  source_type: string;
  client_id: number | null;
  enrichment_status: string | null;
  enriched_at: string | null;
}

const VALID_STAGES = new Set(['new', 'contacted', 'qualified', 'converted', 'lost']);
const VALID_SOURCES = new Set(['audit_form', 'csv', 'scrape', 'manual', 'api']);
const VALID_ENRICHMENT = new Set(['enriched', 'failed_no_domain', 'failed_no_results', 'failed_permanent', 'pending']);

// URL sort key → SQL column (whitelist; never inject user input into ORDER BY)
const SORT_COLUMN: Record<string, string> = {
  company: 'company',
  contact: 'contact_name',
  email: 'email',
  industry: 'industry',
  status: 'lead_status',
  score: 'ai_score',
  band: 'ai_score_band',
  submitted: 'submission_date',
  enriched: 'enriched_at'
};

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
  const enrichmentRaw = url.searchParams.get('enrichment') ?? '';
  const sortRaw = (url.searchParams.get('sort') ?? '').toLowerCase();
  const directionRaw = (url.searchParams.get('direction') ?? 'desc').toLowerCase();

  const stageFilter = VALID_STAGES.has(stageRaw) ? stageRaw : null;
  const sourceFilter = VALID_SOURCES.has(sourceRaw) ? sourceRaw : null;
  const enrichmentFilter = VALID_ENRICHMENT.has(enrichmentRaw) ? enrichmentRaw : null;

  const sortColumn = SORT_COLUMN[sortRaw] ?? 'submission_date';
  const direction = directionRaw === 'asc' ? 'ASC' : 'DESC';

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
    if (enrichmentFilter) {
      if (enrichmentFilter === 'pending') {
        conditions.push('enrichment_status IS NULL');
      } else {
        conditions.push('enrichment_status = ?');
        params.push(enrichmentFilter);
      }
    }

    // NULLs sort last in either direction (handle gracefully for ai_score etc.)
    const nullsHandling = direction === 'ASC' ? 'IS NULL ASC' : 'IS NULL ASC';
    const orderBy = `${sortColumn} ${nullsHandling}, ${sortColumn} ${direction}, id DESC`;

    const [rows] = await db.execute<LeadRow[]>(
      `SELECT id, audit_id, company, contact_name, contact_title, email, industry,
              lead_status, ai_score, ai_score_band, submission_date, source_type, client_id,
              enrichment_status, enriched_at
       FROM leads
       WHERE ${conditions.join(' AND ')}
       ORDER BY ${orderBy}
       LIMIT 500`,
      params
    );

    const leads = rows.map((r) => ({
      id: r.id,
      auditId: r.audit_id,
      company: r.company,
      contactName: r.contact_name,
      contactTitle: r.contact_title,
      email: r.email,
      industry: r.industry,
      leadStatus: r.lead_status,
      aiScore: r.ai_score === null ? null : Number(r.ai_score),
      aiScoreBand: r.ai_score_band,
      submissionDate: r.submission_date,
      sourceType: r.source_type,
      clientId: r.client_id,
      enrichmentStatus: r.enrichment_status,
      enrichedAt: r.enriched_at
    }));

    return NextResponse.json({
      leads,
      sort: { key: sortRaw || 'submitted', direction: direction.toLowerCase() }
    });
  } catch (err) {
    console.error('[av:leads:db-error]', (err as Error).message);
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}
