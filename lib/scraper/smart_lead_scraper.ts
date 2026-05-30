/**
 * lib/scraper/smart_lead_scraper.ts  (#251 Inc 1c-prime)
 *
 * Smart, LLM-driven lead enrichment from a website URL.
 *
 * The PREVIOUS scrape path (lib/scraper/contact_page.ts) was regex-over-raw-
 * HTML — fast, free, and dumb. It grepped for `email@domain` patterns and
 * gave up on anything semantic. The intake AI-fill (lib/client/intake_web_filler.ts)
 * solves the same problem at a higher tier — it reads the page with gpt-4o-mini
 * and returns a structured payload covering company, industry, contact, address
 * hints, business description, slogan, target audience, key message, and more.
 *
 * This module reuses the intake filler infrastructure end-to-end. It calls
 * suggestIntakeFromUrl(), maps the resulting payload onto the leads.* columns,
 * writes them via enrichLeadFromSource() (so the same blanks-only + provenance
 * guarantees as Google Places apply), and stashes the FULL intake suggestion
 * in source_payload.lead_intake_draft so a future "convert lead → client" flow
 * (#253) can carry it forward without re-asking the page.
 *
 * Cost: ~$0.005–$0.02 per lead at gpt-4o-mini (one page read + one LLM call).
 * Way more intelligence per dollar than Hunter for the same use case — Hunter
 * returns one email per credit, this returns 6–12 structured fields per call.
 *
 * Never throws. Catches its own fetch / LLM failures and logs them to
 * system_events as 'lead.smart_scrape_failed' so a discovery sweep doesn't
 * collapse if one URL is unreachable.
 */
import { suggestIntakeFromUrl, IntakeWebFetchError } from '@/lib/client/intake_web_filler';
import { enrichLeadFromSource, type EnrichmentResult } from '@/lib/enrichment/multi_source_enricher';
import { logEvent } from '@/lib/events/log';
import { getAvDb } from '@/lib/db/av';
import type { RowDataPacket } from 'mysql2';

export interface SmartScrapeResult {
  /** Enrichment writer's result — which columns the source actually filled. */
  enrichment: EnrichmentResult;
  /** How many intake fields the LLM proposed BEFORE the blanks-only filter
   *  trimmed them down. Useful for the discovery summary: "12 fields proposed,
   *  4 actually written (8 were already filled)." */
  proposedFieldCount: number;
  /** True when the page-read step succeeded (vs. fetch-failed / SPA / etc).
   *  False means we never even got to the LLM step. */
  fetched: boolean;
  /** Final URL the scraper landed on (after redirects). */
  fetchedUrl: string | null;
  /** ~1-line page summary the LLM produced — useful for the operator panel
   *  so val can sanity-check what page actually got read. */
  pageSummary: string | null;
  /** Soft failure reason when fetched===false (e.g. "SPA — try a different
   *  URL" or "404"). */
  reason: string | null;
}

const EMPTY: SmartScrapeResult = {
  enrichment: { filled: 0, fields: [], metadataMerged: false },
  proposedFieldCount: 0,
  fetched: false,
  fetchedUrl: null,
  pageSummary: null,
  reason: null
};

/**
 * Run a smart scrape against a website URL and write the structured result
 * onto an EXISTING lead's row + source_payload.
 *
 * Behavior:
 *   - blanks_only: writes a column only when the lead's current value is
 *     null/empty. Hand-curated data is never clobbered.
 *   - The full intake suggestion (all 12+ proposed fields, even the ones we
 *     didn't write to columns) is stashed under source_payload.lead_intake_draft
 *     so it survives for future use (#253 lead → client conversion).
 *   - Email is NEVER overwritten by this path. Hunter is the right tool for
 *     emails; the smart scraper grabs everything else.
 */
