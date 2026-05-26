/**
 * POST /api/admin/av/discover/scrape
 *
 * Two modes:
 *   1. mode=fill — scrape a website for contact info, UPDATE the existing
 *      lead row with what we find. Used for filling gaps on Apollo leads
 *      where Hunter struck out. Body: { mode: 'fill', auditId: '<uuid>' }
 *
 *   2. mode=new — scrape a website URL the operator pastes in, INSERT it
 *      as a brand-new lead. Body: { mode: 'new', websiteUrl: 'https://foo.com',
 *      industry?: string, targetBusiness?: 'av'|'ebw'|'both' }
 *
 * The scraper is regex-over-raw-HTML (no Cheerio). Works on static sites
 * and most WordPress / Squarespace setups. Fails on full-SPA contact pages.
 */
import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { guardAdminRequest } from '@/lib/api-guard';
import { isFlagEnabled } from '@/lib/feature-flags';
import { getAvDb } from '@/lib/db/av';
import { scrapeContactPage } from '@/lib/scraper/contact_page';
import { findExistingLead, normalizeDomain, mergeTargetBusiness, normalizePhone } from '@/lib/leads/dedup';
import { inferTargetBusiness, isTargetBusiness, type TargetBusiness } from '@/lib/leads/target_business';
import { logEvent } from '@/lib/events/log';
import { scoreAndAuditLeadBackground } from '@/lib/ai/score_and_audit';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';

export const runtime = 'nodejs';
export const maxDuration = 60;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/discover/scrape',
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

  const mode = payload.mode === 'fill' ? 'fill' : 'new';

  try {
    if (mode === 'fill') {
      return await handleFillMode(payload);
    }
    return await handleNewMode(payload);
  } catch (err) {
    console.error('[av:discover:scrape]', (err as Error).message);
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}

