/**
 * lib/public_intel/attribution.ts  (#375, val 2026-06-03)
 *
 * The "show your work" layer. For any entity on a client's distress
 * watchlist OR any lead matching a public-data record, fetch the cascade
 * trail that produced it — recipe id, trigger source record, signal kind,
 * timestamps — and format it for surfacing in:
 *
 *   1. The DistressWatchlistPanel ("Why is this entity hot?" expander)
 *   2. The outreach_drafter prompt (so emails literally reference the
 *      cascade signal: "I noticed Acme just had a federal filing land...")
 *   3. The lead_audit prompt (call scripts get the same treatment)
 *   4. (Future) The Weekly Learned Digest (closes the visibility-gap rule
 *      for Driver 8 / cascade pipeline output)
 *
 * The strategic point: without this layer, the cascade engine is invisible
 * magic. With it, every sales artifact carries the receipt — the moat is
 * literally rendered into the email body. That's how a $499/mo Revenue
 * Distress Monitoring stream becomes obviously different from a $99/mo
 * lead list.
 *
 * Pure-function reads (no LLM cost, no mutations). Soft-fails to null on
 * any error so callers can drop attribution gracefully.
 */
import { getAvDb } from '@/lib/db/av';
import type { RowDataPacket } from 'mysql2';

export interface AttributionStep {
  /** The cascade recipe id that emitted this step (when applicable). */
  recipeId: string | null;
  /** The source kind of the originating record. */
  sourceKind: string;
  /** Short human-readable summary of the trigger ("Federal filing in CA bankr"). */
  triggerSummary: string;
  /** When the trigger landed. */
  triggerFetchedAt: Date;
  /** The entity_key on the originating record (so we can join back). */
  triggerEntityKey: string | null;
}

export interface EntityAttribution {
  /** The entity this attribution describes. */
  entityKey: string;
  entityLabel: string | null;
  regionCode: string | null;
  /** The ordered cascade trail. Earliest trigger first. */
  trail: AttributionStep[];
  /** A pre-formatted sentence for LLM prompt injection. */
  promptLine: string;
  /** A pre-formatted human sentence for UI rendering. */
  humanLine: string;
}

// Map recipe id → human-readable trigger description for prompts.
const RECIPE_PROMPT: Record<string, string> = {
  courtlistener_defendant_distress: 'a federal court filing where this prospect appears as defendant',
  new_llc_credit_opportunity: 'a brand-new CA LLC formation in the last 90 days (prime moment to land vendor agreements and a collections policy BEFORE the first delinquent account)',
  suspended_entity_vendor_exposure: 'a CA Secretary of State suspension on a debtor this prospect has a UCC filing against',
  bankruptcy_creditor_extraction: 'a Chapter 7/11/13 bankruptcy filing where this prospect appears in the schedule of creditors',
  review_drop_operational_stress: 'a Google Business Profile rating drop and review-velocity shift suggesting operational stress'
};
const RECIPE_HUMAN: Record<string, string> = {
  courtlistener_defendant_distress: 'Federal filing → CA SOS defendant lookup → Census tract overlay',
  new_llc_credit_opportunity: 'New CA LLC (last 90d) — fresh prospect for proactive credit / collections-policy pitch',
  suspended_entity_vendor_exposure: 'CA SOS suspension → UCC search → vendor exposed to a failing debtor',
  bankruptcy_creditor_extraction: 'Bankruptcy filing → Schedule of Creditors → exposed creditor',
  review_drop_operational_stress: 'Google reviews dropped + review velocity shifted → likely operational/cash-flow stress'
};

interface RecordRow extends RowDataPacket {
  record_id: number;
  source_kind: string;
  entity_key: string;
  summary_label: string | null;
  region_code: string | null;
  record_json: string | object;
  fetched_at: Date;
}

function parseJson(v: string | object | null): Record<string, unknown> {
  if (v == null) return {};
  if (typeof v === 'object') return v as Record<string, unknown>;
  try { return JSON.parse(v) as Record<string, unknown>; } catch { return {}; }
}

/**
 * Walk the cascade chain for one entity, return the formatted attribution.
 * Returns null if no cascade-emitted record exists for this entity.
 *
 * Lookup strategy:
 *   1. Find any record with entity_key === entityKey for this client.
 *   2. If that record has a `triggered_by_record` field in record_json, walk
 *      back to the triggering record — that's the SOURCE of the cascade.
 *   3. Detect the recipe by entity_key prefix (`entity:cascade:<recipe>:...`).
 */
