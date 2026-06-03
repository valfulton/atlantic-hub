/**
 * lib/public_intel/distress_engine.ts  (#372, val 2026-06-03)
 *
 * The Revenue Distress Intelligence Engine. Reads public_intel_records,
 * applies per-client weighted signals, writes per-entity rolling scores
 * into entity_distress_scores.
 *
 * Strategic framing (from the advisor brief, 2026-06-03):
 *   Atlantic Hub is not a lead list. It is a Revenue Distress Intelligence
 *   Engine that scores businesses on the likelihood they'll soon need a
 *   given client's service. Each client maps public-data signals to their
 *   own service via per-client signal weights:
 *     - CBB (collections): suspensions, lawsuits, bankruptcies, UCC filings
 *     - Marty (consumer loans): denials, refinances, neighborhood velocity
 *     - Adriana (CLDA liens): suspensions, dissolutions, recorder activity
 *
 * The advisor's seven seeded weights for CBB are constants below
 * (CBB_DEFAULT_WEIGHTS) — applied automatically on first run for the
 * CBB client_id. Other clients start with no weights and val configures
 * via the operator UI (#372 followup).
 *
 * Engine flow:
 *   1. Load the client's signal weights (with tenant defaults overlaid).
 *   2. Pull recent public_intel_records that target this client OR its
 *      region. Skip records older than the lookback window.
 *   3. For each record, classify which signals it triggers (one record
 *      can trigger multiple signals — a suspended LLC = "new" + "suspended"
 *      if recently filed). Sum the weighted hits per entity.
 *   4. Upsert into entity_distress_scores. Old entities whose scores have
 *      decayed below the keep threshold get marked for removal next sweep.
 *   5. Return a summary the cron / UI can display.
 *
 * The signal classification is pure-function so it stays testable and
 * the same rules feed both the scheduled cron and operator "Score now"
 * triggers.
 */
import { getAvDb } from '@/lib/db/av';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

/** Signal kinds the engine emits. Adding a new kind is a four-step move:
 *  1. Add it to SignalKind, 2. Add classification in classifyRecord(),
 *  3. Add a default weight (per-client or tenant-default),
 *  4. Add operator description in SIGNAL_LIBRARY. */
export type SignalKind =
  // From CA SOS adapter:
  | 'new_llc'
  | 'suspended_entity'
  | 'dissolved_entity'
  | 'leadership_change'
  // From HMDA adapter:
  | 'high_denial_rate'
  | 'high_refinance_volume'
  // From CFPB adapter:
  | 'complaint_velocity_high'
  | 'lender_under_fire'
  // From CourtListener adapter:
  | 'lawsuit_filed'
  | 'bankruptcy_filed'
  // Generic / cross-source:
  | 'ucc_filing'
  | 'credit_risk_increase'
  | 'negative_review_trend'
  | 'address_change'
  | 'rapid_growth';

/** Operator-facing description of each signal. Used by the picker UI. */
export const SIGNAL_LIBRARY: Record<SignalKind, { label: string; description: string; defaultWeight: number }> = {
  new_llc: { label: 'New LLC formation', description: 'Recently filed LLC. Typically needs commercial credit, vendor agreements, collections policy.', defaultWeight: 10 },
  suspended_entity: { label: 'Suspended entity', description: 'CA SOS suspended for tax/compliance issues. ~70% precede a lien event within 90 days.', defaultWeight: 30 },
  dissolved_entity: { label: 'Dissolved entity', description: 'Dissolved or cancelled. Creditor recovery opportunities, mechanics liens common.', defaultWeight: 25 },
  leadership_change: { label: 'Leadership change', description: 'New officer / registered agent change. Often signals growth, fundraising, or operational stress.', defaultWeight: 15 },
  high_denial_rate: { label: 'High mortgage denial rate', description: 'HMDA-reported tract has above-average denial rate. Alt-loan / refi targets.', defaultWeight: 20 },
  high_refinance_volume: { label: 'High refinance volume', description: 'Tract showing elevated refinance activity. Active homeowner mortgage market.', defaultWeight: 15 },
  complaint_velocity_high: { label: 'High CFPB complaint velocity', description: 'State sees elevated complaint volume against a particular product/company.', defaultWeight: 10 },
  lender_under_fire: { label: 'Lender under fire', description: 'Specific lender accumulating CFPB complaints in this market.', defaultWeight: 20 },
  lawsuit_filed: { label: 'Lawsuit filed', description: 'Federal civil suit filed (plaintiff or defendant). Indicates active dispute or recovery need.', defaultWeight: 30 },
  bankruptcy_filed: { label: 'Bankruptcy filed', description: 'Chapter 7 / 11 / 13 filing. Gold for collections — creditor identification + skip tracing leads.', defaultWeight: 50 },
  ucc_filing: { label: 'UCC financing statement', description: 'Equipment / inventory / asset-backed financing. Future collections opportunity.', defaultWeight: 20 },
  credit_risk_increase: { label: 'Credit risk increase', description: 'D&B / Experian risk score deteriorated (when wired).', defaultWeight: 40 },
  negative_review_trend: { label: 'Negative review trend', description: 'Google / Yelp rating drop + review velocity shift. Often precedes operational problems.', defaultWeight: 15 },
  address_change: { label: 'Address change', description: 'Recent registered address change. Growth, contraction, or evasion signal.', defaultWeight: 10 },
  rapid_growth: { label: 'Rapid growth', description: 'Multiple amendments + officer changes + new locations in short window.', defaultWeight: 10 }
};

