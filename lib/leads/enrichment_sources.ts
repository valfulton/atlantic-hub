/**
 * lib/leads/enrichment_sources.ts  (#180 / #368, val 2026-06-02)
 *
 * Source_payload on a lead row is the place where every enrichment vendor
 * stashes its raw fields (Apollo, Clay, Hunter, Google Places, smart-scrape).
 * Almost all of it never makes it onto the lead detail page — val can see
 * leads.contact_name + employee_count, but the LinkedIn URL, the Apollo
 * industry, the Places rating, Hunter's email confidence are all buried.
 *
 * This module distills source_payload into a typed bundle of per-source
 * field groups so the Identity tab can render them as a single "Data sources"
 * section. Each group is null when the source hasn't fired.
 *
 * Read-only. NEVER mutates source_payload. All field reads are best-effort
 * (the schema across sources isn't formal).
 */

export interface ApolloFields {
  organizationId: string | null;
  industry: string | null;
  shortDescription: string | null;
  linkedinUrl: string | null;
  location: string | null;
  foundedYear: number | null;
  estimatedNumEmployees: number | null;
  personId: string | null;
  personLinkedin: string | null;
}

export interface HunterFields {
  /** Hunter returns 0-100 confidence on email matches. */
  emailConfidence: number | null;
  position: string | null;
  department: string | null;
  seniority: string | null;
  /** Verification status from Hunter Email Verifier. */
  verification: string | null;
  /** Source URLs where Hunter found the email. */
  sources: string[];
}

export interface PlacesFields {
  placeId: string | null;
  rating: number | null;
  userRatingsTotal: number | null;
  businessStatus: string | null;
  priceLevel: number | null;
  openNow: boolean | null;
  /** Top-level human-readable types ("dentist", "health"). */
  types: string[];
  photoUrl: string | null;
  mapsUrl: string | null;
}

export interface ClayFields {
  rowId: string | null;
  tableId: string | null;
  /** Any extra arbitrary fields Clay wrote — surfaced as key/value pairs
   *  so val sees what Clay actually populated without us hard-coding a list. */
  extraFields: Array<{ key: string; value: string }>;
}

export interface ScrapeFields {
  /** OG / smart-scrape headline + description if collected. */
  ogTitle: string | null;
  ogDescription: string | null;
  /** Socials found in the footer. */
  linkedin: string | null;
  instagram: string | null;
  facebook: string | null;
  twitter: string | null;
  youtube: string | null;
  tiktok: string | null;
}

export interface EnrichmentSourcesBundle {
  apollo: ApolloFields | null;
  hunter: HunterFields | null;
  places: PlacesFields | null;
  clay: ClayFields | null;
  scrape: ScrapeFields | null;
}

