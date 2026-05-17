/**
 * POST /api/admin/av/leads/import-csv
 *
 * Bulk-imports leads from a pasted CSV (or uploaded file passed through as
 * a string in the request body). Used during client onboarding: a client's
 * existing customer/lead list goes in → enriched, scored, deduped leads
 * come out in the operator dashboard.
 *
 * Body: { csv: string, sourceLabel?: string, targetBusiness?: 'av'|'ebw'|'both' }
 *
 * Behavior:
 *   - Parses CSV with header row required
 *   - Fuzzy-maps common column names (company, email, phone, website, etc.)
 *   - Cross-source dedup by normalized domain before insert
 *   - Sets source_type='csv', source_payload includes raw row + source label
 *   - Returns per-row outcomes: inserted | duplicate | invalid | error
 *
 * Limits: 500 rows per upload (anything bigger should be split).
 */
import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { guardAdminRequest } from '@/lib/api-guard';
import { isFlagEnabled } from '@/lib/feature-flags';
import { getAvDb } from '@/lib/db/av';
import { parseCsv, mapHeaders, type HeaderMap } from '@/lib/csv/parser';
import { findExistingLead, normalizeDomain, mergeTargetBusiness } from '@/lib/leads/dedup';
import { inferTargetBusiness, isTargetBusiness, type TargetBusiness } from '@/lib/leads/target_business';
import { logEvent } from '@/lib/events/log';
import { scoreAndAuditLeadBackground } from '@/lib/ai/score_and_audit';
import type { ResultSetHeader } from 'mysql2';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_ROWS = 500;

type Outcome = 'inserted' | 'duplicate_existing' | 'duplicate_target_upgraded' | 'invalid' | 'error';

interface RowResult {
  rowIndex: number;
  outcome: Outcome;
  leadId?: number;
  company?: string;
  email?: string;
  domain?: string;
  reason?: string;
}

export async function POST(req: NextRequest) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/leads/import-csv',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  if (!(await isFlagEnabled('tab_av_enabled'))) {
    return NextResponse.json({ error: 'av tab disabled' }, { status: 403 });
  }

  let payload: Record<string, unknown> = {};
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json body' }, { status: 400 });
  }

  const csv = typeof payload.csv === 'string' ? payload.csv : '';
  if (!csv.trim()) {
    return NextResponse.json({ error: 'csv is required (paste the file contents as a string)' }, { status: 400 });
  }
  const sourceLabel = typeof payload.sourceLabel === 'string' ? payload.sourceLabel.trim().slice(0, 100) : 'csv-upload';
  const tbInput = typeof payload.targetBusiness === 'string' ? payload.targetBusiness : null;
  const explicitTarget: TargetBusiness | null = tbInput && isTargetBusiness(tbInput) ? tbInput : null;

  let rows: string[][];
  try {
    rows = parseCsv(csv);
  } catch (err) {
    return NextResponse.json({ error: `csv parse failed: ${(err as Error).message}` }, { status: 400 });
  }

  if (rows.length < 2) {
    return NextResponse.json({ error: 'csv must include a header row and at least one data row' }, { status: 400 });
  }
  if (rows.length > MAX_ROWS + 1) {
    return NextResponse.json(
      { error: `too many rows (${rows.length - 1}). Max ${MAX_ROWS} per upload — split your file and re-upload.` },
      { status: 400 }
    );
  }

  const headerMap = mapHeaders(rows[0]);
  if (headerMap.company === null && headerMap.email === null && headerMap.website === null) {
    return NextResponse.json(
      {
        error:
          'CSV must include at least one of: Company, Email, or Website columns. Headers we recognize: company, business, name, email, phone, website, url, contact name, industry, notes.',
        detected_headers: rows[0]
      },
      { status: 400 }
    );
  }

  const db = getAvDb();
  const results: RowResult[] = [];
  const dataRows = rows.slice(1);

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    const rowIndex = i + 2; // 1-based + header row

    try {
      const outcome = await processRow(row, headerMap, {
        sourceLabel,
        explicitTarget
      });
      results.push({ rowIndex, ...outcome });
    } catch (err) {
      results.push({
        rowIndex,
        outcome: 'error',
        reason: (err as Error).message.slice(0, 200)
      });
    }
  }

  const insertedCount = results.filter((r) => r.outcome === 'inserted').length;
  const duplicateCount = results.filter((r) => r.outcome === 'duplicate_existing' || r.outcome === 'duplicate_target_upgraded').length;
  const invalidCount = results.filter((r) => r.outcome === 'invalid').length;
  const errorCount = results.filter((r) => r.outcome === 'error').length;

  return NextResponse.json({
    ok: true,
    totalRows: dataRows.length,
    insertedCount,
    duplicateCount,
    invalidCount,
    errorCount,
    headerMap: {
      company: headerMap.company !== null ? rows[0][headerMap.company] : null,
      email: headerMap.email !== null ? rows[0][headerMap.email] : null,
      phone: headerMap.phone !== null ? rows[0][headerMap.phone] : null,
      website: headerMap.website !== null ? rows[0][headerMap.website] : null,
      contactName: headerMap.contactName !== null ? rows[0][headerMap.contactName] : null,
      industry: headerMap.industry !== null ? rows[0][headerMap.industry] : null
    },
    results
  });
}

