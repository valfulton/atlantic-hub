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
import { enrichLeadFromSmartScrapeByAuditId } from '@/lib/scraper/smart_lead_scraper';
import { findExistingLead, normalizeDomain, mergeTargetBusiness, normalizePhone } from '@/lib/leads/dedup';
import { inferTargetBusiness, isTargetBusiness, type TargetBusiness } from '@/lib/leads/target_business';
import { logEvent } from '@/lib/events/log';
import { scoreAndAuditLeadBackground } from '@/lib/ai/score_and_audit';
import { autoThreadLeadByFitBackground } from '@/lib/campaigns/lines_for_lead';
import { assignDiscoveredLeads, parseAssignToUserId } from '@/lib/leads/assign_discovered';
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

  // (#251 Inc 1c-prime) New mode='smart_fill' uses the LLM-driven intake
  // scraper (lib/scraper/smart_lead_scraper.ts) instead of the regex one.
  // Same input (auditId) — way better output (industry, contact, address
  // hints, business description, slogan, key message). Costs ~$0.01/page
  // vs regex's $0, but returns 10x the structured intelligence. The old
  // mode='fill' (regex) stays as a fallback so existing UI doesn't break.
  const mode =
    payload.mode === 'fill'       ? 'fill' :
    payload.mode === 'smart_fill' ? 'smart_fill' :
    'new';

  try {
    if (mode === 'fill') {
      return await handleFillMode(payload);
    }
    if (mode === 'smart_fill') {
      return await handleSmartFillMode(payload);
    }
    return await handleNewMode(payload, guard.actor.userId ?? null);
  } catch (err) {
    console.error('[av:discover:scrape]', (err as Error).message);
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}

/**
 * (#251 Inc 1c-prime) Smart fill — call the LLM-driven scraper for one lead.
 * Same shape as handleFillMode but powered by intake_web_filler instead of
 * regex. Returns a payload the operator UI can render directly.
 */
async function handleSmartFillMode(payload: Record<string, unknown>) {
  const auditId = typeof payload.auditId === 'string' ? payload.auditId : '';
  if (!UUID_RE.test(auditId)) {
    return NextResponse.json({ error: 'auditId is required (uuid format)' }, { status: 400 });
  }
  const result = await enrichLeadFromSmartScrapeByAuditId(auditId);
  if (!result.fetched) {
    return NextResponse.json({
      ok: false,
      reason: result.reason ?? 'fetch failed',
      fetchedUrl: null
    }, { status: 422 });
  }
  return NextResponse.json({
    ok: true,
    fetchedUrl: result.fetchedUrl,
    pageSummary: result.pageSummary,
    proposedFieldCount: result.proposedFieldCount,
    filledFieldCount: result.enrichment.filled,
    filledFields: result.enrichment.fields,
    metadataMerged: result.enrichment.metadataMerged
  });
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

async function handleNewMode(payload: Record<string, unknown>, actorUserId: number | null) {
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
  const assignToUserId = destClientId ? null : parseAssignToUserId(payload);

  // (val 2026-06-16, #702) Operator-supplied contact info from the
  // Quick-add widget. When val already has the email / phone / contact
  // name (referral, prior conversation, dinner intro), she pastes them
  // here so we don't depend on the scraper finding them. Operator values
  // take precedence over scraped values. Also bypasses the "no contact
  // found" rejection when at least one of email/phone is provided.
  const operatorEmail = typeof payload.email === 'string' && payload.email.trim() ? payload.email.trim() : null;
  const operatorPhone = typeof payload.phone === 'string' && payload.phone.trim() ? payload.phone.trim() : null;
  const operatorContactName = typeof payload.contactName === 'string' && payload.contactName.trim()
    ? payload.contactName.trim() : null;
  const operatorNotes = typeof payload.notes === 'string' && payload.notes.trim()
    ? payload.notes.trim().slice(0, 4000) : null;
  const operatorCompany = typeof payload.company === 'string' && payload.company.trim()
    ? payload.company.trim() : null;

  const scraped = await scrapeContactPage(websiteUrl);
  // Allow insert if the SCRAPER found contact info OR the operator typed it in.
  if (!scraped.email && !scraped.phone && !operatorEmail && !operatorPhone) {
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

  // Operator values win when supplied; otherwise fall back to scraped values
  // or the noemail+ placeholder. This lets val pre-fill what she already
  // knows (referral conversation, dinner intro, prior email) without losing
  // the scraper's other intelligence.
  const company = operatorCompany || scraped.companyTitle || domain || websiteUrl;
  const email = operatorEmail || scraped.email || `noemail+scrape-${(domain ?? 'unknown').replace(/[^a-z0-9]/g, '').slice(0, 20)}@eventsbywater.com`;
  const phone = operatorPhone || scraped.phone;
  const contactName = operatorContactName;
  const auditId = randomUUID();

  const sourcePayload = {
    source: 'contact_page_scraper',
    input_url: websiteUrl,
    pages_fetched: scraped.pagesFetched,
    pages_failed: scraped.pagesFailed,
    socials: scraped.socials,
    company_title: scraped.companyTitle,
    // (val 2026-06-16) Capture which fields val typed vs which the scraper
    // found — so per-field provenance survives. Operator notes also live
    // here (no dedicated leads column yet).
    operator_supplied: {
      email: operatorEmail,
      phone: operatorPhone,
      contact_name: operatorContactName,
      company: operatorCompany
    },
    operator_notes: operatorNotes
  };

  const [result] = await db.execute<ResultSetHeader>(
    `INSERT INTO leads (
       audit_id, company, contact_name, email, phone, website, normalized_domain,
       industry, lead_status, source_type, target_business, source_payload, client_id, last_activity_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new', 'scrape', ?, ?, ?, NOW())`,
    [
      auditId,
      company,
      contactName,
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
  if (assignToUserId) {
    await assignDiscoveredLeads([newLeadId], assignToUserId, actorUserId);
  }
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
  // (#46 spine Inc 2) Auto-thread to the best-fit narrative line.
  autoThreadLeadByFitBackground(newLeadId);

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
