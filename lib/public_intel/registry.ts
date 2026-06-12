/**
 * lib/public_intel/registry.ts  (#368, val 2026-06-02)
 *
 * Central registry of every PublicIntelAdapter the hub knows about. New
 * adapters register themselves here, then any operator-facing picker
 * (future bundle) iterates this list to render checkboxes + config inputs.
 *
 * Adapters not yet implemented are listed with `available: false` so the
 * UI can hint "Coming soon" rather than silently omit them. This keeps the
 * roadmap visible to val + sales as live product feedback.
 */
import type { PublicIntelAdapter, PublicIntelKind } from './types';
import { hmdaAdapter } from './adapters/hmda';
import { caSosAdapter } from './adapters/ca_sos';
import { cfpbAdapter } from './adapters/cfpb';
import { censusAcsAdapter } from './adapters/census_acs';
import { courtListenerAdapter } from './adapters/courtlistener';
import { uccCaAdapter } from './adapters/ucc_ca';
import { pacerDocketAdapter } from './adapters/pacer_docket';
import { gbpAdapter } from './adapters/gbp';
import { dataSfAdapter } from './adapters/datasf';
import { mdLandRecAdapter } from './adapters/md_land_rec';
// (val 2026-06-11) Johnson family anchor — Contra Costa County CA recorder.
// Scaffold registered; live Browserless scrape lands in Phase 3.
import { caContraCostaRecorderAdapter } from './adapters/ca_contra_costa_recorder';

export interface AdapterEntry {
  adapter: PublicIntelAdapter;
  available: boolean;
}

const PLANNED: Array<{ kind: PublicIntelKind; displayName: string; description: string; bestFor: string[]; costNote: string }> = [
  {
    kind: 'cfpb',
    displayName: 'CFPB consumer complaints',
    description: 'Public database of complaints against financial-services companies, by zip + product. Tells you which lenders are under fire in which markets.',
    bestFor: ['Marty (consumer loans)', 'Compliance-led brands'],
    costNote: 'Free · CFPB Socrata API'
  },
  {
    kind: 'census_acs',
    displayName: 'Census ACS (income / tenure)',
    description: 'Tract-level household income, mortgage burden, housing tenure from the American Community Survey. The denominator under HMDA volume.',
    bestFor: ['Marty', 'Real estate', 'Local services'],
    costNote: 'Free · Census Bureau API (key recommended)'
  },
  {
    kind: 'ca_sos',
    displayName: 'CA Secretary of State (LLC + Corp filings)',
    description: 'LLC / corp formations, registered-agent changes, dissolutions, suspensions. Upstream signal for lien activity + B2B targeting.',
    bestFor: ['Adriana (CLDA)', 'B2B sales'],
    costNote: 'Free · bizfileOnline scrape (rate-limited)'
  },
  // (val 2026-06-12) Removed: generic 'ca_recorder' placeholder. It was rendering
  // a "coming soon" line in the starter-pack activation report ALONGSIDE the real
  // ca_contra_costa_recorder adapter (which IS implemented and IS surfaced via
  // the IMPLEMENTED array). The duplicate confused val: she saw "CA county
  // recorder filings · coming soon" and assumed Contra Costa wasn't built. The
  // real adapter's displayName is 'Contra Costa County (CA) Clerk-Recorder' so
  // it's clearly named. As we add more county adapters they get registered the
  // same way (one entry per county adapter, no generic placeholder).
  {
    kind: 'datasf',
    displayName: 'DataSF (San Francisco Open Data)',
    description: 'Business registrations, building permits, code complaints — one of the strongest open-data portals in the US.',
    bestFor: ['SF Bay Area clients'],
    costNote: 'Free · Socrata API'
  },
  {
    kind: 'la_assessor',
    displayName: 'LA County Assessor (parcels)',
    description: 'Parcel-level assessor data for LA County — valuation, ownership, classification.',
    bestFor: ['Adriana (CLDA)', 'Real estate'],
    costNote: 'Free · Socrata API'
  },
  // (#374) Planned adapters referenced by Cascade Pipeline recipes.
  {
    kind: 'ucc_ca',
    displayName: 'CA UCC financing statements',
    description: 'Search UCC-1 / UCC-3 filings by debtor name. Each filing names a secured party (the vendor/lender). Lights up the "Suspended entity → Vendor exposure" cascade — when a suspended LLC has UCC filings, every secured party becomes an exposed-vendor watchlist entry.',
    bestFor: ['CBB (collections — vendors exposed to suspended debtors)', 'Equipment finance', 'B2B credit'],
    costNote: 'Free · CA SOS UCC search portal (separate endpoint from bizfileOnline)'
  },
  {
    kind: 'gbp',
    displayName: 'Google Business Profile (review trend)',
    description: 'Rolling snapshots of rating + review velocity per business. Drops + sudden volume shifts emit "operational_stress" signals via the cascade engine. Per advisor brief: review trends often precede cash-flow problems by 30-60 days.',
    bestFor: ['CBB (early-warning collections)', 'Local-services advisors'],
    costNote: 'Uses existing Google Places API allotment · low marginal cost · scheduled per tracked entity'
  },
  {
    kind: 'ca_sos_v2',
    displayName: 'CA SOS v2 (filing history + officers + agent changes)',
    description: 'Pulls the SI-200/SI-550 statement-of-information stream beyond the search results bizfileOnline exposes today. Detects leadership changes, address changes, late filings — high-value distress signals invisible to the v1 adapter.',
    bestFor: ['CBB', 'Adriana (CLDA)', 'B2B sales targeting officer changes'],
    costNote: 'Free · bizfileOnline filing detail page (requires per-entity fetch + parse)'
  },
  {
    kind: 'pacer_docket',
    displayName: 'PACER docket fetcher (bankruptcy creditor schedules)',
    description: 'For CourtListener bankruptcy hits, fetch the full docket and parse the Schedule of Creditors (Form 106). Lights up the bankruptcy_creditor_extraction cascade — each scheduled creditor becomes an exposed-creditor watchlist entry. Crown jewel for collections.',
    bestFor: ['CBB (the ICP of their ICP)', 'Distressed-debt buyers', 'Credit recovery'],
    costNote: 'Free via CourtListener RECAP archive when filings are already in archive · PACER per-page fees only if fetched live'
  }
];