async function processRow(
  row: string[],
  headerMap: HeaderMap,
  ctx: { sourceLabel: string; explicitTarget: TargetBusiness | null }
): Promise<Omit<RowResult, 'rowIndex'>> {
  function cell(idx: number | null): string {
    if (idx === null || idx >= row.length) return '';
    return (row[idx] ?? '').trim();
  }

  const company = cell(headerMap.company);
  const emailRaw = cell(headerMap.email).toLowerCase();
  const phone = cell(headerMap.phone);
  const website = cell(headerMap.website);
  const contactName = cell(headerMap.contactName);
  const contactTitle = cell(headerMap.contactTitle);
  const industry = cell(headerMap.industry);
  const notes = cell(headerMap.notes);

  // Need at least one identifying field
  if (!company && !emailRaw && !website) {
    return { outcome: 'invalid', reason: 'row has no company, email, or website' };
  }

  const db = getAvDb();
  const domain = normalizeDomain(website);
  const existing = await findExistingLead(db, { domain: website, phone, mode: 'loose' });
  const targetBusiness: TargetBusiness = ctx.explicitTarget ?? inferTargetBusiness(industry || null);

  if (existing) {
    const merged = mergeTargetBusiness(existing.targetBusiness ?? 'av', targetBusiness);
    if (merged !== existing.targetBusiness) {
      await db.execute(`UPDATE leads SET target_business = ?, last_activity_at = NOW() WHERE id = ?`, [merged, existing.leadId]);
      return {
        outcome: 'duplicate_target_upgraded',
        leadId: existing.leadId,
        company,
        domain: domain ?? undefined
      };
    }
    return {
      outcome: 'duplicate_existing',
      leadId: existing.leadId,
      company,
      domain: domain ?? undefined
    };
  }

  // Build placeholder email if real one missing
  const isLikelyRealEmail = /\S+@\S+\.\S{2,}/.test(emailRaw) && !/example\.(com|org)$/i.test(emailRaw);
  const email = isLikelyRealEmail ? emailRaw : `noemail+csv-${(domain ?? randomUUID().slice(0, 8)).replace(/[^a-z0-9]/g, '').slice(0, 24)}@eventsbywater.com`;
  const auditId = randomUUID();

  const sourcePayload = {
    source: 'csv_import',
    source_label: ctx.sourceLabel,
    row_index_in_file: undefined,
    raw_row: row,
    notes_from_csv: notes || undefined
  };

  const [result] = await db.execute<ResultSetHeader>(
    `INSERT INTO leads (
       audit_id, company, contact_name, contact_title, email, phone, website, normalized_domain,
       industry, lead_status, source_type, target_business, source_payload, last_activity_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', 'csv', ?, ?, NOW())`,
    [
      auditId,
      company || (domain ?? 'Unknown'),
      contactName || null,
      contactTitle || null,
      email,
      phone || null,
      website || null,
      domain,
      industry || null,
      targetBusiness,
      JSON.stringify(sourcePayload)
    ]
  );

  const newLeadId = result.insertId;
  await logEvent({
    eventType: 'lead.created',
    leadId: newLeadId,
    source: 'csv',
    status: 'success',
    payload: {
      company: company || domain,
      domain,
      industry: industry || null,
      target_business: targetBusiness,
      source_label: ctx.sourceLabel,
      has_real_email: isLikelyRealEmail
    }
  });
  scoreAndAuditLeadBackground(newLeadId);

  return {
    outcome: 'inserted',
    leadId: newLeadId,
    company,
    email: isLikelyRealEmail ? emailRaw : undefined,
    domain: domain ?? undefined
  };
}