export async function enrichLeadFromSmartScrape(args: {
  leadId: number;
  websiteUrl: string;
  /** Optional company name hint — improves LLM accuracy when the page header
   *  is generic. Falls through cleanly when omitted. */
  brandHint?: string | null;
}): Promise<SmartScrapeResult> {
  const { leadId, websiteUrl, brandHint } = args;

  // Step 1: run the existing intake_web_filler infrastructure. This handles
  // page fetch + cleanup + LLM call + JSON parse + cost logging. Throws on
  // network / SPA / LLM failure — we catch and route to a soft failure result.
  let suggestion;
  try {
    suggestion = await suggestIntakeFromUrl({ url: websiteUrl, brandHint });
  } catch (err) {
    const reason = err instanceof IntakeWebFetchError
      ? err.message
      : (err as Error).message.slice(0, 200);
    await logEvent({
      eventType: 'lead.smart_scrape_failed',
      leadId,
      source: 'website_scrape',
      status: 'failure',
      errorMessage: reason,
      payload: { url: websiteUrl, stage: 'fetch_or_llm' }
    });
    return { ...EMPTY, reason };
  }

  // Step 2: map the intake-shape suggestion onto the lead-column patch.
  // The intake covers ~12 fields per call; about half map cleanly to lead
  // columns, the rest land in source_payload for the #253 lead → client
  // carryover. Email INTENTIONALLY excluded (Hunter wins that contest).
  const s = suggestion.suggestions as Record<string, string | undefined>;
  const fieldPatch = {
    company: cleanString(s.company),
    contact_name: cleanString(s.contact_name),
    contact_title: cleanString(s.contact_title),
    phone: cleanString(s.phone),
    industry: cleanString(s.industry)
    // No address_* — the intake filler doesn't break out address parts.
    // Google Places is the better source for those, and runs in its own path.
  };
  const proposedFieldCount = Object.values(s).filter((v) => typeof v === 'string' && v.trim().length > 0).length;

  // Step 3: enrich the lead via the shared writer. blanks_only=true (default)
  // preserves any hand-curated values. The stash under source_payload makes
  // the FULL suggestion available later — #253 lead→client conversion will
  // read this stash so the new client's intake is pre-filled without
  // re-fetching the page.
  const enrichment = await enrichLeadFromSource({
    leadId,
    source: 'website_scrape',
    patch: {
      fields: fieldPatch,
      sourceMetadata: {
        page_summary: suggestion.summary,
        fetched_url: suggestion.fetchedUrl,
        html_bytes: suggestion.htmlBytes,
        text_chars: suggestion.textChars,
        tokens_used: suggestion.tokensUsed,
        model: suggestion.model,
        // The full intake stash. Carries forward to #253 lead→client conversion.
        // Stored under a clearly-namespaced key so future readers know what
        // shape to expect; existing source_payload keys are unaffected.
        lead_intake_draft: suggestion.suggestions
      },
      note: 'smart scrape (intake_web_filler)'
    }
  });

  // Step 4: success event with cost + outcome breakdown. The cost lands here
  // so val can see "we spent $X on smart scrapes this week" alongside Hunter's
  // credit log. Provisioning (#44) will eventually roll these up per-client.
  await logEvent({
    eventType: 'lead.smart_scraped',
    leadId,
    source: 'website_scrape',
    status: 'success',
    payload: {
      url: websiteUrl,
      proposed_field_count: proposedFieldCount,
      filled_field_count: enrichment.filled,
      filled_fields: enrichment.fields,
      metadata_merged: enrichment.metadataMerged,
      tokens_used: suggestion.tokensUsed,
      model: suggestion.model
    }
  });

  return {
    enrichment,
    proposedFieldCount,
    fetched: true,
    fetchedUrl: suggestion.fetchedUrl,
    pageSummary: suggestion.summary,
    reason: null
  };
}

function cleanString(v: string | undefined): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  if (!t) return undefined;
  // The intake_web_filler uses a "[ask]" sentinel for fields it couldn't
  // confidently infer. Those should NEVER land on a real lead column.
  if (t === '[ask]' || /^\[ask\]?/i.test(t)) return undefined;
  return t;
}

/**
 * Convenience: resolve a lead's website URL by audit_id and run the smart
 * scrape. Used by the operator "Enrich from website" button on the lead
 * detail surface. Returns EMPTY when the lead has no usable website.
 */
export async function enrichLeadFromSmartScrapeByAuditId(auditId: string): Promise<SmartScrapeResult> {
  const db = getAvDb();
  const [rows] = await db.execute<(RowDataPacket & { id: number; website: string | null; company: string | null })[]>(
    `SELECT id, website, company FROM leads WHERE audit_id = ? AND archived_at IS NULL LIMIT 1`,
    [auditId]
  );
  const lead = rows[0];
  if (!lead) return { ...EMPTY, reason: 'lead not found or archived' };
  if (!lead.website || !/^https?:\/\//i.test(lead.website)) {
    return { ...EMPTY, reason: 'lead has no usable website URL' };
  }
  return enrichLeadFromSmartScrape({
    leadId: lead.id,
    websiteUrl: lead.website,
    brandHint: lead.company
  });
}