export async function entityAttribution(clientId: number, entityKey: string): Promise<EntityAttribution | null> {
  try {
    const db = getAvDb();
    const [own] = await db.execute<RecordRow[]>(
      `SELECT record_id, source_kind, entity_key, summary_label, region_code, record_json, fetched_at
         FROM public_intel_records
        WHERE entity_key = ? AND (client_id = ? OR client_id IS NULL)
        ORDER BY fetched_at DESC
        LIMIT 1`,
      [entityKey, clientId]
    );
    const self = own[0];
    if (!self) return null;

    // Parse the recipe from the cascade entity_key prefix.
    const m = self.entity_key.match(/^entity:cascade:([a-z0-9_-]+):/);
    const recipeId = m ? m[1].replace(/-/g, '_') : null;

    // Walk back to the trigger record (if any).
    const selfJson = parseJson(self.record_json);
    const triggeredByRecord = typeof selfJson.triggered_by_record === 'number' ? selfJson.triggered_by_record : null;
    let triggerRow: RecordRow | null = null;
    if (triggeredByRecord) {
      const [trigRows] = await db.execute<RecordRow[]>(
        `SELECT record_id, source_kind, entity_key, summary_label, region_code, record_json, fetched_at
           FROM public_intel_records
          WHERE record_id = ?
          LIMIT 1`,
        [triggeredByRecord]
      );
      triggerRow = trigRows[0] ?? null;
    }

    const triggerSummary = triggerRow?.summary_label ?? self.summary_label ?? self.entity_key;
    const trail: AttributionStep[] = [];
    if (triggerRow) {
      trail.push({
        recipeId: null,
        sourceKind: triggerRow.source_kind,
        triggerSummary,
        triggerFetchedAt: triggerRow.fetched_at,
        triggerEntityKey: triggerRow.entity_key
      });
    }
    trail.push({
      recipeId,
      sourceKind: self.source_kind,
      triggerSummary: self.summary_label ?? self.entity_key,
      triggerFetchedAt: self.fetched_at,
      triggerEntityKey: self.entity_key
    });

    const promptDescription = recipeId && RECIPE_PROMPT[recipeId]
      ? RECIPE_PROMPT[recipeId]
      : `a public-records signal from ${self.source_kind}`;
    const humanDescription = recipeId && RECIPE_HUMAN[recipeId]
      ? RECIPE_HUMAN[recipeId]
      : `Public-records signal · ${self.source_kind}`;

    return {
      entityKey: self.entity_key,
      entityLabel: self.summary_label,
      regionCode: self.region_code,
      trail,
      promptLine: `Surfaced by the Atlantic Hub Revenue Distress Intelligence Engine via ${promptDescription}. Trigger: ${triggerSummary.slice(0, 200)} (${trail[0]?.triggerFetchedAt.toISOString().slice(0, 10) ?? 'recent'}).`,
      humanLine: `${humanDescription} · ${triggerSummary.slice(0, 140)}`
    };
  } catch {
    return null;
  }
}

/**
 * Lookup attribution by company name (loose match). Used by the
 * outreach_drafter + lead_audit prompts — they have a lead's company name,
 * not its cascade entity key, so we have to fuzzy-find.
 *
 * Match strategy: any record with summary_label containing the longest
 * token (>=4 chars) of the company name, for THIS client, preferring
 * cascade-emitted records (entity:cascade:* prefix).
 */
export async function attributionForCompany(clientId: number, companyName: string): Promise<EntityAttribution | null> {
  const tokens = (companyName || '')
    .split(/[\s,.&]+/)
    .filter((t) => t.length >= 4)
    .sort((a, b) => b.length - a.length)
    .slice(0, 2);
  if (tokens.length === 0) return null;
  try {
    const db = getAvDb();
    const orClause = tokens.map(() => `summary_label LIKE ?`).join(' OR ');
    const args = [...tokens.map((t) => `%${t}%`), clientId];
    const [rows] = await db.execute<(RowDataPacket & { entity_key: string })[]>(
      `SELECT entity_key
         FROM public_intel_records
        WHERE (${orClause})
          AND (client_id = ? OR client_id IS NULL)
        ORDER BY
          CASE WHEN entity_key LIKE 'entity:cascade:%' THEN 0 ELSE 1 END,
          fetched_at DESC
        LIMIT 1`,
      args
    );
    const r = rows[0];
    if (!r) return null;
    return entityAttribution(clientId, r.entity_key);
  } catch { return null; }
}
