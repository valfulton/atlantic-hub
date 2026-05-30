/**
 * lib/enrichment/multi_source_enricher.ts  (#251 Inc 1)
 *
 * The "every discovery source is also an enrichment source" foundation.
 *
 * Until now the discovery routes (Google Places, Instagram via Apify, Website
 * scrape, Apollo) all followed the same "match-or-insert" pattern:
 *   - new domain  -> INSERT a fresh lead with the source's rich data
 *   - dup domain  -> return outcome:'duplicate_existing' (THROW THE DATA AWAY)
 *
 * That's the bug val sensed when she said "google places and instagram feel
 * like they should be enriching, not just discovering." Every duplicate hit is
 * a missed enrichment — Places re-fetched the phone + address + hours + rating
 * but the existing lead row was untouched.
 *
 * THIS MODULE: a single helper every discoverer calls in its dedup branch.
 * Reads the existing lead, computes which fields the source can fill that are
 * still NULL/empty, writes them in one UPDATE, and logs a provenance row to
 * system_events so val can audit which source filled which field for which
 * lead. No schema change for Inc 1 — uses existing leads.* columns + the
 * existing system_events table.
 *
 * Inc 2 layers in the same helper for Instagram + Website scrape. Inc 3 adds
 * the per-source "enrich existing leads from <source>" affordance on the
 * Find New Leads page. Inc 1 alone closes the biggest gap: every domain dedup
 * is now an enrichment opportunity instead of a discard.
 *
 * SAFE DEFAULTS:
 *   - mode='blanks_only' (default): only fills fields that are NULL or empty
 *     string. Hand-curated values are NEVER overwritten unless val opts in.
 *   - source_payload merge is JSON_MERGE_PATCH so the existing row's source
 *     metadata is preserved (we add to it; we don't clobber it).
 *   - All writes happen in one UPDATE — if any field fails, the whole patch
 *     is atomic (the lead row never ends up half-enriched).
 *
 * Never throws. Returns { filled: number, fields: string[] } so the caller
 * can decide what outcome enum to return (e.g. 'duplicate_enriched' vs
 * 'duplicate_existing'). A throw in here would silently break discovery
 * sweeps — which is exactly the opposite of the desired "compound the data"
 * behavior. Errors are logged and the helper returns {filled:0, fields:[]}.
 */
import { getAvDb } from '@/lib/db/av';
import { logEvent } from '@/lib/events/log';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

/**
 * Source identifier — kept narrow so the provenance log stays clean. New
 * sources extend this union as they wire in (Inc 2 adds 'instagram_apify' +
 * 'website_scrape'; future Inc adds 'yelp', 'bbb', etc.).
 */
export type EnrichmentSource =
  | 'google_places'
  | 'instagram_apify'
  | 'website_scrape'
  | 'apollo_org'
  | 'hunter_io'
  | 'manual_operator';

/**
 * Fields a multi-source enrichment is allowed to fill. Whitelist intentional —
 * a typo'd field name should fail at compile time, not silently no-op. Mirrors
 * the leads.* columns that downstream surfaces actually read.
 */
export type EnrichableField =
  | 'phone'
  | 'website'
  | 'address_street'
  | 'address_city'
  | 'address_state'
  | 'address_postal'
  | 'address_country'
  | 'industry'
  | 'contact_name'
  | 'contact_title';

export interface EnrichmentPatch {
  /** Fields the source can fill. Undefined values are dropped before write. */
  fields: Partial<Record<EnrichableField, string | null | undefined>>;
  /** Optional metadata blob merged into leads.source_payload via JSON_MERGE_PATCH.
   *  Use this for source-specific data that doesn't fit a column (rating, hours,
   *  business_status, etc). Never overwrites prior keys (additive only). */
  sourceMetadata?: Record<string, unknown>;
  /** Operator/source notes — appears in the provenance log. Keep it terse. */
  note?: string;
}

export interface EnrichmentResult {
  /** How many fields actually got written (0 means the lead was already
   *  complete OR the source had nothing new). */
  filled: number;
  /** Which field names landed — useful for the caller's outcome label. */
  fields: EnrichableField[];
  /** True when source_payload was extended (separate from `filled` because
   *  metadata writes don't count as a column fill). */
  metadataMerged: boolean;
}

const EMPTY_RESULT: EnrichmentResult = { filled: 0, fields: [], metadataMerged: false };

/**
 * Read a lead's current state for the enrichable columns. Returns null when
 * the lead doesn't exist or is archived — caller should fall through to its
 * insert path in that case (the lead was probably cleaned up between the
 * source call and the dedup).
 */