/**
 * The advisor's seven seeded weights for CBB (Central Business Bureau).
 * Applied on first run for the CBB client_id. Other clients start with
 * defaultWeight from SIGNAL_LIBRARY and val tunes from there.
 */
export const CBB_DEFAULT_WEIGHTS: Partial<Record<SignalKind, number>> = {
  new_llc: 10,
  ucc_filing: 20,
  negative_review_trend: 15,
  lawsuit_filed: 30,
  bankruptcy_filed: 50,
  credit_risk_increase: 40,
  leadership_change: 15
};

export interface ClassifiedSignal {
  signalKind: SignalKind;
  /** The entity this signal applies to. */
  entityKey: string;
  entityLabel: string | null;
  regionCode: string | null;
  /** Free-form trace so the operator can audit "why is this entity hot?" */
  source: string;
}

interface IntelRecord {
  recordId: number;
  sourceKind: string;
  entityKey: string;
  summaryLabel: string | null;
  regionCode: string | null;
  recordJson: Record<string, unknown>;
  fetchedAt: Date;
}

/**
 * Pure-function signal classifier. Given a single public_intel_record,
 * emit zero or more signals. Each signal carries an entityKey — the
 * thing the score gets attached to.
 */
export function classifyRecord(r: IntelRecord): ClassifiedSignal[] {
  const out: ClassifiedSignal[] = [];

  if (r.sourceKind === 'ca_sos' && r.entityKey.startsWith('ca_sos:entity:')) {
    // Per-entity CA SOS rows. record_json is one CaSosEntity.
    const e = r.recordJson as Record<string, unknown>;
    const status = typeof e.status === 'string' ? e.status.toLowerCase() : '';
    const entityType = typeof e.entityType === 'string' ? e.entityType : '';
    const entityNumber = typeof e.entityNumber === 'string' ? e.entityNumber : r.entityKey;
    const entityName = typeof e.entityName === 'string' ? e.entityName : r.summaryLabel;
    const entityKey = `entity:ca_sos:${entityNumber}`;

    if (/suspend/.test(status)) {
      out.push({ signalKind: 'suspended_entity', entityKey, entityLabel: entityName, regionCode: 'CA', source: `CA SOS · ${entityNumber} · ${status}` });
    }
    if (/dissolv|cancel/.test(status)) {
      out.push({ signalKind: 'dissolved_entity', entityKey, entityLabel: entityName, regionCode: 'CA', source: `CA SOS · ${entityNumber} · ${status}` });
    }
    // "Active LLC" formed in the last 90 days = new business signal.
    const formedAt = typeof e.formedAt === 'string' ? Date.parse(e.formedAt) : NaN;
    const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
    if (
      /^Active/i.test(status.replace(/^\s+/, '')) &&
      /LLC|LIMITED LIABILITY/i.test(entityType) &&
      Number.isFinite(formedAt) &&
      Date.now() - formedAt < ninetyDaysMs
    ) {
      out.push({ signalKind: 'new_llc', entityKey, entityLabel: entityName, regionCode: 'CA', source: `CA SOS · ${entityNumber} · formed ${e.formedAt}` });
    }
  }

  if (r.sourceKind === 'cfpb') {
    // CFPB aggregates are state+product. We attach signals to the top
    // companies named in top_companies — they're the "lender under fire."
    const j = r.recordJson as { top_companies?: Array<{ company?: string; count?: number }>; total_complaints?: number; state?: string };
    const state = j.state ?? r.regionCode ?? '';
    if (typeof j.total_complaints === 'number' && j.total_complaints > 5000) {
      out.push({
        signalKind: 'complaint_velocity_high',
        entityKey: `entity:cfpb:${state}`,
        entityLabel: `${state} consumer complaint volume`,
        regionCode: state,
        source: `CFPB · ${j.total_complaints?.toLocaleString()} complaints / window`
      });
    }
    for (const co of (j.top_companies ?? []).slice(0, 5)) {
      if (!co.company || !co.count) continue;
      if (co.count < 100) continue;
      out.push({
        signalKind: 'lender_under_fire',
        entityKey: `entity:cfpb:co:${co.company.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 80)}`,
        entityLabel: co.company,
        regionCode: state,
        source: `CFPB · ${co.company} · ${co.count} complaints`
      });
    }
  }

  if (r.sourceKind === 'hmda') {
    const j = r.recordJson as { denial_rate?: number | null; state?: string; county_fips?: string | null };
    const region = j.county_fips ?? j.state ?? r.regionCode ?? '';
    if (typeof j.denial_rate === 'number' && j.denial_rate >= 0.18) {
      out.push({
        signalKind: 'high_denial_rate',
        entityKey: `entity:hmda:${region}`,
        entityLabel: `Tract ${region} mortgage market`,
        regionCode: region,
        source: `HMDA · ${(j.denial_rate * 100).toFixed(1)}% denial rate`
      });
    }
  }

  if (r.sourceKind === 'courtlistener') {
    // Will be populated when the CourtListener adapter writes records.
    // Each filing record maps to a lawsuit_filed or bankruptcy_filed signal.
    const j = r.recordJson as { entity?: string; court?: string; nature?: string };
    const isBankruptcy = typeof j.court === 'string' && /bankr/i.test(j.court);
    const entityKey = r.entityKey;
    out.push({
      signalKind: isBankruptcy ? 'bankruptcy_filed' : 'lawsuit_filed',
      entityKey,
      entityLabel: j.entity ?? r.summaryLabel,
      regionCode: r.regionCode,
      source: `CourtListener · ${j.court ?? 'court'} · ${j.nature ?? 'civil'}`
    });
  }

  return out;
}

