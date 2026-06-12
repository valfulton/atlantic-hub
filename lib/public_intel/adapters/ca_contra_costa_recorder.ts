/**
 * lib/public_intel/adapters/ca_contra_costa_recorder.ts  (val 2026-06-11)
 *
 * Contra Costa County (CA) Clerk-Recorder — official records adapter.
 * Anchor use: 1657 Kingsly Drive, Pittsburg CA 94565 (Johnson family case).
 * Reusable for any family_legacy_care or real_estate client with a Contra
 * Costa property.
 *
 * STATUS: scaffold registered, live scrape pending. The adapter exposes the
 * correct PublicIntelAdapter contract so the operator picker UI shows it
 * alongside md_land_rec / courtlistener / etc., but run() currently returns
 * a "not yet implemented" RunResult rather than fake data. Phase 3 work:
 * implement the actual Browserless fetch against the Contra Costa CRIIS
 * portal (https://crciis.cccounty.us/recorderonline/) and parse the result
 * table the same way md_land_rec does for mdlandrec.net.
 *
 * Distress signals to surface (ordered by relevance for elder advocacy +
 * mortgage broker use cases):
 *   - Notice of Default (NOD) — foreclosure pipeline start
 *   - Notice of Sale (NTS) — auction imminent
 *   - Trustee's Deed Upon Sale — auction completed
 *   - Lis Pendens — litigation against property
 *   - Substitution of Trustee — common pre-foreclosure step
 *   - Reconveyance — loan paid off (refi opportunity for lenders)
 *   - Deed (Grant, Quitclaim, Trustee-to-Beneficiary) — title transfer
 *   - Mortgage / Deed of Trust — new loan placed
 *
 * Why this matters for the Johnson family case specifically: every recorded
 * instrument on 1657 Kingsly Drive surfaces here. If Cecilia tries to record
 * a sale or encumbrance, this adapter catches it within one cron cycle and
 * the family wellness panel surfaces the alert. That's the visibility-gap
 * rule applied to elder-advocacy.
 */
import type { PublicIntelAdapter, RunContext, RunResult } from '../types';

const ADAPTER_KIND = 'ca_contra_costa_recorder' as const;
const PORTAL_URL = 'https://crciis.cccounty.us/recorderonline/';

/** Document types worth tracking for distress + transfer signals. */
const TRACKED_DOC_TYPES = [
  'Notice of Default',
  'Notice of Sale',
  'Trustee Deed Upon Sale',
  'Lis Pendens',
  'Substitution of Trustee',
  'Reconveyance',
  'Grant Deed',
  'Quitclaim Deed',
  'Deed of Trust',
  'Mortgage',
  'Affidavit of Death',
  'Power of Attorney',
  'Revocable Living Trust Transfer'
];

interface ContraCostaConfig {
  /** Search by property address. e.g. "1657 KINGSLY DR" */
  propertyAddress?: string;
  /** Search by party / grantor / grantee name. e.g. "JOHNSON GORDON" */
  partyName?: string;
  /** Assessor parcel number. */
  apn?: string;
  /** Document types to fetch. Defaults to TRACKED_DOC_TYPES if omitted. */
  docTypes?: string[];
  /** Lookback window in days. Default 90. */
  sinceDays?: number;
}

export const caContraCostaRecorderAdapter: PublicIntelAdapter = {
  kind: ADAPTER_KIND,
  displayName: 'Contra Costa County (CA) Clerk-Recorder',
  description:
    'Property deed transfers, lien filings, foreclosure notices, and trust-related recordings for Contra Costa County, California. Day-one anchor for the Johnson family case; reusable for any family_legacy_care or real_estate client with property in Contra Costa.',
  requiresKey: false,
  costNote: 'Free · Contra Costa CRIIS public portal scrape (rate-limited)',
  bestFor: [
    'Family Legacy Care clients with a parent residence in Contra Costa County',
    'Real estate clients monitoring distressed property in Contra Costa',
    'Elder advocacy cases needing recorder-level visibility on a tracked residence'
  ],
  validateConfig(config: Record<string, unknown> | null): string | null {
    // Phase 2 scaffold accepts any config; Phase 3 will enforce at least one of
    // propertyAddress / partyName / apn before allowing a run.
    if (!config) return null;
    return null;
  },
  async run(_ctx: RunContext): Promise<RunResult> {
    // Phase 3 implementation. The scaffold returns a clear "not implemented"
    // result rather than fake data — per visibility-gap, val should know
    // when an adapter is registered but not yet wired to a live source.
    return {
      ok: true,
      written: 0,
      fromCache: 0,
      detail:
        'Contra Costa Recorder adapter registered (Phase 2 scaffold). Live Browserless scrape against crciis.cccounty.us pending (Phase 3). Until then, populate case_property.current_titled_owner + known_liens manually via the operator case dashboard or via SQL.'
    };
  }
};


// ── Phase 3 implementation notes (for whoever picks this up) ──────────────
//
// 1. Browserless flow (similar to forsyth_qpublic.ts pattern):
//    - POST to /recorderonline/ search form
//    - Set search type: Address | Name | APN
//    - Set date range based on sinceDays
//    - Set document types
//    - Submit form → get results page
//    - Parse the result table (use regex or cheerio if added to deps)
//    - Each row → { docType, recordedDate, parties, instrumentNumber, book, page, detailUrl }
// 2. Output: storeRecord() with kind='ca_contra_costa_recorder'. Classifier
//    in distress_engine.ts already handles 'property_transfer', 'lien_filing'
//    signals — those will fire automatically from the docType.
// 3. Auto-property-sync: when a record fires on a tracked case_property
//    address, call upsertProperty() in lib/case/case_store to refresh
//    current_titled_owner + known_liens. This is the "visibility-gap closes
//    within a week" loop val ratified in feedback_visibility_gap.
//
// PORTAL: ${PORTAL_URL}
// SAMPLE TRACKED ADDRESS: 1657 KINGSLY DR, PITTSBURG, CA 94565 (Johnson case)