const IMPLEMENTED: PublicIntelAdapter[] = [
  hmdaAdapter,
  caSosAdapter,
  cfpbAdapter,
  censusAcsAdapter,
  courtListenerAdapter,
  uccCaAdapter,
  pacerDocketAdapter,
  gbpAdapter,
  dataSfAdapter,
  // (#423) First adapter in the multi-state RE foreclosure rollout.
  mdLandRecAdapter,
  // (val 2026-06-11) Anchor adapter for the Johnson family case. Scaffold today,
  // live scrape Phase 3 (see lib/public_intel/adapters/ca_contra_costa_recorder.ts).
  caContraCostaRecorderAdapter
];

const REGISTRY: Map<PublicIntelKind, AdapterEntry> = new Map();

// Seed implemented adapters first so they win over planned stubs.
for (const a of IMPLEMENTED) {
  REGISTRY.set(a.kind, { adapter: a, available: true });
}
// Then add planned stubs for kinds not yet implemented.
for (const p of PLANNED) {
  if (REGISTRY.has(p.kind)) continue;
  const stub: PublicIntelAdapter = {
    kind: p.kind,
    displayName: p.displayName,
    description: p.description,
    requiresKey: false,
    costNote: p.costNote,
    bestFor: p.bestFor,
    validateConfig: () => null,
    async run() {
      return { ok: false, written: 0, fromCache: 0, detail: 'adapter not yet implemented' };
    }
  };
  REGISTRY.set(p.kind, { adapter: stub, available: false });
}

export function getAdapter(kind: PublicIntelKind): AdapterEntry | undefined {
  return REGISTRY.get(kind);
}

export function listAdapters(): AdapterEntry[] {
  return Array.from(REGISTRY.values()).sort((a, b) => {
    // Available adapters first, then alphabetical by display name.
    if (a.available !== b.available) return a.available ? -1 : 1;
    return a.adapter.displayName.localeCompare(b.adapter.displayName);
  });
}
