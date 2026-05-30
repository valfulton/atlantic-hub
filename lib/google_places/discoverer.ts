/**
 * lib/google_places/discoverer.ts
 *
 * Runs a Google Places search, dedups each result against existing leads
 * (by domain), inserts new leads with rich Place Details (website + phone).
 *
 * Pattern matches lib/apollo/discoverer.ts so the UI can treat it identically.
 */

import { randomUUID } from 'crypto';
import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { getAvDb } from '@/lib/db/av';
import {
  placesTextSearch,
  placeDetails,
  googleTypeToIndustry,
  type TextSearchFilters,
  type PlaceDetails
} from '@/lib/google_places/search';
import { inferTargetBusinessFromRaw, type TargetBusiness } from '@/lib/leads/target_business';
import { findExistingLead, normalizeDomain, mergeTargetBusiness } from '@/lib/leads/dedup';
import { logEvent } from '@/lib/events/log';
import { scoreAndAuditLeadBackground } from '@/lib/ai/score_and_audit';
import { enrichLeadFromSource } from '@/lib/enrichment/multi_source_enricher';

export type PlacesDiscoverOutcome =
  | 'inserted'
  | 'duplicate_existing'
  | 'duplicate_target_upgraded'
  /** (#251 Inc 1) Lead already existed but THIS Places call fetched fresh
   *  data we didn't have yet (phone, address, rating, etc.) and wrote it
   *  onto the existing row instead of throwing it away. */
  | 'duplicate_enriched'
  | 'no_phone_or_website'
  | 'insert_failed';

/**
 * (#251 Inc 1) Best-effort parse of Google's formattedAddress into the
 * canonical leads.address_* columns. Google doesn't return structured
 * components at our field-mask tier — we'd have to bump to the more
 * expensive Enterprise SKU. Cheap heuristic split on commas works for the
 * 80% case (US addresses arrive as "street, city, state postal, country").
 * Anything ambiguous gets left out (we never fabricate a city when the
 * pattern doesn't match — the enricher only writes the fields that parsed
 * cleanly). The full formattedAddress always lands in sourceMetadata so
 * nothing is lost.
 */
function parseFormattedAddress(formatted: string | null | undefined): {
  street?: string;
  city?: string;
  state?: string;
  postal?: string;
  country?: string;
} {
  if (!formatted || typeof formatted !== 'string') return {};
  const parts = formatted.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return {};
  const country = parts.length >= 3 ? parts[parts.length - 1] : undefined;
  const stateLine = parts.length >= 3 ? parts[parts.length - 2] : parts[parts.length - 1];
  const city = parts.length >= 3 ? parts[parts.length - 3] : parts[parts.length - 2];
  const street = parts.length >= 4 ? parts.slice(0, parts.length - 3).join(', ') : parts[0];
  // "CA 90210" or "NY 10001-1234" — split on whitespace to peel postal off the state.
  let state: string | undefined;
  let postal: string | undefined;
  const m = /^([A-Za-z .]+?)\s+([0-9A-Za-z\- ]+)$/.exec(stateLine ?? '');
  if (m) {
    state = m[1].trim();
    postal = m[2].trim();
  } else {
    state = stateLine?.trim();
  }
  return {
    street: street && street !== city ? street : undefined,
    city: city?.trim() || undefined,
    state: state || undefined,
    postal: postal || undefined,
    country: country?.trim() || undefined
  };
}

/**
 * (#251 Inc 1) Build the enrichment patch shape from a Google Places result.
 * Used by BOTH dedup branches (client-scoped + operator-scoped) to keep the
 * blank-fill behavior identical across paths. The metadata blob captures the
 * Places-specific signal that doesn't fit a column — rating, hours, business
 * status, types — so the lead detail can later surface "this came from Places
 * on 2026-05-30, has 4.6 stars from 312 reviews."
 */
function buildPlacesPatch(
  det: PlaceDetails,
  phone: string | null,
  website: string | null,
  industry: string | null
) {
  const addr = parseFormattedAddress(det.formattedAddress);
  return {
    fields: {
      phone: phone ?? undefined,
      website: website ?? undefined,
      industry: industry ?? undefined,
      address_street: addr.street,
      address_city: addr.city,
      address_state: addr.state,
      address_postal: addr.postal,
      address_country: addr.country
    },
    sourceMetadata: {
      place_id: det.id,
      primary_type: det.primaryType,
      types: det.types,
      rating: det.rating,
      user_rating_count: det.userRatingCount,
      business_status: det.businessStatus,
      formatted_address: det.formattedAddress
    },
    note: 'duplicate-hit enrichment'
  };
}