async function readLeadState(
  db: ReturnType<typeof getAvDb>,
  leadId: number
): Promise<Partial<Record<EnrichableField, string | null>> | null> {
  const [rows] = await db.execute<(RowDataPacket & Partial<Record<EnrichableField, string | null>>)[]>(
    `SELECT phone, website, address_street, address_city, address_state,
            address_postal, address_country, industry, contact_name, contact_title
       FROM leads
      WHERE id = ? AND archived_at IS NULL
      LIMIT 1`,
    [leadId]
  );
  return rows[0] ?? null;
}

/** True when a field's current value is "missing" — null, undefined, or
 *  whitespace-only string. Hand-curated values that happen to be short still
 *  count as filled, so we never clobber them. */
function isEmpty(v: string | null | undefined): boolean {
  return v == null || (typeof v === 'string' && v.trim().length === 0);
}

/**
 * Apply a multi-source enrichment patch to an existing lead.
 *
 * Behavior:
 *   - blanks_only (default): writes a field only when the current value isEmpty.
 *   - overwrite: writes every supplied field unconditionally (used by manual
 *     operator overrides; never by discovery sources).
 *
 * Always non-fatal. Returns EMPTY_RESULT on any error.
 */
export async function enrichLeadFromSource(args: {
  leadId: number;
  source: EnrichmentSource;
  patch: EnrichmentPatch;
  mode?: 'blanks_only' | 'overwrite';
}): Promise<EnrichmentResult> {
  try {
    const db = getAvDb();
    const mode = args.mode ?? 'blanks_only';
    const state = await readLeadState(db, args.leadId);
    if (!state) return EMPTY_RESULT;

    // Compute the actual write set — fields the source supplied AND
    // (in blanks_only mode) where the lead's current value is empty.
    const writes: { field: EnrichableField; value: string }[] = [];
    for (const [keyRaw, value] of Object.entries(args.patch.fields)) {
      const key = keyRaw as EnrichableField;
      if (value == null) continue;
      const v = String(value).trim();
      if (!v) continue;
      if (mode === 'blanks_only' && !isEmpty(state[key])) continue;
      writes.push({ field: key, value: v });
    }

    // Even when there are no field writes, we may still have metadata to merge
    // into source_payload. Track both so the result accurately reports what
    // happened (useful for the operator's "did this enrichment do anything?"
    // visibility on the discovery summary panel).
    const metadataKeys = args.patch.sourceMetadata ? Object.keys(args.patch.sourceMetadata) : [];
    if (writes.length === 0 && metadataKeys.length === 0) return EMPTY_RESULT;

    // Build the UPDATE atomically. last_activity_at always bumps so the lead
    // re-ranks in the cockpit list after enrichment (val sees fresh activity).
    const setParts: string[] = ['last_activity_at = NOW()'];
    const params: unknown[] = [];
    for (const w of writes) {
      setParts.push(`${w.field} = ?`);
      params.push(w.value);
    }
    if (metadataKeys.length > 0 && args.patch.sourceMetadata) {
      // JSON_MERGE_PATCH preserves prior keys; we add to source_payload, never
      // overwrite. Inc 3 will surface this as the "source provenance" panel
      // on the lead detail page.
      setParts.push(`source_payload = JSON_MERGE_PATCH(COALESCE(source_payload, JSON_OBJECT()), CAST(? AS JSON))`);
      params.push(JSON.stringify({
        [`enriched_from_${args.source}`]: {
          at: new Date().toISOString(),
          fields: writes.map((w) => w.field),
          ...args.patch.sourceMetadata
        }
      }));
    }
    params.push(args.leadId);

    await db.execute<ResultSetHeader>(
      `UPDATE leads SET ${setParts.join(', ')} WHERE id = ?`,
      params
    );

    // Provenance — system_events is queryable + already powers the events page.
    // Tagged with event_type 'lead.enriched_from_source' so val can filter
    // "show me every enrichment Google Places did this week" without a new
    // table. Inc 3 may promote this to a dedicated lead_field_provenance
    // table if the cardinality grows.
    await logEvent({
      eventType: 'lead.enriched_from_source',
      leadId: args.leadId,
      source: args.source,
      status: 'success',
      payload: {
        mode,
        filled_fields: writes.map((w) => w.field),
        metadata_keys: metadataKeys,
        note: args.patch.note ?? null
      }
    });

    return {
      filled: writes.length,
      fields: writes.map((w) => w.field),
      metadataMerged: metadataKeys.length > 0
    };
  } catch (err) {
    // Never throw out of a discovery sweep — fall through silently. Log so
    // val can see the failure in /admin/events without the sweep stopping.
    try {
      await logEvent({
        eventType: 'lead.enrich_from_source_failed',
        leadId: args.leadId,
        source: args.source,
        status: 'failure',
        errorMessage: (err as Error).message.slice(0, 500)
      });
    } catch { /* nested log failure is non-actionable */ }
    return EMPTY_RESULT;
  }
}
