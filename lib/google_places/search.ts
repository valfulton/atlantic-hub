/**
 * Google Places API (New) client — Text Search + Place Details.
 *
 * Why this exists (May 2026): Apollo's coverage of USVI hospitality is thin.
 * Google Places has near-perfect coverage of restaurants, hotels, resorts,
 * marinas, and event venues in any geography because they pull from Maps.
 *
 * Free tier (as of May 2026):
 *   - $200/mo Maps Platform credit auto-applied to every Google Cloud account
 *   - Text Search (New, Essentials SKU): $5 / 1k requests with the
 *     'places.id,places.displayName' field mask we use → ~6,667 free searches
 *   - Text Search with rich fields: $32 / 1k requests → ~6,250 free searches
 *     (we cap pages at 1-2 so a typical query stays at 1-2 requests)
 *   - Place Details (Enterprise SKU, used for websiteUri + phone):
 *     $17 / 1k → ~11,700 free lookups
 *   Val should be safely inside the free tier with normal use.
 *
 * Endpoints (REST, POST):
 *   - https://places.googleapis.com/v1/places:searchText
 *   - https://places.googleapis.com/v1/places/{placeId}
 *
 * Auth: X-Goog-Api-Key header. Field masks are MANDATORY on the new API —
 * passing none → 400. The mask determines which billing SKU you hit.
 *
 * Reads GOOGLE_PLACES_API_KEY from process.env (Netlify env var).
 *
 * Docs: https://developers.google.com/maps/documentation/places/web-service/text-search
 */

const PLACES_BASE = 'https://places.googleapis.com/v1';

export interface PlaceSummary {
  id: string;
  displayName: string;
  formattedAddress: string | null;
  /** Google's primary type (e.g. 'restaurant', 'lodging'). Used for target_business heuristic. */
  primaryType: string | null;
  /** All types — broader signal. */
  types: string[];
  /** 0..5 Google rating. */
  rating: number | null;
  userRatingCount: number | null;
}

export interface PlaceDetails extends PlaceSummary {
  websiteUri: string | null;
  /** National + international are returned as separate fields; we prefer international. */
  internationalPhoneNumber: string | null;
  nationalPhoneNumber: string | null;
  googleMapsUri: string | null;
  shortFormattedAddress: string | null;
  businessStatus: string | null;
}

export class GooglePlacesApiKeyMissingError extends Error {
  constructor() {
    super('GOOGLE_PLACES_API_KEY is not set in Netlify environment variables');
    this.name = 'GooglePlacesApiKeyMissingError';
  }
}

export class GooglePlacesApiError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string) {
    super(`Google Places API error ${status}: ${body.slice(0, 200)}`);
    this.name = 'GooglePlacesApiError';
    this.status = status;
    this.body = body;
  }
}

export interface TextSearchFilters {
  /** Free-text query, e.g. "boutique hotels in St. Croix USVI". REQUIRED. */
  textQuery: string;
  /** Limit result types — common values: 'restaurant', 'lodging', 'tourist_attraction'. */
  includedType?: string;
  /** Bias by lat/lng + radius in meters (max 50000). Optional but improves USVI hits. */
  locationBias?: { latitude: number; longitude: number; radius: number };
  /** Max 20 per page; new API supports pagination via pageToken. */
  pageSize?: number;
  pageToken?: string;
  /** Open-now filter; useful for tourism use cases. */
  openNow?: boolean;
}

export interface TextSearchResult {
  places: PlaceSummary[];
  nextPageToken: string | null;
}

/**
 * POST places:searchText with the LIGHT field mask. Returns up to pageSize
 * (max 20) PlaceSummary objects. Use the cheap field mask to keep cost low;
 * call placeDetails separately for the rich fields (website, phone).
 */