export interface PlacesDiscoverResult {
  placeId: string;
  outcome: PlacesDiscoverOutcome;
  leadId?: number;
  details: {
    company: string;
    domain?: string;
    industry?: string | null;
    primaryType?: string | null;
    rating?: number | null;
    userRatingCount?: number | null;
    error?: string;
  };
}

export interface PlacesDiscoverBatchResult {
  filters: TextSearchFilters;
  resultsCount: number;
  insertedCount: number;
  duplicateCount: number;
  /** (#251 Inc 1) Existing leads whose data this sweep filled with fresh
   *  Places info (phone / address / industry / metadata). Counted separately
   *  from duplicateCount so the operator can see compounding intelligence. */
  enrichedCount: number;
  results: PlacesDiscoverResult[];
  nextPageToken: string | null;
}

const PLACE_ID_PREFIX = 'placeid:'; // stored in apollo_person_id column to share the unique constraint

async function insertOnePlace(db: Pool, det: PlaceDetails, clientId: number | null): Promise<PlacesDiscoverResult> {
  const company = det.displayName || 'Unknown';
  const website = det.websiteUri || null;
  const domain = normalizeDomain(website);
  const phone = det.internationalPhoneNumber || det.nationalPhoneNumber || null;
  const industry = googleTypeToIndustry(det.primaryType, det.types);
  const targetBusiness: TargetBusiness = inferTargetBusinessFromRaw(det.primaryType ?? det.types[0] ?? null);

  // Stable dedup key — store in apollo_person_id (UNIQUE) to share the constraint.
  // Client runs prefix the key so the same place can land in multiple hubs.
  const scoped = clientId && clientId > 0;
  const dedupKey = scoped ? `c${clientId}:${PLACE_ID_PREFIX}${det.id}` : `${PLACE_ID_PREFIX}${det.id}`;
  const placeholderEmail = `noemail+place-${det.id.slice(0, 24)}@eventsbywater.com`;
  const auditId = randomUUID();

  if (scoped) {
    // Per-client dedup: only against THIS client's own leads. Never read or
    // mutate the operator pipeline or another client's rows.
    if (domain) {
      const [dupDomain] = await db.execute<(RowDataPacket & { id: number })[]>(
        `SELECT id FROM leads WHERE client_id = ? AND normalized_domain = ? AND archived_at IS NULL LIMIT 1`,
        [clientId, domain]
      );
      if (dupDomain.length > 0) {
        // (#251 Inc 1) Don't throw away the rich data Places just fetched —
        // enrich the existing client-scoped lead with anything we don't have
        // yet (phone, address parts, industry). source_payload gets a merged
        // provenance entry so val can audit who filled what.
        const enrichment = await enrichLeadFromSource({
          leadId: dupDomain[0].id,
          source: 'google_places',
          patch: buildPlacesPatch(det, phone, website, industry)
        });
        return {
          placeId: det.id,
          outcome: enrichment.filled > 0 ? 'duplicate_enriched' : 'duplicate_existing',
          leadId: dupDomain[0].id,
          details: { company, domain: domain ?? undefined, industry, primaryType: det.primaryType, rating: det.rating, userRatingCount: det.userRatingCount }
        };
      }
    }
  } else {
    // Operator path: global domain dedup + target_business merge + (#251) enrichment.
    const existing = await findExistingLead(db, { domain: website, phone, mode: 'loose' });
    if (existing) {
      // (#251 Inc 1) Same enrichment write as the client path — fill any
      // blanks on the existing operator-pipeline lead from Places' new data.
      // Runs BEFORE the target_business merge so the outcome label below
      // can still distinguish a target_upgrade from a pure enrichment.
      const enrichment = await enrichLeadFromSource({
        leadId: existing.leadId,
        source: 'google_places',
        patch: buildPlacesPatch(det, phone, website, industry)
      });
      const merged = mergeTargetBusiness(existing.targetBusiness ?? 'av', targetBusiness);
      if (merged !== existing.targetBusiness) {
        await db.execute(`UPDATE leads SET target_business = ?, last_activity_at = NOW() WHERE id = ?`, [
          merged,
          existing.leadId
        ]);
        return {
          placeId: det.id,
          outcome: 'duplicate_target_upgraded',
          leadId: existing.leadId,
          details: { company, domain: domain ?? undefined, industry, primaryType: det.primaryType, rating: det.rating, userRatingCount: det.userRatingCount }
        };
      }
      return {
        placeId: det.id,
        outcome: enrichment.filled > 0 ? 'duplicate_enriched' : 'duplicate_existing',
        leadId: existing.leadId,
        details: { company, domain: domain ?? undefined, industry, primaryType: det.primaryType, rating: det.rating, userRatingCount: det.userRatingCount }
      };
    }
  }

  // Also check by Google place_id stored in apollo_person_id (handles re-runs of same search)
  const [byPlaceId] = await db.execute<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM leads WHERE apollo_person_id = ? LIMIT 1`,
    [dedupKey]
  );
  if (byPlaceId.length > 0) {
    return {
      placeId: det.id,
      outcome: 'duplicate_existing',
      leadId: byPlaceId[0].id,
      details: { company, domain: domain ?? undefined, industry, primaryType: det.primaryType, rating: det.rating, userRatingCount: det.userRatingCount }
    };
  }

  // Require AT LEAST one contact channel — without a phone or website the lead
  // is unworkable downstream (Hunter has nothing to enrich, you have nothing to call).
  if (!website && !phone) {
    return {
      placeId: det.id,
      outcome: 'no_phone_or_website',
      details: { company, industry, primaryType: det.primaryType, rating: det.rating, userRatingCount: det.userRatingCount }
    };
  }

  const sourcePayload = {
    source: 'google_places/searchText+details',
    place_id: det.id,
    google_maps_uri: det.googleMapsUri,
    primary_type: det.primaryType,
    types: det.types,
    formatted_address: det.formattedAddress,
    rating: det.rating,
    user_rating_count: det.userRatingCount,
    business_status: det.businessStatus
  };

  try {
    const [result] = await db.execute<ResultSetHeader>(
      `INSERT INTO leads (
         audit_id, company, email, phone, website, normalized_domain,
         industry, lead_status, source_type, target_business, source_payload,
         apollo_person_id, client_id, last_activity_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, 'new', 'scrape', ?, ?, ?, ?, NOW())`,
      [
        auditId,
        company,
        placeholderEmail,
        phone,
        website,
        domain,
        industry,
        targetBusiness,
        JSON.stringify(sourcePayload),
        dedupKey,
        clientId
      ]
    );
    const newLeadId = result.insertId;
    await logEvent({
      eventType: 'lead.created',
      leadId: newLeadId,
      source: 'google_places',
      status: 'success',
      payload: {
        company,
        domain,
        industry,
        primary_type: det.primaryType,
        target_business: targetBusiness,
        place_id: det.id,
        rating: det.rating,
        user_rating_count: det.userRatingCount
      }
    });
    scoreAndAuditLeadBackground(newLeadId);
    return {
      placeId: det.id,
      outcome: 'inserted',
      leadId: newLeadId,
      details: { company, domain: domain ?? undefined, industry, primaryType: det.primaryType, rating: det.rating, userRatingCount: det.userRatingCount }
    };
  } catch (err) {
    await logEvent({
      eventType: 'workflow.failed',
      source: 'google_places',
      status: 'failure',
      payload: { stage: 'insertOnePlace', company, place_id: det.id },
      errorMessage: (err as Error).message.slice(0, 500)
    });
    return {
      placeId: det.id,
      outcome: 'insert_failed',
      details: { company, error: (err as Error).message }
    };
  }
}

/**
 * Run a Text Search, fetch Place Details for each hit, insert each as a lead.
 * Returns per-place outcomes for the UI to render.
 *
 * Cost per call: 1 text search + N place detail lookups. For pageSize=20:
 * roughly 21 API calls = ~$0.32 ($5 + 20*$17) / 1k = ~$0.00037 per place.
 */
export async function runPlacesDiscoveryBatch(
  filters: TextSearchFilters,
  opts: { clientId?: number | null } = {}
): Promise<PlacesDiscoverBatchResult> {
  const clientId = opts.clientId ?? null;
  const db = getAvDb();
  const search = await placesTextSearch(filters);
  const results: PlacesDiscoverResult[] = [];
  for (const place of search.places) {
    let details;
    try {
      details = await placeDetails(place.id);
    } catch (err) {
      results.push({
        placeId: place.id,
        outcome: 'insert_failed',
        details: { company: place.displayName, error: (err as Error).message }
      });
      continue;
    }
    if (!details) continue;
    results.push(await insertOnePlace(db, details, clientId));
  }
  const insertedCount = results.filter((r) => r.outcome === 'inserted').length;
  const enrichedCount = results.filter((r) => r.outcome === 'duplicate_enriched').length;
  // (#251 Inc 1) duplicateCount now counts BOTH pure duplicates (nothing new
  // to add) AND target_upgrades (only the target_business field changed) AND
  // enriched duplicates — same as before so the existing UI doesn't regress.
  // enrichedCount is broken out separately for the new "compounding intel"
  // chip on the discovery summary panel.
  const duplicateCount = results.filter((r) =>
    r.outcome === 'duplicate_existing' ||
    r.outcome === 'duplicate_target_upgraded' ||
    r.outcome === 'duplicate_enriched'
  ).length;
  return {
    filters,
    resultsCount: search.places.length,
    insertedCount,
    duplicateCount,
    enrichedCount,
    results,
    nextPageToken: search.nextPageToken
  };
}
