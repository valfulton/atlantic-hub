/**
 * lib/public_intel/dossier.ts  (val 2026-06-07)
 *
 * "What do we actually know about this entity?" — operator-only intel
 * dossier for a single watchlist entity. Returns:
 *
 *   - score + when last recomputed
 *   - every classified signal that contributed
 *   - every raw public_intel_record we have stored about this entity
 *     (full record_json, not a digest — the operator sees what we paid for)
 *   - the promoted lead row (when this entity has been converted into a lead)
 *
 * This is the visibility-gap closer val flagged 2026-06-07:
 *   "I have no idea what info we are pulling in."
 *
 * The data was already in MySQL — public_intel_records.record_json is the
 * full payload. The operator UI just wasn't reading it. This lib + the
 * dossier page + the row-level "View intel →" link close that gap without
 * touching the client-facing view.
 *
 * SCOPING: queries are client-scoped so an operator viewing CBB's watchlist
 * can't accidentally see records belonging to a different client (records
 * inserted with a different client_id, or NULL = system-wide).
 */
import { getAvDb } from '@/lib/db/av';
import { classifyRecord, type ClassifiedSignal, type SignalKind } from '@/lib/public_intel/distress_engine';
import type { RowDataPacket } from 'mysql2';

export interface DossierRecord {
  recordId: number;
  sourceKind: string;
  entityKey: string;
  summaryLabel: string | null;
  regionCode: string | null;
  /** Full raw payload as stored in public_intel_records.record_json.
   *  Already parsed from JSON. The operator sees every field. */
  recordJson: Record<string, unknown>;
  /** Signals this single record produces when run through the classifier —
   *  lets the operator see "this is why this record matters". */
  derivedSignals: ClassifiedSignal[];
  fetchedAt: Date;
  expiresAt: Date | null;
}

export interface DossierScore {
  score: number;
  firstSeenAt: Date;
  lastRecomputedAt: Date;
  contributingSignals: ClassifiedSignal[];
  lastAction: 'contacted' | 'dismissed' | 'converted' | 'ignored' | null;
  lastActedAt: Date | null;
}

export interface DossierLeadLink {
  leadId: number;
  company: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  band: 'hot' | 'warm' | 'cool' | null;
  score: number | null;
  createdAt: Date;
}

export interface Dossier {
  entityKey: string;
  entityLabel: string | null;
  /** Watchlist score row (null = entity isn't on the watchlist for this client).
   *  Can happen when an operator pulls a dossier on an old/dismissed entity. */
  watchlist: DossierScore | null;
  /** Every public_intel_record we hold on this entity, newest first.
   *  Each carries the full record_json so the operator can see what the
   *  adapter actually fetched — no fields dropped. */
  records: DossierRecord[];
  /** Convenience: per-source-kind count. Quick "we have 12 court filings,
   *  4 UCC searches, 2 CFPB complaints" headline. */
  countsBySource: Record<string, number>;
  /** Lead row(s) for this entity if it's been promoted into the pipeline. */
  leads: DossierLeadLink[];
}

interface PublicIntelRow extends RowDataPacket {
  record_id: number;
  source_kind: string;
  entity_key: string;
  summary_label: string | null;
  region_code: string | null;
  record_json: string | object;
  fetched_at: Date;
  expires_at: Date | null;
}

interface ScoreRow extends RowDataPacket {
  entity_label: string | null;
  score: number;
  contributing_signals: string | object | null;
  first_seen_at: Date;
  last_recomputed_at: Date;
  last_action: 'contacted' | 'dismissed' | 'converted' | 'ignored' | null;
  last_acted_at: Date | null;
}

interface LeadRow extends RowDataPacket {
  id: number;
  company: string | null;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  band: 'hot' | 'warm' | 'cool' | null;
  score: number | null;
  created_at: Date;
}

function parseRecordJson(raw: string | object): Record<string, unknown> {
  if (typeof raw === 'object' && raw !== null) return raw as Record<string, unknown>;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return {}; }
  }
  return {};
}

function parseSignals(raw: string | object | null): ClassifiedSignal[] {
  if (!raw) return [];
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(v) ? v as ClassifiedSignal[] : [];
  } catch { return []; }
}

/**
 * Pull the full intel dossier for a single entity inside one client's scope.
 *
 * Match strategy for `public_intel_records`:
 *   1. Exact entity_key match (records the adapter explicitly tagged with
 *      this entity).
 *   2. Records where the entity_label appears anywhere inside record_json
 *      (catches related records — e.g. a UCC filing where the entity is
 *      named as debtor but the row's natural key is the secured party).
 *   3. Scoped to `client_id IN (?, NULL)` so client-private records show up
 *      AND system-wide records (e.g. a CourtListener case ingested before
 *      it was assigned to a specific client) also surface.
 *
 * Returns at most `maxRecords` records (default 100), newest first.
 */
