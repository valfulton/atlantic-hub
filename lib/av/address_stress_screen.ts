/**
 * lib/av/address_stress_screen.ts  (#529, val 2026-06-08)
 *
 * Per-address financial-stress screen. For every address on the dossier
 * (from address_history), this:
 *   1. Geocodes via Census Bureau Geocoding Services → state, county FIPS, tract GEOID
 *   2. Runs HMDA aggregate for that county → mortgage market stress signal
 *      (denial rate, total apps, median loan amount, top loan purposes)
 *   3. Stubs in a "property-record" placeholder so val knows what's coming
 *      when the Puppeteer worker (#422) is provisioned for county assessors
 *
 * The output is persisted to public_intel_records keyed by address-slug so
 * the Intelligence Feed shows entity-specific results, not state aggregates.
 *
 * Per the no-duct-tape rule: this is the canonical per-address screen.
 * Every adapter that wants to lookup BY ADDRESS goes through this helper.
 *
 * Honesty:
 *   - HMDA is COUNTY-level — it shows the lending environment around the
 *     address, not the address's own mortgage. Result labels say so.
 *   - Per-property records (assessor, deeds, mortgage balance) require the
 *     Puppeteer worker. Until #422 lands, we surface a "pending worker"
 *     stub so val sees the visibility-gap and isn't surprised.
 */
import { geocodeAddress, type GeocodeResult } from './address_geocode';
import { fetchHmdaAggregate, type HmdaAggregate, HMDA_CURRENT_YEAR } from '../public_intel/adapters/hmda';
import { getAvDb } from '../db/av';
import type { ResultSetHeader } from 'mysql2';

export interface AddressScreenResult {
  /** Original address from the dossier. */
  address: string;
  /** Census-matched canonical form, or null on no-match. */
  matchedAddress: string | null;
  /** What county we resolved to. */
  county: string | null;
  /** State 2-letter code. */
  state: string | null;
  /** HMDA aggregate for the county, if HMDA returned data. */
  hmda: HmdaAggregate | null;
  /** Honest stub for per-property records (#422 dependency). */
  propertyRecord: {
    status: 'pending_worker' | 'unavailable';
    note: string;
  };
  /** Did this address geocode and produce useful signal? */
  ok: boolean;
  /** Plain-language one-line interpretation for the red-flag ribbon. */
  signalLabel: string;
}

/**
 * Run the full address screen for one address. Geocodes + HMDA, returns the
 * structured result. Does NOT persist — caller decides what to write.
 */
export async function screenAddress(address: string): Promise<AddressScreenResult> {
  const geo = await geocodeAddress(address);
  if (!geo) {
    return {
      address,
      matchedAddress: null,
      county: null,
      state: null,
      hmda: null,
      propertyRecord: {
        status: 'unavailable',
        note: 'Address could not be geocoded — verify spelling / format'
      },
      ok: false,
      signalLabel: `Address screen: could not geocode "${address}"`
    };
  }

  // HMDA for this county. May return null if FFIEC has no data for the year/county.
  const hmda = await fetchHmdaAggregate(HMDA_CURRENT_YEAR, geo.state, geo.countyFips);

  const signalLabel = buildSignalLabel(geo, hmda);
  return {
    address,
    matchedAddress: geo.matchedAddress,
    county: geo.countyName,
    state: geo.state,
    hmda,
    propertyRecord: {
      status: 'pending_worker',
      note: `Per-property record (owner, assessed value, last sale, mortgage balance) for ${geo.countyName}, ${geo.state} will populate when the Puppeteer worker (#422) is provisioned. Until then this address is in queue.`
    },
    ok: true,
    signalLabel
  };
}

function buildSignalLabel(geo: GeocodeResult, hmda: HmdaAggregate | null): string {
  if (!hmda) {
    return `${geo.countyName}, ${geo.state}: HMDA data unavailable for ${HMDA_CURRENT_YEAR}`;
  }
  const denialPct = hmda.denial_rate != null ? (hmda.denial_rate * 100).toFixed(1) : '?';
  const median = hmda.median_loan_amount
    ? `$${Math.round(hmda.median_loan_amount).toLocaleString()}`
    : 'n/a';
  return `${geo.countyName}, ${geo.state}: ${hmda.total_applications.toLocaleString()} ${HMDA_CURRENT_YEAR} mortgage apps, ${denialPct}% denied, median loan ${median}`;
}

/**
 * Run screenAddress for every address in `addresses`, persist each result to
 * public_intel_records, and return the array of results. Used by the
 * /dossier/address-screen route.
 */
export async function screenAddressesAndPersist(
  clientId: number,
  addresses: string[]
): Promise<AddressScreenResult[]> {
  if (!addresses || addresses.length === 0) return [];
  const out: AddressScreenResult[] = [];
  const db = getAvDb();
  const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);

  for (const addr of addresses) {
    const result = await screenAddress(addr);
    out.push(result);
    if (!result.ok) continue;

    const slug = (result.matchedAddress ?? result.address)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 160);

    try {
      await db.execute<ResultSetHeader>(
        `INSERT INTO public_intel_records
           (source_kind, entity_key, client_id, lead_id, record_json,
            summary_label, region_code, fetched_at, expires_at)
         VALUES ('address_screen', ?, ?, NULL, CAST(? AS JSON), ?, ?, NOW(), ?)
         ON DUPLICATE KEY UPDATE
           client_id = VALUES(client_id),
           record_json = VALUES(record_json),
           summary_label = VALUES(summary_label),
           fetched_at = NOW(),
           expires_at = VALUES(expires_at)`,
        [
          `address_screen:${slug}`,
          clientId,
          JSON.stringify(result),
          result.signalLabel.slice(0, 250),
          result.state,
          expiresAt
        ]
      );
    } catch (err) {
      console.error('[address-screen:persist]', (err as Error).message);
    }
  }

  return out;
}
