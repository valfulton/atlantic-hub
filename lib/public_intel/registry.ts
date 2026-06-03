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
  {
    kind: 'ca_recorder',
    displayName: 'CA county recorder filings',
    description: 'Per-county recorder filings: deeds, liens, releases. No federal API — adapters scrape per-county portals (LA, SF, San Diego, OC, Sacramento).',
    bestFor: ['Adriana (CLDA)'],
    costNote: 'Free per-county scrape · varies by county'
  },
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
  }
];

const IMPLEMENTED: PublicIntelAdapter[] = [hmdaAdapter, caSosAdapter];

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