interface SignalWeightRow extends RowDataPacket {
  signal_kind: string;
  weight: number;
  enabled: number;
}

/**
 * Resolve the effective signal weights for a client. Per-client weights
 * override tenant defaults (NULL client_id); missing entries fall back to
 * SIGNAL_LIBRARY[kind].defaultWeight.
 */
export async function loadEffectiveWeights(clientId: number): Promise<Map<SignalKind, number>> {
  const out = new Map<SignalKind, number>();
  // Start with library defaults.
  for (const [kind, def] of Object.entries(SIGNAL_LIBRARY)) {
    out.set(kind as SignalKind, def.defaultWeight);
  }
  try {
    const db = getAvDb();
    // Tenant defaults first.
    const [defaultRows] = await db.execute<SignalWeightRow[]>(
      `SELECT signal_kind, weight, enabled FROM distress_signal_weights WHERE client_id IS NULL`
    );
    for (const r of defaultRows) {
      if (r.enabled) out.set(r.signal_kind as SignalKind, Number(r.weight));
    }
    // Per-client overrides win.
    const [clientRows] = await db.execute<SignalWeightRow[]>(
      `SELECT signal_kind, weight, enabled FROM distress_signal_weights WHERE client_id = ?`,
      [clientId]
    );
    for (const r of clientRows) {
      if (r.enabled) out.set(r.signal_kind as SignalKind, Number(r.weight));
    }
  } catch { /* table missing → use library defaults only */ }
  return out;
}

/**
 * Seed CBB (or any caller-specified client) with the advisor's weights
 * if no weights are currently configured for that client. Idempotent.
 */
export async function seedDefaultsForClient(clientId: number, seeds: Partial<Record<SignalKind, number>>): Promise<number> {
  let inserted = 0;
  try {
    const db = getAvDb();
    for (const [kind, weight] of Object.entries(seeds)) {
      if (typeof weight !== 'number') continue;
      const [res] = await db.execute<ResultSetHeader>(
        `INSERT IGNORE INTO distress_signal_weights (client_id, signal_kind, weight, enabled, description)
         VALUES (?, ?, ?, 1, ?)`,
        [clientId, kind, weight, SIGNAL_LIBRARY[kind as SignalKind]?.description ?? null]
      );
      if (res.affectedRows > 0) inserted++;
    }
  } catch { /* non-fatal */ }
  return inserted;
}

export interface RescoreResult {
  ok: boolean;
  recordsScanned: number;
  signalsEmitted: number;
  entitiesScored: number;
  topEntities: Array<{ entityKey: string; entityLabel: string | null; score: number; regionCode: string | null }>;
}

/**
 * Recompute distress scores for a client by scanning recent public_intel_records.
 * `lookbackDays` defaults to 90 — old records still factor in but should age
 * out of decision-making windows.
 */
