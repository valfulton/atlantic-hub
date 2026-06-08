/**
 * lib/av/address_geocode.ts  (#529, val 2026-06-08)
 *
 * Address → census geography via the Census Bureau Geocoding Services API.
 * Free, no auth, no rate-limit for our volume. Returns county FIPS + state
 * postal code + census tract GEOID so we can chain into HMDA aggregates and
 * future tract-scoped sources.
 *
 * API docs: https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.html
 * Endpoint: /geocoder/geographies/onelineaddress
 *   - benchmark: Public_AR_Current
 *   - vintage: Current_Current
 * Returns matched addresses with FIPS-coded geographies (state, county, tract).
 *
 * This is the entry point for any address-targeted public-intel adapter:
 *   - HMDA (mortgage market stress by tract)
 *   - Census ACS (income / housing characteristics by tract)
 *   - County tax assessor stubs (per-property, gated on #422 Puppeteer)
 *
 * Per val's "no duct tape · intelligence auto-populates" rule: this is the
 * single canonical geocoder. All downstream adapters consume its output.
 */

export interface GeocodeResult {
  /** The input string we sent (echoed back for tracing). */
  input: string;
  /** Census-normalized matched address ("6105 POLO CLUB DR, CUMMING, GA, 30040"). */
  matchedAddress: string;
  /** WGS84 lat/lon from Census. */
  lat: number;
  lon: number;
  /** USPS 2-letter state code ("GA"). */
  state: string;
  /** 2-digit state FIPS ("13" for GA). */
  stateFips: string;
  /** Full county name ("Forsyth County"). */
  countyName: string;
  /** 5-digit state+county FIPS ("13117" for Forsyth County, GA). */
  countyFips: string;
  /** 11-digit census tract GEOID (state+county+tract). */
  tractGeoid: string | null;
  /** ZIP code from matched address. */
  zip: string | null;
}

const ENDPOINT = 'https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress';

/**
 * Geocode a one-line address. Returns null on no-match, network error,
 * or malformed response. Never throws.
 */
export async function geocodeAddress(oneLine: string): Promise<GeocodeResult | null> {
  if (!oneLine || oneLine.trim().length < 5) return null;
  const params = new URLSearchParams();
  params.set('address', oneLine.trim());
  params.set('benchmark', 'Public_AR_Current');
  params.set('vintage', 'Current_Current');
  params.set('format', 'json');
  params.set('layers', '10'); // Counties + tracts

  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(`${ENDPOINT}?${params.toString()}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'AtlanticHub/1.0 (research)' }
    });
    if (!res.ok) return null;
    const j = (await res.json()) as {
      result?: {
        addressMatches?: Array<{
          matchedAddress?: string;
          coordinates?: { x?: number; y?: number };
          addressComponents?: { zip?: string; state?: string };
          geographies?: {
            ['Counties']?: Array<{
              STATE?: string;
              COUNTY?: string;
              NAME?: string;
              BASENAME?: string;
            }>;
            ['Census Tracts']?: Array<{ GEOID?: string }>;
          };
        }>;
      };
    };
    const m = j.result?.addressMatches?.[0];
    if (!m) return null;

    const county = m.geographies?.['Counties']?.[0];
    const tract = m.geographies?.['Census Tracts']?.[0];
    const stateFips = county?.STATE ?? '';
    const countyCode = county?.COUNTY ?? '';
    if (!stateFips || !countyCode) return null;

    return {
      input: oneLine,
      matchedAddress: m.matchedAddress ?? oneLine,
      lat: m.coordinates?.y ?? 0,
      lon: m.coordinates?.x ?? 0,
      state: m.addressComponents?.state ?? '',
      stateFips,
      countyName: county?.NAME ?? county?.BASENAME ?? '',
      countyFips: `${stateFips}${countyCode}`,
      tractGeoid: tract?.GEOID ?? null,
      zip: m.addressComponents?.zip ?? null
    };
  } catch {
    return null;
  } finally {
    clearTimeout(tid);
  }
}
