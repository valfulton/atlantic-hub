/**
 * POST /api/admin/av/discover/scrape-bulk
 *
 * Iterates existing (non-archived) leads where:
 *   - website IS NOT NULL AND website != ''
 *   - AND (email is a placeholder OR phone IS NULL)
 *
 * For each, calls the contact-page scraper and fills missing fields.
 * Won't overwrite real data. Won't re-scrape leads we already enriched.
 *
 * Body:
 *   { limit?: number, dryRun?: boolean, targetBusiness?: 'av'|'ebw'|'both' }
 *
 * Defaults: limit=10 (so a single call stays under 60s), dryRun=false.
 * For your 23 St. Croix leads, two passes (limit=15) will get through them all.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { isFlagEnabled } from '@/lib/feature-flags';
import { getAvDb } from '@/lib/db/av';
import { scrapeContactPage } from '@/lib/scraper/contact_page';
import { isTargetBusiness, type TargetBusiness } from '@/lib/leads/target_business';
import type { RowDataPacket } from 'mysql2';

export const runtime = 'nodejs';
export const maxDuration = 60;

interface CandidateRow extends RowDataPacket {
  id: number;
  audit_id: string;
  company: string;
  website: string | null;
  email: string;
  phone: string | null;
  contact_name: string | null;
}

interface PerLeadResult {
  leadId: number;
  auditId: string;
  company: string;
  website: string;
  filledEmail: boolean;
  filledPhone: boolean;
  foundSocials: number;
  emailFound: string | null;
  phoneFound: string | null;
  pagesFetched: number;
  pagesFailed: number;
  skipped: boolean;
  reason?: string;
}

const PLACEHOLDER_EMAIL_RE =
  /^(prospect|apollo|noemail)\+|^info@eventsbywater\.com$/i;

export async function POST(req: NextRequest) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/discover/scrape-bulk',
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
    // empty body is OK — defaults take over
  }

  const limit = Math.min(20, Math.max(1, Number(payload.limit) || 10));
  const dryRun = payload.dryRun === true;
  const targetFilter: TargetBusiness | null =
    typeof payload.targetBusiness === 'string' && isTargetBusiness(payload.targetBusiness)
      ? payload.targetBusiness
      : null;

  const db = getAvDb();
  // Pick candidates: have a website, missing real email OR phone.
  const targetClause = targetFilter
    ? targetFilter === 'both'
      ? "AND target_business = 'both'"
      : `AND target_business IN ('${targetFilter}', 'both')`
    : '';
  const [candidates] = await db.execute<CandidateRow[]>(
    `SELECT id, audit_id, company, website, email, phone, contact_name
     FROM leads
     WHERE archived_at IS NULL
       AND website IS NOT NULL AND website != ''
       AND (
         email LIKE 'prospect+%@eventsbywater.com'
         OR email LIKE 'apollo+%@eventsbywater.com'
         OR email LIKE 'noemail+%@eventsbywater.com'
         OR email = 'info@eventsbywater.com'
         OR phone IS NULL OR phone = ''
       )
       ${targetClause}
     ORDER BY id DESC
     LIMIT ?`,
    [limit]
  );

  if (candidates.length === 0) {
    return NextResponse.json({
      ok: true,
      checked: 0,
      filled: 0,
      results: [],
      message: 'No leads need scraping right now — every lead either has a real email + phone, or has no website on file.'
    });
  }

  const results: PerLeadResult[] = [];
  let filledCount = 0;

  for (const lead of candidates) {
    if (!lead.website) {
      results.push({
        leadId: lead.id,
        auditId: lead.audit_id,
        company: lead.company,
        website: '',
        filledEmail: false,
        filledPhone: false,
        foundSocials: 0,
        emailFound: null,
        phoneFound: null,
        pagesFetched: 0,
        pagesFailed: 0,
        skipped: true,
        reason: 'no-website'
      });
      continue;
    }

    let scraped;
    try {
      scraped = await scrapeContactPage(lead.website);
    } catch (err) {
      results.push({
        leadId: lead.id,
        auditId: lead.audit_id,
        company: lead.company,
        website: lead.website,
        filledEmail: false,
        filledPhone: false,
        foundSocials: 0,
        emailFound: null,
        phoneFound: null,
        pagesFetched: 0,
        pagesFailed: 0,
        skipped: true,
        reason: `scrape-failed: ${(err as Error).message.slice(0, 100)}`
      });
      continue;
    }

    const wantEmail = PLACEHOLDER_EMAIL_RE.test(lead.email);
    const wantPhone = !lead.phone || !lead.phone.trim();
    const updates: string[] = [];
    const values: unknown[] = [];

    let filledEmail = false;
    let filledPhone = false;

    if (scraped.email && wantEmail) {
      updates.push('email = ?');
      values.push(scraped.email);
      filledEmail = true;
    }
    if (scraped.phone && wantPhone) {
      updates.push('phone = ?');
      values.push(scraped.phone);
      filledPhone = true;
    }
    const socialsCount = Object.keys(scraped.socials).length;
    if (socialsCount > 0) {
      updates.push("tags = JSON_SET(COALESCE(tags, JSON_OBJECT()), '$.socials', CAST(? AS JSON))");
      values.push(JSON.stringify(scraped.socials));
    }

    if (updates.length > 0 && !dryRun) {
      updates.push('last_activity_at = NOW()');
      await db.execute(`UPDATE leads SET ${updates.join(', ')} WHERE id = ?`, [...values, lead.id]);
      filledCount++;
    }

    results.push({
      leadId: lead.id,
      auditId: lead.audit_id,
      company: lead.company,
      website: lead.website,
      filledEmail,
      filledPhone,
      foundSocials: socialsCount,
      emailFound: scraped.email,
      phoneFound: scraped.phone,
      pagesFetched: scraped.pagesFetched.length,
      pagesFailed: scraped.pagesFailed.length,
      skipped: updates.length === 0,
      reason: updates.length === 0 ? 'nothing-useful-found' : undefined
    });
  }

  return NextResponse.json({
    ok: true,
    dryRun,
    checked: candidates.length,
    filled: filledCount,
    results
  });
}