export async function placesTextSearch(filters: TextSearchFilters): Promise<TextSearchResult> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) throw new GooglePlacesApiKeyMissingError();

  const body: Record<string, unknown> = {
    textQuery: filters.textQuery,
    pageSize: Math.min(20, Math.max(1, filters.pageSize ?? 20))
  };
  if (filters.includedType) body.includedType = filters.includedType;
  if (filters.locationBias) {
    body.locationBias = {
      circle: {
        center: { latitude: filters.locationBias.latitude, longitude: filters.locationBias.longitude },
        radius: Math.min(50000, Math.max(1, filters.locationBias.radius))
      }
    };
  }
  if (filters.pageToken) body.pageToken = filters.pageToken;
  if (typeof filters.openNow === 'boolean') body.openNow = filters.openNow;

  // Field mask — controls which fields come back AND which billing SKU you hit.
  // 'places.id' + 'places.displayName' is the cheapest tier ($5/1k).
  // Adding formattedAddress / types / rating bumps to Essentials ($32/1k) which is fine.
  const fieldMask = [
    'places.id',
    'places.displayName',
    'places.formattedAddress',
    'places.primaryType',
    'places.types',
    'places.rating',
    'places.userRatingCount',
    'nextPageToken'
  ].join(',');

  const res = await fetch(`${PLACES_BASE}/places:searchText`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': fieldMask
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new GooglePlacesApiError(res.status, errBody);
  }

  const json = (await res.json()) as {
    places?: Array<{
      id: string;
      displayName?: { text?: string };
      formattedAddress?: string;
      primaryType?: string;
      types?: string[];
      rating?: number;
      userRatingCount?: number;
    }>;
    nextPageToken?: string;
  };

  const places: PlaceSummary[] = (json.places ?? []).map((p) => ({
    id: p.id,
    displayName: p.displayName?.text ?? '',
    formattedAddress: p.formattedAddress ?? null,
    primaryType: p.primaryType ?? null,
    types: p.types ?? [],
    rating: typeof p.rating === 'number' ? p.rating : null,
    userRatingCount: typeof p.userRatingCount === 'number' ? p.userRatingCount : null
  }));

  return { places, nextPageToken: json.nextPageToken ?? null };
}

/**
 * GET /v1/places/{placeId} with the rich field mask. Adds website + phone
 * which is what makes the lead actually useful. Costs $17/1k.
 */
export async function placeDetails(placeId: string): Promise<PlaceDetails | null> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) throw new GooglePlacesApiKeyMissingError();

  const fieldMask = [
    'id',
    'displayName',
    'formattedAddress',
    'shortFormattedAddress',
    'primaryType',
    'types',
    'rating',
    'userRatingCount',
    'websiteUri',
    'internationalPhoneNumber',
    'nationalPhoneNumber',
    'googleMapsUri',
    'businessStatus'
  ].join(',');

  const res = await fetch(`${PLACES_BASE}/places/${encodeURIComponent(placeId)}`, {
    method: 'GET',
    headers: {
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': fieldMask
    }
  });

  if (res.status === 404) return null;
  if (!res.ok) {
    const errBody = await res.text();
    throw new GooglePlacesApiError(res.status, errBody);
  }

  const p = (await res.json()) as {
    id: string;
    displayName?: { text?: string };
    formattedAddress?: string;
    shortFormattedAddress?: string;
    primaryType?: string;
    types?: string[];
    rating?: number;
    userRatingCount?: number;
    websiteUri?: string;
    internationalPhoneNumber?: string;
    nationalPhoneNumber?: string;
    googleMapsUri?: string;
    businessStatus?: string;
  };

  return {
    id: p.id,
    displayName: p.displayName?.text ?? '',
    formattedAddress: p.formattedAddress ?? null,
    shortFormattedAddress: p.shortFormattedAddress ?? null,
    primaryType: p.primaryType ?? null,
    types: p.types ?? [],
    rating: typeof p.rating === 'number' ? p.rating : null,
    userRatingCount: typeof p.userRatingCount === 'number' ? p.userRatingCount : null,
    websiteUri: p.websiteUri ?? null,
    internationalPhoneNumber: p.internationalPhoneNumber ?? null,
    nationalPhoneNumber: p.nationalPhoneNumber ?? null,
    googleMapsUri: p.googleMapsUri ?? null,
    businessStatus: p.businessStatus ?? null
  };
}

/**
 * Map Google's primary type to our normalized industry slug (same vocabulary
 * as lib/apollo/search.ts:normalizeIndustry). Falls back to 'other'.
 */
export function googleTypeToIndustry(primaryType: string | null, types: string[] = []): string | null {
  if (!primaryType && types.length === 0) return null;
  const haystack = [primaryType ?? '', ...types].join(' ').toLowerCase();
  if (/restaurant|food|bar|brewery|cafe|bakery/.test(haystack)) return 'restaurant';
  if (/lodging|hotel|resort|hostel|motel|inn|b_and_b/.test(haystack)) return 'corporate_retreat';
  if (/wedding|event_venue|banquet/.test(haystack)) return 'wedding_planner';
  if (/marketing|advertising/.test(haystack)) return 'agency';
  if (/marina|yacht|boat/.test(haystack)) return 'other';
  return 'other';
}