async function handleFillMode(payload: Record<string, unknown>) {
  const auditId = typeof payload.auditId === 'string' ? payload.auditId : '';
  if (!UUID_RE.test(auditId)) {
    return NextResponse.json({ error: 'auditId is required (uuid format)' }, { status: 400 });
  }
  const db = getAvDb();
  const [rows] = await db.execute<(RowDataPacket & { id: number; website: string | null; email: string; phone: string | null; contact_name: string | null })[]>(
    `SELECT id, website, email, phone, contact_name FROM leads WHERE audit_id = ? LIMIT 1`,
    [auditId]
  );
  if (rows.length === 0) {
    return NextResponse.json({ error: 'lead not found' }, { status: 404 });
  }
  const lead = rows[0];
  if (!lead.website) {
    return NextResponse.json({ error: 'lead has no website to scrape' }, { status: 400 });
  }

  const scraped = await scrapeContactPage(lead.website);

  // Only fill columns that are currently missing or placeholder — don't
  // overwrite curated data.
  const updates: string[] = [];
  const values: unknown[] = [];
  const placeholderEmail = /^(prospect|apollo|noemail)\+/i.test(lead.email) || lead.email === 'info@eventsbywater.com';
  if (scraped.email && placeholderEmail) {
    updates.push('email = ?');
    values.push(scraped.email);
  }
  if (scraped.phone && !lead.phone) {
    updates.push('phone = ?');
    values.push(scraped.phone);
  }
  if (scraped.companyTitle && (!lead.contact_name || /^\(/.test(lead.contact_name))) {
    // Don't overwrite a real contact_name; only fill if placeholder/empty.
    // Use companyTitle as a fallback in source_payload (not contact_name).
  }
  // Tags: stash discovered socials under tags.socials so the detail page can render them
  if (Object.keys(scraped.socials).length > 0) {
    updates.push('tags = JSON_SET(COALESCE(tags, JSON_OBJECT()), \'$.socials\', CAST(? AS JSON))');
    values.push(JSON.stringify(scraped.socials));
  }
  if (updates.length === 0) {
    return NextResponse.json({
      ok: true,
      mode: 'fill',
      filled: false,
      reason: 'nothing-useful-found-or-already-populated',
      scraped
    });
  }
  updates.push('last_activity_at = NOW()');
  await db.execute(`UPDATE leads SET ${updates.join(', ')} WHERE id = ?`, [...values, lead.id]);
  return NextResponse.json({ ok: true, mode: 'fill', filled: true, leadId: lead.id, scraped });
}

async function handleNewMode(payload: Record<string, unknown>) {
  const websiteUrl = typeof payload.websiteUrl === 'string' ? payload.websiteUrl.trim() : '';
  if (!websiteUrl) {
    return NextResponse.json({ error: 'websiteUrl is required' }, { status: 400 });
  }
  const industryRaw = typeof payload.industry === 'string' ? payload.industry.trim() : null;
  const tbInput = typeof payload.targetBusiness === 'string' ? payload.targetBusiness : null;
  const explicitTarget: TargetBusiness | null = tbInput && isTargetBusiness(tbInput) ? tbInput : null;
  const destClientId =
    typeof payload.clientId === 'number' && Number.isInteger(payload.clientId) && payload.clientId > 0
      ? payload.clientId
      : null;

  const scraped = await scrapeContactPage(websiteUrl);
  if (!scraped.email && !scraped.phone) {
    return NextResponse.json({
      ok: false,
      mode: 'new',
      inserted: false,
      reason: 'no-email-or-phone-found',
      scraped
    });
  }

  const db = getAvDb();
  const domain = normalizeDomain(websiteUrl);
  const existing = await findExistingLead(db, { domain: websiteUrl, phone: scraped.phone, mode: 'loose' });
  const targetBusiness: TargetBusiness = explicitTarget ?? inferTargetBusiness(industryRaw);

  if (existing) {
    const merged = mergeTargetBusiness(existing.targetBusiness ?? 'av', targetBusiness);
    if (merged !== existing.targetBusiness) {
      await db.execute(`UPDATE leads SET target_business = ?, last_activity_at = NOW() WHERE id = ?`, [merged, existing.leadId]);
    }
    return NextResponse.json({
      ok: true,
      mode: 'new',
      inserted: false,
      duplicate: true,
      leadId: existing.leadId,
      mergedTarget: merged,
      scraped
    });
  }

  const company = scraped.companyTitle || domain || websiteUrl;
  const email = scraped.email || `noemail+scrape-${(domain ?? 'unknown').replace(/[^a-z0-9]/g, '').slice(0, 20)}@eventsbywater.com`;
  const phone = scraped.phone;
  const auditId = randomUUID();

  const sourcePayload = {
    source: 'contact_page_scraper',
    input_url: websiteUrl,
    pages_fetched: scraped.pagesFetched,
    pages_failed: scraped.pagesFailed,
    socials: scraped.socials,
    company_title: scraped.companyTitle
  };

  const [result] = await db.execute<ResultSetHeader>(
    `INSERT INTO leads (
       audit_id, company, email, phone, website, normalized_domain,
       industry, lead_status, source_type, target_business, source_payload, client_id, last_activity_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, 'new', 'scrape', ?, ?, ?, NOW())`,
    [
      auditId,
      company,
      email,
      phone,
      websiteUrl,
      domain,
      industryRaw,
      targetBusiness,
      JSON.stringify(sourcePayload),
      destClientId
    ]
  );

  const newLeadId = result.insertId;
  await logEvent({
    eventType: 'lead.created',
    leadId: newLeadId,
    source: 'scrape',
    status: 'success',
    payload: {
      company,
      domain,
      industry: industryRaw,
      target_business: targetBusiness,
      input_url: websiteUrl,
      pages_fetched: scraped.pagesFetched?.length ?? 0
    }
  });
  scoreAndAuditLeadBackground(newLeadId);

  return NextResponse.json({
    ok: true,
    mode: 'new',
    inserted: true,
    leadId: newLeadId,
    auditId,
    company,
    scraped,
    normalizedPhone: normalizePhone(phone)
  });
}
