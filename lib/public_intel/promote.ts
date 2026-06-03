/**
 * lib/public_intel/promote.ts  (#387, val 2026-06-03)
 *
 * Promote a distress-watchlist entity → leads row. This is the bridge
 * between the upstream intelligence radar (entity_distress_scores) and the
 * downstream committed-contact pipeline (leads).
 *
 * Insert path:
 *   1. Look up the entity in entity_distress_scores for the client.
 *   2. Build a `leads` row from the entity + cascade attribution:
 *        company = entity_label
 *        address_state = region_code
 *        ai_score = distress score
 *        audit_content = cascade attribution humanLine (so the lead detail
 *           page shows "why this lead surfaced" before val ever runs Hunter)
 *        source_type = 'distress_watchlist'
 *        source_payload = JSON snapshot of contributing signals + attribution
 *   3. Dedup by (client_id, company) — if a lead already exists with same
 *      company under this client, do NOT insert a duplicate; return existing.
 *   4. Do NOT call Hunter. Contact discovery is val's manual call from the
 *      lead detail page.
 *
 * Returns { leadId, auditId, created: boolean }.
 *
 * Soft-fails to throw on db error; caller wraps and returns 500.
 */
import { randomUUID } from 'crypto';
import { getAvDb } from '@/lib/db/av';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { entityAttribution } from '@/lib/public_intel/attribution';
import { logEvent } from '@/lib/events/log';

export interface PromoteEntityInput {
  clientId: number;
  entityKey: string;
  entityLabel: string | null;
  regionCode: string | null;
  score: number;
  signalKinds: string[];
  /** Who triggered the promotion (for the audit log). */
  actorKind: 'operator' | 'client_user';
  actorId: number;
}

export interface PromoteEntityResult {
  leadId: number;
  auditId: string;
  created: boolean;
  /** The cascade attribution that was written into audit_content. */
  attributionHumanLine: string | null;
}

interface LeadRow extends RowDataPacket {
  id: number;
  audit_id: string;
}

export async function promoteEntityToLead(input: PromoteEntityInput): Promise<PromoteEntityResult> {
  const db = getAvDb();
  const company = (input.entityLabel ?? input.entityKey).slice(0, 200);

  // 1. Dedup: same client + same company name = already-a-lead, return it.
  const [existing] = await db.execute<LeadRow[]>(
    `SELECT id, audit_id
       FROM leads
      WHERE client_id = ?
        AND archived_at IS NULL
        AND LOWER(company) = LOWER(?)
      ORDER BY id DESC
      LIMIT 1`,
    [input.clientId, company]
  );
  if (existing[0]) {
    return {
      leadId: existing[0].id,
      auditId: existing[0].audit_id,
      created: false,
      attributionHumanLine: null
    };
  }

  // 2. Cascade attribution → audit_content.
  const attribution = await entityAttribution(input.clientId, input.entityKey);
  const attributionLine = attribution?.humanLine ?? null;
  const auditContent = attribution
    ? `Surfaced by the Atlantic Hub Revenue Distress Intelligence Engine.\n\n${attribution.humanLine}\n\nTrigger: ${attribution.trail[0]?.triggerSummary ?? input.entityKey}.\n\nThis prospect appeared on the distress watchlist with a score of ${input.score} (${input.signalKinds.join(', ')}). Consider the public-records signal when sequencing outreach — they may not yet know we know.`
    : `Surfaced by the Atlantic Hub Revenue Distress Intelligence Engine. Distress score ${input.score} from signals: ${input.signalKinds.join(', ')}.`;

  const sourcePayload = {
    promoted_at: new Date().toISOString(),
    promoted_by_kind: input.actorKind,
    promoted_by_id: input.actorId,
    entity_key: input.entityKey,
    entity_label: input.entityLabel,
    region_code: input.regionCode,
    distress_score: input.score,
    signal_kinds: input.signalKinds,
    attribution_human_line: attributionLine,
    attribution_trail: attribution?.trail ?? []
  };

  const auditId = randomUUID();

  // 3. Insert the lead.
  const [insertResult] = await db.execute<ResultSetHeader>(
    `INSERT INTO leads (
       audit_id, client_id, company, industry,
       address_state, address_country,
       audit_content, ai_score,
       lead_status, source_type, target_business,
       source_payload, last_activity_at
     )
     VALUES (?, ?, ?, NULL,
             ?, ?,
             ?, ?,
             'new', 'distress_watchlist', 'b2b',
             ?, NOW())`,
    [
      auditId,
      input.clientId,
      company,
      input.regionCode,
      input.regionCode && input.regionCode.length === 2 ? 'US' : null,
      auditContent,
      Math.max(0, Math.min(100, Math.round(input.score / 2))), // distress 0-200 → ai_score 0-100
      JSON.stringify(sourcePayload)
    ]
  );
  const leadId = insertResult.insertId;

  // 4. Mark the entity as 'contacted' so it doesn't keep nagging.
  try {
    await db.execute(
      `UPDATE entity_distress_scores
          SET last_action = 'contacted',
              last_acted_at = NOW()
        WHERE client_id = ? AND entity_key = ?`,
      [input.clientId, input.entityKey]
    );
  } catch { /* non-fatal */ }

  await logEvent({
    eventType: 'lead.created',
    leadId,
    source: 'distress_watchlist',
    status: 'success',
    payload: {
      client_id: input.clientId,
      entity_key: input.entityKey,
      distress_score: input.score,
      actor_kind: input.actorKind,
      actor_id: input.actorId
    }
  });

  return {
    leadId,
    auditId,
    created: true,
    attributionHumanLine: attributionLine
  };
}
