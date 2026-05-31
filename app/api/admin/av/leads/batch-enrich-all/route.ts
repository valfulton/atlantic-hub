/**
 * POST /api/admin/av/leads/batch-enrich-all  (#278)
 *
 * The bulk version of the per-lead Enrich-from-sources menu. val asked for
 * this all day: she wants to hit ONE button on /admin/av and have 5-25
 * leads enriched across Smart enrich + Google Places + Instagram + WHOIS
 * at the same time, instead of clicking into each lead and running the
 * sources one-by-one. Hunter has its own button (POST /api/admin/av/enrich)
 * and is NOT included here — it bills credits and val burns them faster
 * than she gets value, so this route deliberately skips Hunter.
 *
 * Body: { limit?: number, sources?: ('smart'|'places'|'instagram'|'whois')[] }
 *   limit   — how many leads to process (1..25, default 5)
 *   sources — which enrichers to run on each lead (default: all four)
 *
 * Selection: the next N active, non-converted leads ordered by the staler
 * of last_activity_at / submission_date. Smart skips leads with no website
 * (it needs one). Places needs a company. IG needs company OR website.
 * WHOIS needs a website. Each source's own guard lets us skip cheaply.
 *
 * Returns: per-source filled-field counts + per-lead row summary so val
 * sees exactly what landed where. Same shape as the per-lead menu's reply,
 * just aggregated across N leads.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { isFlagEnabled } from '@/lib/feature-flags';
import { getAvDb } from '@/lib/db/av';
import { enrichLeadFromSmartScrape } from '@/lib/scraper/smart_lead_scraper';
import { enrichLeadFromPlaces } from '@/lib/google_places/discoverer';
import { enrichLeadFromInstagram } from '@/lib/apify/discoverer';
import { enrichLeadFromWhois } from '@/lib/whois/enrich';
import type { RowDataPacket } from 'mysql2';

export const runtime = 'nodejs';
export const maxDuration = 60;

type SourceKey = 'smart' | 'places' | 'instagram' | 'whois';
const ALL_SOURCES: SourceKey[] = ['smart', 'places', 'instagram', 'whois'];

interface LeadRow extends RowDataPacket {
  id: number;
  audit_id: string;
  company: string | null;
  website: string | null;
}

interface PerLeadOutcome {
  leadId: number;
  auditId: string;
  company: string | null;
  smart?: { filled: number; reason: string | null };
  places?: { filled: number; reason: string | null };
  instagram?: { filled: number; reason: string | null };
  whois?: { filled: number; reason: string | null };
}

export async function POST(req: NextRequest) {
  if (!(await isFlagEnabled('tab_av_enabled'))) {
    return NextResponse.json({ error: 'av tab disabled' }, { status: 403 });
  }
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/leads/batch-enrich-all:POST',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // Parse body
  let body: { limit?: unknown; sources?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    /* empty body OK */
  }
  const limit =
    typeof body.limit === 'number' && Number.isFinite(body.limit)
      ? Math.max(1, Math.min(25, Math.floor(body.limit)))
      : 5;
  const sources: SourceKey[] =
    Array.isArray(body.sources) && body.sources.length > 0
      ? (body.sources.filter((s): s is SourceKey => ALL_SOURCES.includes(s as SourceKey)) as SourceKey[])
      : ALL_SOURCES;

  // Pick the next N leads. Prefer the ones that need it most — no website
  // OR no contact name yet, oldest activity first. Active only.
  const db = getAvDb();
  const [rows] = await db.execute<LeadRow[]>(
    `SELECT id, audit_id, company, website
       FROM leads
      WHERE archived_at IS NULL
        AND lead_status NOT IN ('converted', 'lost')
      ORDER BY (contact_name IS NULL OR contact_name = '') DESC,
               COALESCE(last_activity_at, submission_date) ASC
      LIMIT ?`,
    [limit]
  );

  // Per-source aggregate counters. `attempted` = times we even called the
  // source for some lead; `filled` = total fields written across the batch;
  // `errored` = soft failures (lead had no website, no company match, etc).
  const perSource: Record<SourceKey, { attempted: number; filled: number; errored: number }> = {
    smart: { attempted: 0, filled: 0, errored: 0 },
    places: { attempted: 0, filled: 0, errored: 0 },
    instagram: { attempted: 0, filled: 0, errored: 0 },
    whois: { attempted: 0, filled: 0, errored: 0 }
  };
  const perLead: PerLeadOutcome[] = [];

  // Sequential per lead, sequential per source — keeps DB writes ordered and
  // avoids hammering the external APIs in parallel. 25 leads x 4 sources =
  // up to 100 calls; the longest source (smart enrich) is ~3-5s, others are
  // 0.5-2s, so worst case the batch lands well inside maxDuration=60s for
  // limit=5. Larger limits may hit the timeout — that's why limit is capped
  // at 25 above.
  for (const lead of rows) {
    const outcome: PerLeadOutcome = {
      leadId: lead.id,
      auditId: lead.audit_id,
      company: lead.company
    };

    for (const src of sources) {
      try {
        if (src === 'smart') {
          if (!lead.website || !lead.website.trim()) {
            outcome.smart = { filled: 0, reason: 'no website on file' };
            perSource.smart.errored += 1;
            continue;
          }
          perSource.smart.attempted += 1;
          const r = await enrichLeadFromSmartScrape({
            leadId: lead.id,
            websiteUrl: lead.website,
            brandHint: lead.company
          });
          const filled = r.enrichment?.filled ?? 0;
          perSource.smart.filled += filled;
          if (!r.fetched && filled === 0) perSource.smart.errored += 1;
          outcome.smart = { filled, reason: r.reason };
        } else if (src === 'places') {
          if (!lead.company || !lead.company.trim()) {
            outcome.places = { filled: 0, reason: 'no company name on file' };
            perSource.places.errored += 1;
            continue;
          }
          perSource.places.attempted += 1;
          const r = await enrichLeadFromPlaces({ leadId: lead.id, actorUserId: guard.actor.userId });
          if (r.ok) {
            const filled = r.filled ?? 0;
            perSource.places.filled += filled;
            outcome.places = { filled, reason: null };
          } else {
            outcome.places = { filled: 0, reason: r.reason ?? 'no match' };
            perSource.places.errored += 1;
          }
        } else if (src === 'instagram') {
          if ((!lead.company || !lead.company.trim()) && (!lead.website || !lead.website.trim())) {
            outcome.instagram = { filled: 0, reason: 'no company or website on file' };
            perSource.instagram.errored += 1;
            continue;
          }
          perSource.instagram.attempted += 1;
          const r = await enrichLeadFromInstagram({ leadId: lead.id, actorUserId: guard.actor.userId });
          if (r.ok) {
            const filled = r.filled ?? 0;
            perSource.instagram.filled += filled;
            outcome.instagram = { filled, reason: null };
          } else {
            outcome.instagram = { filled: 0, reason: r.reason ?? 'no profile' };
            perSource.instagram.errored += 1;
          }
        } else if (src === 'whois') {
          if (!lead.website || !lead.website.trim()) {
            outcome.whois = { filled: 0, reason: 'no website on file' };
            perSource.whois.errored += 1;
            continue;
          }
          perSource.whois.attempted += 1;
          const r = await enrichLeadFromWhois({ leadId: lead.id, actorUserId: guard.actor.userId });
          if (r.ok) {
            const filled = r.filled ?? 0;
            perSource.whois.filled += filled;
            outcome.whois = { filled, reason: null };
          } else {
            outcome.whois = { filled: 0, reason: r.reason ?? 'WHOIS unavailable' };
            perSource.whois.errored += 1;
          }
        }
      } catch (err) {
        // Soft fail this one source on this one lead; keep the batch going.
        const reason = (err as Error).message || 'unexpected error';
        outcome[src] = { filled: 0, reason };
        perSource[src].errored += 1;
      }
    }

    perLead.push(outcome);
  }

  return NextResponse.json({
    ok: true,
    leadsProcessed: rows.length,
    sourcesRun: sources,
    perSource,
    perLead
  });
}