export async function loadDossierForEntity(args: {
  clientId: number;
  entityKey: string;
  /** Optional but recommended — used to JSON-search related records by the
   *  entity's display name, not just its natural key. */
  entityLabel?: string | null;
  maxRecords?: number;
}): Promise<Dossier> {
  const db = getAvDb();
  const maxRecords = Math.max(1, Math.min(500, args.maxRecords ?? 100));

  // ---- 1. Watchlist score row (may not exist for dismissed entities) ----
  let watchlist: DossierScore | null = null;
  let entityLabel: string | null = args.entityLabel ?? null;
  try {
    const [scoreRows] = await db.execute<ScoreRow[]>(
      `SELECT entity_label, score, contributing_signals,
              first_seen_at, last_recomputed_at, last_action, last_acted_at
         FROM entity_distress_scores
        WHERE client_id = ? AND entity_key = ?
        LIMIT 1`,
      [args.clientId, args.entityKey]
    );
    const s = scoreRows[0];
    if (s) {
      entityLabel = entityLabel ?? s.entity_label;
      watchlist = {
        score: Number(s.score),
        firstSeenAt: s.first_seen_at,
        lastRecomputedAt: s.last_recomputed_at,
        contributingSignals: parseSignals(s.contributing_signals),
        lastAction: s.last_action,
        lastActedAt: s.last_acted_at
      };
    }
  } catch {
    // Soft-fail: a missing entity_distress_scores row shouldn't break the dossier.
  }

  // ---- 2. Raw intel records ----
  // Three-part WHERE: exact key match, JSON-search by entity label, client scope.
  let records: DossierRecord[] = [];
  try {
    const labelLike = entityLabel ? `%${entityLabel.toLowerCase()}%` : null;
    const sql = labelLike
      ? `SELECT record_id, source_kind, entity_key, summary_label, region_code,
                record_json, fetched_at, expires_at
           FROM public_intel_records
          WHERE (client_id = ? OR client_id IS NULL)
            AND (
              entity_key = ?
              OR LOWER(CAST(record_json AS CHAR)) LIKE ?
            )
          ORDER BY fetched_at DESC
          LIMIT ${maxRecords}`
      : `SELECT record_id, source_kind, entity_key, summary_label, region_code,
                record_json, fetched_at, expires_at
           FROM public_intel_records
          WHERE (client_id = ? OR client_id IS NULL)
            AND entity_key = ?
          ORDER BY fetched_at DESC
          LIMIT ${maxRecords}`;
    const params = labelLike
      ? [args.clientId, args.entityKey, labelLike]
      : [args.clientId, args.entityKey];

    const [rawRows] = await db.execute<PublicIntelRow[]>(sql, params);

    records = rawRows.map((r) => {
      const parsed = parseRecordJson(r.record_json);
      // Re-classify each record so the operator can see "this record fires
      // these signals" inline — answers "why does this matter?" per row.
      let derivedSignals: ClassifiedSignal[] = [];
      try {
        derivedSignals = classifyRecord({
          recordId: r.record_id,
          sourceKind: r.source_kind,
          entityKey: r.entity_key,
          summaryLabel: r.summary_label,
          regionCode: r.region_code,
          recordJson: parsed,
          fetchedAt: r.fetched_at
        });
      } catch {
        derivedSignals = [];
      }
      return {
        recordId: r.record_id,
        sourceKind: r.source_kind,
        entityKey: r.entity_key,
        summaryLabel: r.summary_label,
        regionCode: r.region_code,
        recordJson: parsed,
        derivedSignals,
        fetchedAt: r.fetched_at,
        expiresAt: r.expires_at
      };
    });
  } catch {
    records = [];
  }

  // ---- 3. Per-source counts (headline strip) ----
  const countsBySource: Record<string, number> = {};
  for (const r of records) {
    countsBySource[r.sourceKind] = (countsBySource[r.sourceKind] ?? 0) + 1;
  }

  // ---- 4. Promoted lead(s) — entity → lead linkage ----
  // Cascade attribution stores the entity_key on the lead row via the
  // source_payload JSON (#387 promote-to-lead writes it under
  // source_payload.watchlist_entity_key). Two-pronged match: exact, plus
  // company name when label matches. Soft-fail returns [].
  let leads: DossierLeadLink[] = [];
  try {
    const labelLike = entityLabel ? entityLabel : null;
    const [leadRows] = await db.execute<LeadRow[]>(
      labelLike
        ? `SELECT id, company, contact_name, email, phone, band, score, created_at
             FROM leads
            WHERE client_id = ?
              AND archived_at IS NULL
              AND (
                JSON_UNQUOTE(JSON_EXTRACT(source_payload, '$.watchlist_entity_key')) = ?
                OR LOWER(company) = LOWER(?)
              )
            ORDER BY created_at DESC
            LIMIT 5`
        : `SELECT id, company, contact_name, email, phone, band, score, created_at
             FROM leads
            WHERE client_id = ?
              AND archived_at IS NULL
              AND JSON_UNQUOTE(JSON_EXTRACT(source_payload, '$.watchlist_entity_key')) = ?
            ORDER BY created_at DESC
            LIMIT 5`,
      labelLike
        ? [args.clientId, args.entityKey, labelLike]
        : [args.clientId, args.entityKey]
    );
    leads = leadRows.map((l) => ({
      leadId: l.id,
      company: l.company,
      contactName: l.contact_name,
      email: l.email,
      phone: l.phone,
      band: l.band,
      score: l.score,
      createdAt: l.created_at
    }));
  } catch {
    leads = [];
  }

  return {
    entityKey: args.entityKey,
    entityLabel,
    watchlist,
    records,
    countsBySource,
    leads
  };
}

