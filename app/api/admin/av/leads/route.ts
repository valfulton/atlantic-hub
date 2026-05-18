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
  phone: string | null;
  website: string | null;
  industry: string | null;
  lead_status: 'new' | 'contacted' | 'qualified' | 'converted' | 'lost';
  ai_score: number | null;
  ai_score_band: 'hot' | 'warm' | 'cool' | null;
  ai_score_reason: string | null;
  ai_score_breakdown: string | object | null;
  submission_date: string;
  source_type: string;
  target_business: 'av' | 'ebw' | 'both';
  client_id: number | null;
  enrichment_status: string | null;
  enriched_at: string | null;
}

const VALID_STAGES = new Set(['new', 'contacted', 'qualified', 'converted', 'lost']);
const VALID_SOURCES = new Set(['audit_form', 'csv', 'scrape', 'manual', 'api']);
const VALID_ENRICHMENT = new Set(['enriched', 'failed_no_domain', 'failed_no_results', 'failed_permanent', 'pending']);
const VALID_TARGETS = new Set(['av', 'ebw', 'both']);

// Data-completeness filters — combine with AND. Each pushes a SQL condition.
const VALID_DATA_FILTERS = new Set(['has_real_email', 'has_phone', 'has_website', 'has_contact_name']);

/**
 * "Real email" = anything that doesn't match our placeholder patterns.
 * Patterns: prospect+ebw-NNN@..., apollo+org-..., apollo+person-..., noemail+...,
 * info@eventsbywater.com (catch-all).
 */
const REAL_EMAIL_SQL = `(
  email IS NOT NULL AND email != ''
  AND email NOT LIKE 'prospect+%@eventsbywater.com'
  AND email NOT LIKE 'apollo+%@eventsbywater.com'
  AND email NOT LIKE 'noemail+%@eventsbywater.com'
  AND email != 'info@eventsbywater.com'
)`;

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
  // Multiple data-completeness filters can be sent comma-separated:
  //   ?data=has_real_email,has_phone
  const dataFiltersRaw = (url.searchParams.get('data') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => VALID_DATA_FILTERS.has(s));
  const stageRaw = url.searchParams.get('stage') ?? '';
  const sourceRaw = url.searchParams.get('source_type') ?? '';
  const enrichmentRaw = url.searchParams.get('enrichment') ?? '';
  const targetRaw = url.searchParams.get('target') ?? '';
  const sortRaw = (url.searchParams.get('sort') ?? '').toLowerCase();
  const directionRaw = (url.searchParams.get('direction') ?? 'desc').toLowerCase();

  const stageFilter = VALID_STAGES.has(stageRaw) ? stageRaw : null;
  const sourceFilter = VALID_SOURCES.has(sourceRaw) ? sourceRaw : null;
  const enrichmentFilter = VALID_ENRICHMENT.has(enrichmentRaw) ? enrichmentRaw : null;
  // target=ebw means "show me leads for the EBW pipeline" — that's
  // target_business IN ('ebw','both'). Same idea for av. 'both' as a filter
  // value means exact match on 'both' (rare but useful for triage).
  const targetFilter = VALID_TARGETS.has(targetRaw) ? targetRaw : null;

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
    if (targetFilter) {
      // 'av' filter shows av + both; 'ebw' filter shows ebw + both; 'both'
      // shows only the multi-pipeline ones.
      if (targetFilter === 'both') {
        conditions.push("target_business = 'both'");
      } else {
        conditions.push("target_business IN (?, 'both')");
        params.push(targetFilter);
      }
    }

    // Data-completeness filters (AND across multiple)
    for (const f of dataFiltersRaw) {
      if (f === 'has_real_email') conditions.push(REAL_EMAIL_SQL);
      if (f === 'has_phone') conditions.push("phone IS NOT NULL AND phone != ''");
      if (f === 'has_website') conditions.push("website IS NOT NULL AND website != ''");
      if (f === 'has_contact_name') conditions.push("contact_name IS NOT NULL AND contact_name != '' AND contact_name NOT LIKE '(%'");
    }

    // NULLs sort last in either direction (handle gracefully for ai_score etc.)
    const nullsHandling = direction === 'ASC' ? 'IS NULL ASC' : 'IS NULL ASC';
    const orderBy = `${sortColumn} ${nullsHandling}, ${sortColumn} ${direction}, id DESC`;

    const [rows] = await db.execute<LeadRow[]>(
      `SELECT id, audit_id, company, contact_name, contact_title, email, phone, website, industry,
              lead_status, ai_score, ai_score_band, ai_score_reason, ai_score_breakdown,
              submission_date, source_type, target_business,
              client_id, enrichment_status, enriched_at
       FROM leads
       WHERE ${conditions.join(' AND ')}
       ORDER BY ${orderBy}
       LIMIT 500`,
      params
    );

    // Pre-compute placeholder-email regex once (JS side, since SQL already filtered if requested)
    const placeholderPatterns: RegExp[] = [
      /^prospect\+.*@eventsbywater\.com$/i,
      /^apollo\+.*@eventsbywater\.com$/i,
      /^noemail\+.*@eventsbywater\.com$/i,
      /^info@eventsbywater\.com$/i
    ];
    function isRealEmail(e: string | null): boolean {
      if (!e || !e.trim()) return false;
      return !placeholderPatterns.some((re) => re.test(e.trim()));
    }
    function isRealContactName(n: string | null): boolean {
      if (!n || !n.trim()) return false;
      return !n.trim().startsWith('(');
    }

    function parseBreakdown(v: string | object | null): object | null {
      if (v === null) return null;
      if (typeof v === 'object') return v;
      try { return JSON.parse(v); } catch { return null; }
    }

    const leads = rows.map((r) => {
      const hasRealEmail = isRealEmail(r.email);
      const hasPhone = !!(r.phone && r.phone.trim());
      const hasWebsite = !!(r.website && r.website.trim());
      const hasContactName = isRealContactName(r.contact_name);
      const completeness = (hasRealEmail ? 1 : 0) + (hasPhone ? 1 : 0) + (hasWebsite ? 1 : 0) + (hasContactName ? 1 : 0);
      return {
        id: r.id,
        auditId: r.audit_id,
        company: r.company,
        contactName: r.contact_name,
        contactTitle: r.contact_title,
        email: r.email,
        phone: r.phone,
        website: r.website,
        industry: r.industry,
        leadStatus: r.lead_status,
        aiScore: r.ai_score === null ? null : Number(r.ai_score),
        aiScoreBand: r.ai_score_band,
        aiScoreReason: r.ai_score_reason,
        aiScoreBreakdown: parseBreakdown(r.ai_score_breakdown),
        submissionDate: r.submission_date,
        sourceType: r.source_type,
        targetBusiness: r.target_business,
        clientId: r.client_id,
        enrichmentStatus: r.enrichment_status,
        enrichedAt: r.enriched_at,
        hasRealEmail,
        hasPhone,
        hasWebsite,
        hasContactName,
        completeness
      };
    });

    return NextResponse.json({
      leads,
      sort: { key: sortRaw || 'submitted', direction: direction.toLowerCase() }
    });
  } catch (err) {
    console.error('[av:leads:db-error]', (err as Error).message);
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}
