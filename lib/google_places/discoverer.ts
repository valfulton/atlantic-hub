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

export type PlacesDiscoverOutcome =
  | 'inserted'
  | 'duplicate_existing'
  | 'duplicate_target_upgraded'
  | 'no_phone_or_website'
  | 'insert_failed';

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
  results: PlacesDiscoverResult[];
  nextPageToken: string | null;
}

const PLACE_ID_PREFIX = 'placeid:'; // stored in apollo_person_id column to share the unique constraint

async function insertOnePlace(db: Pool, det: PlaceDetails): Promise<PlacesDiscoverResult> {
  const company = det.displayName || 'Unknown';
  const website = det.websiteUri || null;
  const domain = normalizeDomain(website);
  const phone = det.internationalPhoneNumber || det.nationalPhoneNumber || null;
  const industry = googleTypeToIndustry(det.primaryType, det.types);
  const targetBusiness: TargetBusiness = inferTargetBusinessFromRaw(det.primaryType ?? det.types[0] ?? null);

  // Stable dedup key — store in apollo_person_id (UNIQUE) to share the constraint.
  const dedupKey = `${PLACE_ID_PREFIX}${det.id}`;
  const placeholderEmail = `noemail+place-${det.id.slice(0, 24)}@eventsbywater.com`;
  const auditId = randomUUID();

  // Try domain-based dedup first — Apollo might have already inserted this same business.
  const existing = await findExistingLead(db, { domain: website, phone, mode: 'loose' });
  if (existing) {
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
      outcome: 'duplicate_existing',
      leadId: existing.leadId,
      details: { company, domain: domain ?? undefined, industry, primaryType: det.primaryType, rating: det.rating, userRatingCount: det.userRatingCount }
    };
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
         apollo_person_id, last_activity_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, 'new', 'scrape', ?, ?, ?, NOW())`,
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
        dedupKey
      ]
    );
    return {
      placeId: det.id,
      outcome: 'inserted',
      leadId: result.insertId,
      details: { company, domain: domain ?? undefined, industry, primaryType: det.primaryType, rating: det.rating, userRatingCount: det.userRatingCount }
    };
  } catch (err) {
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
export async function runPlacesDiscoveryBatch(filters: TextSearchFilters): Promise<PlacesDiscoverBatchResult> {
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
    results.push(await insertOnePlace(db, details));
  }
  const insertedCount = results.filter((r) => r.outcome === 'inserted').length;
  const duplicateCount = results.filter((r) => r.outcome === 'duplicate_existing' || r.outcome === 'duplicate_target_upgraded').length;
  return {
    filters,
    resultsCount: search.places.length,
    insertedCount,
    duplicateCount,
    results,
    nextPageToken: search.nextPageToken
  };
}
