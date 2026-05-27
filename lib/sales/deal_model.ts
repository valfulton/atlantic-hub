/**
 * lib/sales/deal_model.ts
 *
 * Per-client deal economics + per-lead value. Replaces Atlantic & Vine's own
 * pricing (Sprint floor x AI score) for client hubs with the CLIENT's real
 * economics, switchable per client:
 *
 *   - per_head: value = rate_cents (per unit, per MONTH) x the lead's unit_count
 *               e.g. EHP = $10/employee/month x # employees at the prospect
 *   - flat:     value = the flat monthly amount entered on the lead
 *
 * Headline figure is MONTHLY recurring; annual = monthly x 12.
 *
 * A client with no deal_model set returns null here, and callers fall back to the
 * legacy AV pipeline math (lib/sales/pipeline_value.ts) — unchanged behavior.
 */
import { getAvDb } from '@/lib/db/av';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

export type DealMode = 'per_head' | 'flat';

export interface ClientDealModel {
  mode: DealMode;
  /** per_head: per-unit, per-month rate in cents. null in flat mode. */
  rateCents: number | null;
  /** per_head unit noun, e.g. "employee". */
  unitLabel: string;
}

export interface LeadDealInputs {
  dealUnitCount: number | null;
  dealFlatCents: number | null;
}

/** A client's configured deal model, or null when none is set (use legacy math). */
export async function getClientDealModel(clientId: number | null): Promise<ClientDealModel | null> {
  if (!clientId || clientId <= 0) return null;
  const db = getAvDb();
  const [rows] = await db.execute<(RowDataPacket & {
    deal_model: string | null; deal_rate_cents: number | null; deal_unit_label: string | null;
  })[]>(
    `SELECT deal_model, deal_rate_cents, deal_unit_label FROM clients WHERE client_id = ? LIMIT 1`,
    [clientId]
  );
  const r = rows[0];
  if (!r || (r.deal_model !== 'per_head' && r.deal_model !== 'flat')) return null;
  return {
    mode: r.deal_model,
    rateCents: r.deal_rate_cents == null ? null : Number(r.deal_rate_cents),
    unitLabel: r.deal_unit_label || 'unit'
  };
}

/** Save (or clear) a client's deal model. */
export async function saveClientDealModel(
  clientId: number,
  model: { mode: DealMode; rateCents: number | null; unitLabel: string | null }
): Promise<void> {
  const db = getAvDb();
  await db.execute<ResultSetHeader>(
    `UPDATE clients SET deal_model = ?, deal_rate_cents = ?, deal_unit_label = ? WHERE client_id = ?`,
    [
      model.mode,
      model.mode === 'per_head' ? (model.rateCents ?? null) : null,
      model.unitLabel ? model.unitLabel.slice(0, 40) : null,
      clientId
    ]
  );
}

/** Monthly value (cents) for a lead under a client's model, or null if not computable. */
export function leadMonthlyCents(model: ClientDealModel | null, lead: LeadDealInputs): number | null {
  if (!model) return null;
  if (model.mode === 'per_head') {
    if (model.rateCents == null || lead.dealUnitCount == null) return null;
    return model.rateCents * lead.dealUnitCount;
  }
  return lead.dealFlatCents ?? null;
}

export function annualCents(monthlyCents: number | null): number | null {
  return monthlyCents == null ? null : monthlyCents * 12;
}

/**
 * Total monthly pipeline value (cents) for a client: sum of each LIVE lead's
 * monthly value under the client's deal model. Returns null when the client has
 * no deal model set (so callers can hide the figure rather than show $0).
 */
export async function clientMonthlyPipelineCents(clientId: number | null): Promise<number | null> {
  const model = await getClientDealModel(clientId);
  if (!model || !clientId) return null;
  const db = getAvDb();
  const [rows] = await db.execute<(RowDataPacket & { deal_unit_count: number | null; deal_flat_cents: number | null })[]>(
    `SELECT deal_unit_count, deal_flat_cents FROM leads
      WHERE client_id = ? AND archived_at IS NULL
        AND lead_status IN ('new','contacted','qualified')`,
    [clientId]
  );
  let total = 0;
  for (const r of rows) {
    const m = leadMonthlyCents(model, {
      dealUnitCount: r.deal_unit_count == null ? null : Number(r.deal_unit_count),
      dealFlatCents: r.deal_flat_cents == null ? null : Number(r.deal_flat_cents)
    });
    if (m) total += m;
  }
  return total;
}

export function formatUsd(cents: number | null | undefined): string {
  if (cents == null) return '—';
  return Math.round(cents / 100).toLocaleString('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0
  });
}
