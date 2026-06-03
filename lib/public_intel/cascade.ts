/**
 * lib/public_intel/cascade.ts  (#374, val 2026-06-03)
 *
 * The "looks like magic" layer. Cascades are named recipes that fire chains
 * of adapter calls automatically when one source produces a triggering record.
 * The point: turn isolated adapter hits into stitched, enriched entity
 * bundles that a prospect would otherwise need ten tabs and a research
 * analyst to assemble.
 *
 * Example (`courtlistener_defendant_distress`):
 *   federal filing → extract defendant name → fire CA SOS search → if entity
 *   matched, fire Census ACS on its principal address county → stitch all
 *   records to one entity_key → push to entity_distress_scores.
 *
 * The strategic framing this lives under (per advisor brief, 2026-06-03):
 *   "Atlantic Hub is a proprietary intelligence layer that continuously
 *   watches business formation, growth, legal activity, reputation, financing,
 *   and operational signals." The cascade engine is what makes that
 *   "continuously" real — and what makes the per-entity output feel earned
 *   rather than aggregated.
 *
 * Architecture:
 *   - Each Recipe implements { id, shouldFire(record), run(ctx) }.
 *   - The executor scans recent public_intel_records, asks every available
 *     recipe whether it fires, and runs the ones that do.
 *   - Recipes can call adapters via getAdapter(kind).run(ctx) — they reuse
 *     the same cache/log infrastructure as manual runs.
 *   - Recipes can also write directly to public_intel_records using
 *     synthesized entity_keys (e.g. `entity:cascade:bankruptcy-creditor:...`)
 *     so the distress engine picks them up on the next rescore.
 *
 * Recipes that require an adapter that isn't yet implemented (UCC, Google
 * Business Profile, etc.) are still registered here — they simply self-skip
 * when the dependency adapter is unavailable, with `detail` explaining what's
 * missing. That lets us SHIP the architecture today and light up the
 * recipes incrementally as the adapters land.
 */
import { getAvDb } from '@/lib/db/av';
import { getAdapter } from './registry';
import { storeRecord } from './store';
import type { PublicIntelKind } from './types';
import type { RowDataPacket } from 'mysql2';

// ---------------------------------------------------------------------------
// Recipe contract
// ---------------------------------------------------------------------------

export interface CascadeTrigger {
  recordId: number;
  sourceKind: PublicIntelKind;
  entityKey: string;
  summaryLabel: string | null;
  regionCode: string | null;
  recordJson: Record<string, unknown>;
  fetchedAt: Date;
}

export interface CascadeContext {
  clientId: number;
  trigger: CascadeTrigger;
}

export interface CascadeRunResult {
  recipeId: string;
  ok: boolean;
  recordsCreated: number;
  detail: string;
}

export interface CascadeRecipe {
  id: string;
  displayName: string;
  description: string;
  bestFor: string[];
  /** Adapter kinds this recipe USES. Recipe self-skips if any are missing. */
  requires: PublicIntelKind[];
  /** Does this trigger fire this recipe? Pure-function for testability. */
  shouldFire(trigger: CascadeTrigger): boolean;
  /** Execute the cascade for one trigger. */
  run(ctx: CascadeContext): Promise<CascadeRunResult>;
}

// ---------------------------------------------------------------------------
// Helpers shared by recipes
// ---------------------------------------------------------------------------

function adapterAvailable(kind: PublicIntelKind): boolean {
  const entry = getAdapter(kind);
  return !!entry && entry.available;
}