function parsePayload(raw: string | object | null | undefined): Record<string, unknown> {
  if (raw == null) return {};
  if (typeof raw === 'object') return raw as Record<string, unknown>;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function str(o: Record<string, unknown>, key: string): string | null {
  const v = o[key];
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function num(o: Record<string, unknown>, key: string): number | null {
  const v = o[key];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function bool(o: Record<string, unknown>, key: string): boolean | null {
  const v = o[key];
  if (typeof v === 'boolean') return v;
  if (v === 'true' || v === 1) return true;
  if (v === 'false' || v === 0) return false;
  return null;
}

function strArr(o: Record<string, unknown>, key: string): string[] {
  const v = o[key];
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((s) => s.trim());
}

// Keys we've already lifted into first-class lead columns / dedicated UI
// surfaces. Excluding them from Clay's extraFields keeps the panel quiet.
const KNOWN_KEYS = new Set([
  'apollo_organization_id', 'apollo_industry', 'apollo_short_description',
  'apollo_linkedin_url', 'apollo_location', 'apollo_founded_year',
  'apollo_estimated_num_employees', 'apollo_person_id', 'apollo_person_linkedin_url',
  'hunter_email_confidence', 'hunter_position', 'hunter_department',
  'hunter_seniority', 'hunter_verification', 'hunter_sources',
  'place_id', 'places_rating', 'places_user_ratings_total',
  'places_business_status', 'places_price_level', 'places_open_now',
  'places_types', 'places_photo_url', 'places_maps_url',
  'clay_row_id', 'clay_table_id',
  'og_title', 'og_description',
  'social_linkedin', 'social_instagram', 'social_facebook',
  'social_twitter', 'social_youtube', 'social_tiktok',
  // Things we present elsewhere or treat as plumbing:
  'sub_source', 'pr_expert_topics', 'prospect_intel',
  'apollo_org_shell', 'address_street', 'address_city', 'address_state',
  'address_postal', 'address_country'
]);

function apolloFrom(o: Record<string, unknown>): ApolloFields | null {
  const f: ApolloFields = {
    organizationId: str(o, 'apollo_organization_id'),
    industry: str(o, 'apollo_industry'),
    shortDescription: str(o, 'apollo_short_description'),
    linkedinUrl: str(o, 'apollo_linkedin_url'),
    location: str(o, 'apollo_location'),
    foundedYear: num(o, 'apollo_founded_year'),
    estimatedNumEmployees: num(o, 'apollo_estimated_num_employees'),
    personId: str(o, 'apollo_person_id'),
    personLinkedin: str(o, 'apollo_person_linkedin_url')
  };
  return Object.values(f).some((v) => v !== null) ? f : null;
}

function hunterFrom(o: Record<string, unknown>): HunterFields | null {
  const f: HunterFields = {
    emailConfidence: num(o, 'hunter_email_confidence'),
    position: str(o, 'hunter_position'),
    department: str(o, 'hunter_department'),
    seniority: str(o, 'hunter_seniority'),
    verification: str(o, 'hunter_verification'),
    sources: strArr(o, 'hunter_sources').slice(0, 5)
  };
  const hasAny = f.emailConfidence !== null || f.position || f.department || f.seniority || f.verification || f.sources.length > 0;
  return hasAny ? f : null;
}

function placesFrom(o: Record<string, unknown>): PlacesFields | null {
  const f: PlacesFields = {
    placeId: str(o, 'place_id'),
    rating: num(o, 'places_rating'),
    userRatingsTotal: num(o, 'places_user_ratings_total'),
    businessStatus: str(o, 'places_business_status'),
    priceLevel: num(o, 'places_price_level'),
    openNow: bool(o, 'places_open_now'),
    types: strArr(o, 'places_types').slice(0, 6),
    photoUrl: str(o, 'places_photo_url'),
    mapsUrl: str(o, 'places_maps_url')
  };
  const hasAny = f.placeId || f.rating !== null || f.userRatingsTotal !== null || f.businessStatus || f.priceLevel !== null || f.openNow !== null || f.types.length > 0 || f.photoUrl || f.mapsUrl;
  return hasAny ? f : null;
}

function clayFrom(o: Record<string, unknown>): ClayFields | null {
  const extras: Array<{ key: string; value: string }> = [];
  for (const [k, v] of Object.entries(o)) {
    if (KNOWN_KEYS.has(k)) continue;
    // Only surface clay_* keys + a few generic enrichment-ish keys.
    if (!k.startsWith('clay_') && !k.startsWith('enriched_')) continue;
    if (typeof v === 'string' && v.trim().length > 0) {
      extras.push({ key: k, value: v.trim().slice(0, 200) });
    } else if (typeof v === 'number' || typeof v === 'boolean') {
      extras.push({ key: k, value: String(v) });
    }
    if (extras.length >= 12) break;
  }
  const rowId = str(o, 'clay_row_id');
  const tableId = str(o, 'clay_table_id');
  if (!rowId && !tableId && extras.length === 0) return null;
  return { rowId, tableId, extraFields: extras };
}

function scrapeFrom(o: Record<string, unknown>): ScrapeFields | null {
  const f: ScrapeFields = {
    ogTitle: str(o, 'og_title'),
    ogDescription: str(o, 'og_description'),
    linkedin: str(o, 'social_linkedin'),
    instagram: str(o, 'social_instagram'),
    facebook: str(o, 'social_facebook'),
    twitter: str(o, 'social_twitter'),
    youtube: str(o, 'social_youtube'),
    tiktok: str(o, 'social_tiktok')
  };
  const hasAny = Object.values(f).some((v) => v !== null && v !== '');
  return hasAny ? f : null;
}

/** Public entry: parse source_payload + return a tidy per-source bundle. */
export function enrichmentSourcesFrom(raw: string | object | null | undefined): EnrichmentSourcesBundle {
  const o = parsePayload(raw);
  return {
    apollo: apolloFrom(o),
    hunter: hunterFrom(o),
    places: placesFrom(o),
    clay: clayFrom(o),
    scrape: scrapeFrom(o)
  };
}