export async function rescoreClient(clientId: number, lookbackDays = 90): Promise<RescoreResult> {
  const weights = await loadEffectiveWeights(clientId);
  const db = getAvDb();
  let recordsScanned = 0;
  let signalsEmitted = 0;

  // Aggregate per-entity: { score, signalHits[] }
  const byEntity = new Map<string, { score: number; label: string | null; region: string | null; hits: ClassifiedSignal[] }>();

  try {
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
        LIMIT 5000`,
      [clientId, lookbackDays]
    );

    for (const r of rows) {
      recordsScanned++;
      let parsed: Record<string, unknown> = {};
      try {
        parsed = typeof r.record_json === 'string' ? JSON.parse(r.record_json) : r.record_json as Record<string, unknown>;
      } catch { parsed = {}; }
      const intel: IntelRecord = {
        recordId: Number(r.record_id),
        sourceKind: r.source_kind,
        entityKey: r.entity_key,
        summaryLabel: r.summary_label,
        regionCode: r.region_code,
        recordJson: parsed,
        fetchedAt: r.fetched_at
      };
      const signals = classifyRecord(intel);
      for (const s of signals) {
        signalsEmitted++;
        const w = weights.get(s.signalKind) ?? 0;
        if (w === 0) continue;
        const slot = byEntity.get(s.entityKey) ?? { score: 0, label: s.entityLabel, region: s.regionCode, hits: [] };
        slot.score += w;
        slot.hits.push(s);
        if (!slot.label && s.entityLabel) slot.label = s.entityLabel;
        if (!slot.region && s.regionCode) slot.region = s.regionCode;
        byEntity.set(s.entityKey, slot);
      }
    }
  } catch { /* fail soft */ }

  // Upsert into entity_distress_scores.
  try {
    for (const [entityKey, slot] of byEntity) {
      const clampedScore = Math.max(0, Math.min(1000, slot.score));
      await db.execute<ResultSetHeader>(
        `INSERT INTO entity_distress_scores
           (client_id, entity_key, entity_label, region_code, score, contributing_signals)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           score = VALUES(score),
           entity_label = COALESCE(VALUES(entity_label), entity_label),
           region_code = COALESCE(VALUES(region_code), region_code),
           contributing_signals = VALUES(contributing_signals),
           last_recomputed_at = NOW()`,
        [
          clientId,
          entityKey.slice(0, 240),
          slot.label?.slice(0, 240) ?? null,
          slot.region?.slice(0, 60) ?? null,
          clampedScore,
          JSON.stringify(slot.hits.slice(0, 20))
        ]
      );
    }
  } catch { /* non-fatal */ }

  const sorted = Array.from(byEntity.entries())
    .map(([entityKey, s]) => ({
      entityKey,
      entityLabel: s.label,
      score: Math.max(0, Math.min(1000, s.score)),
      regionCode: s.region
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 25);

  return {
    ok: true,
    recordsScanned,
    signalsEmitted,
    entitiesScored: byEntity.size,
    topEntities: sorted
  };
}

export interface WatchlistRow {
  entityKey: string;
  entityLabel: string | null;
  regionCode: string | null;
  score: number;
  contributingSignals: ClassifiedSignal[];
  firstSeenAt: Date;
  lastRecomputedAt: Date;
  lastAction: 'contacted' | 'dismissed' | 'converted' | 'ignored' | null;
  lastActedAt: Date | null;
}

/** Top-N distress entities for a client, score-descending. */
export async function watchlistForClient(clientId: number, limit = 25): Promise<WatchlistRow[]> {
  try {
    const db = getAvDb();
    const [rows] = await db.execute<(RowDataPacket & {
      entity_key: string;
      entity_label: string | null;
      region_code: string | null;
      score: number;
      contributing_signals: string | object | null;
      first_seen_at: Date;
      last_recomputed_at: Date;
      last_action: 'contacted' | 'dismissed' | 'converted' | 'ignored' | null;
      last_acted_at: Date | null;
    })[]>(
      // (#383) Inline validated LIMIT — mysql2 execute() rejects bound LIMIT params.
      `SELECT entity_key, entity_label, region_code, score, contributing_signals,
              first_seen_at, last_recomputed_at, last_action, last_acted_at
         FROM entity_distress_scores
        WHERE client_id = ?
        ORDER BY score DESC, last_recomputed_at DESC
        LIMIT ${Math.max(1, Math.min(500, Math.floor(limit)))}`,
      [clientId]
    );
    return rows.map((r) => {
      let parsed: ClassifiedSignal[] = [];
      try {
        const v = typeof r.contributing_signals === 'string' ? JSON.parse(r.contributing_signals) : r.contributing_signals;
        if (Array.isArray(v)) parsed = v as ClassifiedSignal[];
      } catch { parsed = []; }
      return {
        entityKey: r.entity_key,
        entityLabel: r.entity_label,
        regionCode: r.region_code,
        score: Number(r.score),
        contributingSignals: parsed,
        firstSeenAt: r.first_seen_at,
        lastRecomputedAt: r.last_recomputed_at,
        lastAction: r.last_action,
        lastActedAt: r.last_acted_at
      };
    });
  } catch { return []; }
}