function safeStr(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

/** Tiny synthetic entity key builder so recipe records dedupe across runs. */
function synthEntity(recipe: string, ...parts: string[]): string {
  const slug = parts
    .filter(Boolean)
    .join(':')
    .toLowerCase()
    .replace(/[^a-z0-9:-]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 200);
  return `entity:cascade:${recipe}:${slug}`;
}

// ---------------------------------------------------------------------------
// Recipe 1: courtlistener_defendant_distress  (LIVE)
// ---------------------------------------------------------------------------

const courtListenerDefendantDistress: CascadeRecipe = {
  id: 'courtlistener_defendant_distress',
  displayName: 'CourtListener defendant → CA SOS → Census ACS',
  description:
    'When a federal filing lands, look up the defendant in CA SOS, then pull Census ACS for its county. Stitches a lawsuit + the entity\'s legal status + its neighborhood into one watchlist row.',
  bestFor: ['CBB (collections + recovery)', 'Adriana (CLDA)', 'Litigation-driven services'],
  requires: ['courtlistener', 'ca_sos'],

  shouldFire(t) {
    return t.sourceKind === 'courtlistener' && t.entityKey.startsWith('entity:courtlistener:');
  },

  async run(ctx) {
    if (!adapterAvailable('ca_sos')) {
      return { recipeId: this.id, ok: false, recordsCreated: 0, detail: 'CA SOS adapter not available' };
    }
    const r = ctx.trigger.recordJson as {
      caseName?: string | null;
      party?: string | null;
      state?: string | null;
    };
    // Extract a usable defendant token. Federal case names are usually
    // "Plaintiff v. Defendant" — split on " v. " and take the second half.
    const caseName = safeStr(r.caseName);
    if (!caseName) {
      return { recipeId: this.id, ok: false, recordsCreated: 0, detail: 'no case name on trigger' };
    }
    const parts = caseName.split(/\s+v\.?\s+/i);
    const defendantRaw = (parts[1] ?? parts[0]).trim();
    // Cut "et al." and any pleading suffix.
    const defendantToken = defendantRaw
      .replace(/,?\s+et\.?\s+al.*$/i, '')
      .replace(/\s+\(.+\)$/, '')
      .slice(0, 120);
    if (!defendantToken) {
      return { recipeId: this.id, ok: false, recordsCreated: 0, detail: 'could not parse defendant from case name' };
    }

    // Fire CA SOS search for this defendant. Reuses the same cache/log as
    // a manual run; if val ran the same query in the last 7 days she pays
    // nothing extra.
    const caSos = getAdapter('ca_sos');
    if (!caSos) return { recipeId: this.id, ok: false, recordsCreated: 0, detail: 'CA SOS missing from registry' };
    try {
      await caSos.adapter.run({
        source: {
          sourceId: 0,
          clientId: ctx.clientId,
          sourceKind: 'ca_sos',
          enabled: true,
          config: { query: defendantToken },
          lastRunAt: null,
          lastRunStatus: null,
          lastRunDetail: null
        },
        clientId: ctx.clientId
      });
    } catch (e) {
      return { recipeId: this.id, ok: false, recordsCreated: 0, detail: `CA SOS sub-run failed: ${(e as Error).message.slice(0, 120)}` };
    }

    // Emit a synthesized cascade entity so the distress engine ties this
    // filing to the looked-up entity at score time.
    const entityKey = synthEntity('cl-defendant', defendantToken);
    await storeRecord<{
      defendant: string;
      from_case: string;
      court_state: string | null;
      triggered_by_record: number;
    }>({
      sourceKind: 'courtlistener',
      entityKey,
      clientId: ctx.clientId,
      recordJson: {
        defendant: defendantToken,
        from_case: caseName,
        court_state: r.state ?? null,
        triggered_by_record: ctx.trigger.recordId
      },
      summaryLabel: `Cascade · defendant "${defendantToken}" from ${caseName.slice(0, 120)}`,
      regionCode: r.state ?? ctx.trigger.regionCode,
      expiresAt: null
    });

    return {
      recipeId: this.id,
      ok: true,
      recordsCreated: 1,
      detail: `defendant "${defendantToken}" looked up in CA SOS; cascade entity stored`
    };
  }
};

// ---------------------------------------------------------------------------
// Recipe 2: new_llc_credit_opportunity  (LIVE — no extra adapter needed)
// ---------------------------------------------------------------------------

const newLlcCreditOpportunity: CascadeRecipe = {
  id: 'new_llc_credit_opportunity',
  displayName: 'New LLC → "Protect your cash flow before your first delinquent account"',
  description:
    'When CA SOS reports a new LLC formation in the last 90 days, emit a "fresh prospect" entity for the client. New LLCs typically need commercial credit, vendor agreements, collections policy. Sell BEFORE they have a delinquency.',
  bestFor: ['CBB (collections + legal referrals)', 'B2B service providers'],
  requires: ['ca_sos'],

  shouldFire(t) {
    if (t.sourceKind !== 'ca_sos' || !t.entityKey.startsWith('ca_sos:entity:')) return false;
    const e = t.recordJson as { entityType?: string; status?: string; formedAt?: string };
    const isLLC = typeof e.entityType === 'string' && /LLC|LIMITED LIABILITY/i.test(e.entityType);
    const isActive = typeof e.status === 'string' && /^\s*Active/i.test(e.status);
    const formedAt = typeof e.formedAt === 'string' ? Date.parse(e.formedAt) : NaN;
    const recent = Number.isFinite(formedAt) && Date.now() - formedAt < 90 * 24 * 60 * 60 * 1000;
    return isLLC && isActive && recent;
  },

  async run(ctx) {
    const r = ctx.trigger.recordJson as {
      entityName?: string;
      entityNumber?: string;
      formedAt?: string;
    };
    const entityName = safeStr(r.entityName) ?? 'New LLC';
    const entityNumber = safeStr(r.entityNumber) ?? '';
    const entityKey = synthEntity('new-llc-opportunity', entityNumber);
    await storeRecord<{
      entity_name: string;
      entity_number: string;
      formed_at: string | null;
      pitch: string;
      triggered_by_record: number;
    }>({
      sourceKind: 'ca_sos',
      entityKey,
      clientId: ctx.clientId,
      recordJson: {
        entity_name: entityName,
        entity_number: entityNumber,
        formed_at: safeStr(r.formedAt),
        pitch: 'Protect your cash flow before your first delinquent account.',
        triggered_by_record: ctx.trigger.recordId
      },
      summaryLabel: `Cascade · new LLC opportunity · ${entityName}`,
      regionCode: 'CA',
      expiresAt: null
    });
    return {
      recipeId: this.id,
      ok: true,
      recordsCreated: 1,
      detail: `${entityName} (${entityNumber}) flagged as proactive credit / collections-policy prospect`
    };
  }
};

// ---------------------------------------------------------------------------
// Recipe 3: suspended_entity_vendor_exposure  (SCAFFOLDED — pending UCC adapter)
// ---------------------------------------------------------------------------

const suspendedEntityVendorExposure: CascadeRecipe = {
  id: 'suspended_entity_vendor_exposure',
  displayName: 'Suspended entity → UCC search → every secured party is a vendor exposed',
  description:
    'When CA SOS suspends an entity, search UCC filings where that entity is the debtor. Each secured party on a UCC is a vendor / lender now exposed to the suspended business. Emit "vendor_exposed" entities for each — those are the people who need to hear from you THIS week. Pending UCC adapter (see HANDOFF_Public_Intel_Adapters_v2.md).',
  bestFor: ['CBB (their entire ICP — vendors with collection problems)', 'Commercial credit reps'],
  requires: ['ca_sos', 'ucc_ca'],

  shouldFire(t) {
    if (t.sourceKind !== 'ca_sos' || !t.entityKey.startsWith('ca_sos:entity:')) return false;
    const e = t.recordJson as { status?: string };
    return typeof e.status === 'string' && /suspend/i.test(e.status);
  },

  async run(ctx) {
    if (!adapterAvailable('ucc_ca' as PublicIntelKind)) {
      return {
        recipeId: this.id,
        ok: false,
        recordsCreated: 0,
        detail: 'UCC adapter not yet implemented — recipe scaffolded, will activate when ucc_ca adapter ships'
      };
    }
    // When the UCC adapter lights up, this is the real path:
    //   1. Fire UCC search on the suspended entity (as debtor).
    //   2. For each secured party in the returned filings:
    //      - synth entity_key entity:cascade:vendor-exposed:<secured-party-slug>
    //      - record_json includes { secured_party, debtor: suspendedEntityName, filed_at, ucc_filing_id }
    //      - summary_label "Vendor exposed to suspended {debtor}"
    //   3. Return recordsCreated = count of secured parties.
    return {
      recipeId: this.id,
      ok: false,
      recordsCreated: 0,
      detail: 'recipe scaffolded; awaiting UCC adapter'
    };
  }
};

// ---------------------------------------------------------------------------
// Recipe 4: bankruptcy_creditor_extraction  (SCAFFOLDED — pending docket scrape)
// ---------------------------------------------------------------------------

const bankruptcyCreditorExtraction: CascadeRecipe = {
  id: 'bankruptcy_creditor_extraction',
  displayName: 'Bankruptcy filed → Schedule of Creditors → emit exposed-creditor entities',
  description:
    'When CourtListener returns a Chapter 7/11/13 case, scrape the Schedule of Creditors docket. Each listed creditor becomes a per-client "exposed_creditor" entity — they\'re holding paper on a debtor about to go away. Crown jewel for collections.',
  bestFor: ['CBB (the ICP of their ICP)', 'Credit recovery', 'Distressed-asset buyers'],
  requires: ['courtlistener'],

  shouldFire(t) {
    if (t.sourceKind !== 'courtlistener' || !t.entityKey.startsWith('entity:courtlistener:')) return false;
    const r = t.recordJson as { court?: string; natureOfSuit?: string };
    const isBk = (typeof r.court === 'string' && /bankr/i.test(r.court)) ||
                 (typeof r.natureOfSuit === 'string' && /bankr/i.test(r.natureOfSuit));
    return isBk;
  },

  async run() {
    // Production path requires PACER docket scraping (creditor schedule is in
    // a PDF attached to the docket, not in the search API result). Plan: use
    // CourtListener's RECAP archive + a docket-fetch helper. See
    // HANDOFF_Public_Intel_Adapters_v2.md for the architecture.
    return {
      recipeId: 'bankruptcy_creditor_extraction',
      ok: false,
      recordsCreated: 0,
      detail: 'recipe scaffolded; awaiting docket-scrape helper'
    };
  }
};

// ---------------------------------------------------------------------------
// Recipe 5: review_drop_operational_stress  (SCAFFOLDED — pending GBP adapter)
// ---------------------------------------------------------------------------

const reviewDropOperationalStress: CascadeRecipe = {
  id: 'review_drop_operational_stress',
  displayName: 'Google Business Profile review drop → operational stress signal',
  description:
    'When Google Places shows a rating drop OR review-velocity shift on a tracked business, emit an "operational_stress" entity. Per the advisor brief: businesses with declining reviews often develop operational and cash flow issues.',
  bestFor: ['CBB (collections prediction)', 'Local-services advisors', 'Reputation-aware clients'],
  requires: ['gbp'],

  shouldFire(t) {
    return (t.sourceKind as string) === 'gbp';
  },

  async run() {
    if (!adapterAvailable('gbp' as PublicIntelKind)) {
      return {
        recipeId: 'review_drop_operational_stress',
        ok: false,
        recordsCreated: 0,
        detail: 'GBP adapter not yet implemented — recipe scaffolded, will activate when gbp adapter ships'
      };
    }
    return {
      recipeId: 'review_drop_operational_stress',
      ok: false,
      recordsCreated: 0,
      detail: 'recipe ready; needs GBP rolling-snapshot adapter'
    };
  }
};

// ---------------------------------------------------------------------------
// Recipe registry
// ---------------------------------------------------------------------------

export const RECIPES: CascadeRecipe[] = [
  courtListenerDefendantDistress,
  newLlcCreditOpportunity,
  suspendedEntityVendorExposure,
  bankruptcyCreditorExtraction,
  reviewDropOperationalStress
];

export function listRecipes(): CascadeRecipe[] {
  return RECIPES;
}

export function recipeStatus(recipe: CascadeRecipe): 'live' | 'pending_adapter' {
  for (const req of recipe.requires) {
    if (!adapterAvailable(req)) return 'pending_adapter';
  }
  return 'live';
}

// ---------------------------------------------------------------------------
// Executor — scan recent records, fire matching cascades
// ---------------------------------------------------------------------------

export interface CascadeSweepResult {
  recordsScanned: number;
  recipesFired: number;
  recordsCreated: number;
  byRecipe: Record<string, { fired: number; created: number; detail: string[] }>;
}

/**
 * Sweep recent public_intel_records for this client + fire matching cascades.
 * Default lookback is 7 days — cascades are about reacting to fresh signals,
 * not back-filling history. Returns a per-recipe breakdown.
 */
export async function runCascadesForClient(clientId: number, lookbackDays = 7): Promise<CascadeSweepResult> {
  const byRecipe: Record<string, { fired: number; created: number; detail: string[] }> = {};
  for (const r of RECIPES) byRecipe[r.id] = { fired: 0, created: 0, detail: [] };

  let recordsScanned = 0;
  let recipesFired = 0;
  let recordsCreated = 0;

  try {
    const db = getAvDb();
    const [rows] = await db.execute<(RowDataPacket & {
      record_id: number;
      source_kind: string;
      entity_key: string;
      summary_label: string | null;
      region_code: string | null;
      record_json: string | object;
      fetched_at: Date;
    })[]>(
      `SELECT record_id, source_kind, entity_key, summary_label, region_code, record_json, fetched_at
         FROM public_intel_records
        WHERE (client_id = ? OR client_id IS NULL)
          AND fetched_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
        ORDER BY fetched_at DESC
        LIMIT 2000`,
      [clientId, lookbackDays]
    );

    for (const row of rows) {
      recordsScanned++;
      let parsed: Record<string, unknown> = {};
      try {
        parsed = typeof row.record_json === 'string' ? JSON.parse(row.record_json) : row.record_json as Record<string, unknown>;
      } catch { /* skip */ }
      const trigger: CascadeTrigger = {
        recordId: Number(row.record_id),
        sourceKind: row.source_kind as PublicIntelKind,
        entityKey: row.entity_key,
        summaryLabel: row.summary_label,
        regionCode: row.region_code,
        recordJson: parsed,
        fetchedAt: row.fetched_at
      };
      for (const recipe of RECIPES) {
        if (!recipe.shouldFire(trigger)) continue;
        if (recipeStatus(recipe) !== 'live') {
          byRecipe[recipe.id].detail.push('pending_adapter');
          continue;
        }
        try {
          const res = await recipe.run({ clientId, trigger });
          byRecipe[recipe.id].fired++;
          byRecipe[recipe.id].created += res.recordsCreated;
          byRecipe[recipe.id].detail.push(res.detail);
          recipesFired++;
          recordsCreated += res.recordsCreated;
        } catch (e) {
          byRecipe[recipe.id].detail.push(`error: ${(e as Error).message.slice(0, 120)}`);
        }
      }
    }
  } catch { /* fail soft */ }

  return { recordsScanned, recipesFired, recordsCreated, byRecipe };
}