/**
 * Human-readable signal kind copy for the operator dossier. Lives here
 * (not in distress_engine) because the dossier surface is the only place
 * we describe signal kinds in full English. MUST match SignalKind union
 * exactly — TS will enforce.
 */
export const SIGNAL_KIND_COPY: Record<SignalKind, { label: string; why: string }> = {
  new_llc: {
    label: 'New LLC formed',
    why: 'A new entity was registered with CA SOS. Useful for vendor-prospecting and watching for related shell formations.'
  },
  suspended_entity: {
    label: 'Suspended entity',
    why: 'CA SOS marked this entity Suspended. Typically 30-90 days from lien activity; high-value early signal in CA collections work.'
  },
  dissolved_entity: {
    label: 'Dissolved entity',
    why: 'The entity was formally dissolved or cancelled. Last-touch window for any outstanding receivable before structure unwinds.'
  },
  leadership_change: {
    label: 'Leadership change',
    why: 'A registered-agent or principal change is on file. Often presages strategy and vendor shifts.'
  },
  high_denial_rate: {
    label: 'High loan denial rate',
    why: 'HMDA shows this lender denying applications above peer rate. Reputational + funding pressure signal in consumer-lending verticals.'
  },
  high_refinance_volume: {
    label: 'High refinance volume',
    why: 'HMDA shows elevated refinance volume in this tract or lender. Target-list signal for downstream services.'
  },
  complaint_velocity_high: {
    label: 'Complaint velocity high',
    why: 'CFPB complaint volume against this company is rising. Operational and reputational stress indicator.'
  },
  lender_under_fire: {
    label: 'Lender under fire',
    why: 'A federal consumer complaint was filed against this lender. Tells us how the market describes their pain — actionable language for outreach.'
  },
  lawsuit_filed: {
    label: 'Lawsuit filed',
    why: 'A civil case was opened against this entity. Litigation pressure historically correlates with payment delays and downstream collections need.'
  },
  bankruptcy_filed: {
    label: 'Bankruptcy filed',
    why: 'A federal bankruptcy petition was filed. Creditors have a defined window to file claims — the watchlist surfaces this so we can reach the creditor list first.'
  },
  code_violation: {
    label: 'Code violation',
    why: 'Property received a code-enforcement complaint. For real-estate verticals: distressed-property signal that pairs with absentee-owner data.'
  },
  ucc_filing: {
    label: 'UCC filing',
    why: 'A secured party filed against this entity as debtor. Identifies vendors and lenders with exposure — actionable cascade target.'
  },
  credit_risk_increase: {
    label: 'Credit risk increase',
    why: 'A credit-related event raised the risk profile for this entity.'
  },
  negative_review_trend: {
    label: 'Negative review trend',
    why: 'Customer reviews have trended negative. Reputational + operational stress signal that often precedes harder distress.'
  },
  address_change: {
    label: 'Address change',
    why: 'The entity changed its official address. Often correlates with operational restructuring or downsizing.'
  },
  rapid_growth: {
    label: 'Rapid growth',
    why: 'Growth-stage signals indicate scaling — different vertical packs treat this as an opportunity rather than distress (e.g. B2B sales prospecting).'
  }
};
