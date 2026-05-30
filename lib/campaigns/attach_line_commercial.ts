/**
 * lib/campaigns/attach_line_commercial.ts  (#61 Inc 4)
 *
 * Final piece of the line-born commercial pipeline. A line commercial was
 * generated leadless (lead_id NULL, narrative_line_id set), branded, queued
 * to social, and now lives across the spine. This module *attaches* it to a
 * SPECIFIC lead in the line's owner's pipeline, so:
 *
 *   1. The commercial shows up on the lead's media gallery (the CommercialPanel
 *      on the lead detail reads grok_imagine_assets WHERE lead_id = ?).
 *   2. Any social_outbox drafts queued from this commercial (Inc 2) inherit
 *      the lead_id so the same posts show on the lead's outreach trail.
 *   3. The LEAD itself gets linked to the same narrative line as 'advances'
 *      — closing the loop: the story this lead supports is also a story the
 *      brand has produced media for.
 *
 * Ownership rule (strict):
 *   - client line (clientId > 0)  -> lead.client_id MUST match line.client_id
 *   - house line (clientId NULL)  -> lead.client_id MUST be NULL (operator pipeline)
 * Cross-ownership attaches are refused with an honest reason. Refusal also
 * applies when the asset is already attached to a (different) lead — preserves
 * the spine's "one commercial → one lead" invariant after attach.
 *
 * Never throws. The handler returns { ok, reason? } so the UI can render the
 * outcome inline next to the picker.
 */
import { getAvDb } from '@/lib/db/av';
import { getLane } from '@/lib/campaigns/store';
import { linkAssetToLine } from '@/lib/campaigns/line_links';
import { logEvent } from '@/lib/events/log';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

export interface AttachResult {
  ok: boolean;
  /** The new lead_id on the asset when ok=true. */
  leadId?: number;
  /** Number of social_outbox rows propagated. */
  draftsPropagated?: number;
  /** Soft failure reason when ok=false. */
  reason?: string;
}

interface AssetRow extends RowDataPacket {
  id: number;
  narrative_line_id: number | null;
  lead_id: number | null;
  branded_status: string | null;
  generation_status: string;
}

interface LeadRow extends RowDataPacket {
  id: number;
  client_id: number | null;
  company: string | null;
}

export async function attachLineCommercialToLead(args: {
  lineId: number;
  assetId: number;
  leadId: number;
  actorUserId?: number | null;
}): Promise<AttachResult> {
  if (!Number.isInteger(args.lineId) || args.lineId <= 0) return { ok: false, reason: 'invalid line id' };
  if (!Number.isInteger(args.assetId) || args.assetId <= 0) return { ok: false, reason: 'invalid asset id' };
  if (!Number.isInteger(args.leadId) || args.leadId <= 0) return { ok: false, reason: 'invalid lead id' };

  const line = await getLane(args.lineId);
  if (!line) return { ok: false, reason: 'line not found' };

  const db = getAvDb();
  const [aRows] = await db.execute<AssetRow[]>(
    `SELECT id, narrative_line_id, lead_id, branded_status, generation_status
       FROM grok_imagine_assets WHERE id = ? LIMIT 1`,
    [args.assetId]
  );
  const asset = aRows[0];
  if (!asset || asset.narrative_line_id !== args.lineId) {
    return { ok: false, reason: 'asset not on this line' };
  }
  if (asset.generation_status !== 'succeeded') {
    return { ok: false, reason: `asset not ready (status=${asset.generation_status})` };
  }
  if (asset.lead_id != null && asset.lead_id !== args.leadId) {
    // Refuse silent re-attach to a different lead — that would orphan the
    // first lead's gallery view of this commercial. Detach first if needed.
    return { ok: false, reason: 'this commercial is already attached to a different lead. Detach first.' };
  }

  const [lRows] = await db.execute<LeadRow[]>(
    `SELECT id, client_id, company FROM leads WHERE id = ? AND archived_at IS NULL LIMIT 1`,
    [args.leadId]
  );
  const lead = lRows[0];
  if (!lead) return { ok: false, reason: 'lead not found or archived' };

  // Strict ownership match — keeps client-tenant content from leaking onto
  // another customer's lead, and house-line content from getting glued to a
  // client's lead (which would confuse the cockpit's "what this story has
  // produced" rollup).
  const lineOwner = line.clientId ?? null;
  const leadOwner = lead.client_id ?? null;
  if (lineOwner !== leadOwner) {
    return {
      ok: false,
      reason: lineOwner === null
        ? `this is a house-brand commercial — pick a lead in the operator pipeline.`
        : `this commercial belongs to a client line — pick a lead owned by that client.`
    };
  }

  // (1) Set lead_id on the asset.
  const [updAsset] = await db.execute<ResultSetHeader>(
    `UPDATE grok_imagine_assets SET lead_id = ?, updated_at = NOW()
      WHERE id = ? AND narrative_line_id = ? AND (lead_id IS NULL OR lead_id = ?)`,
    [args.leadId, args.assetId, args.lineId, args.leadId]
  );
  if (updAsset.affectedRows === 0) {
    return { ok: false, reason: 'asset state changed mid-attach; reload and try again' };
  }

  // (2) Propagate lead_id to any social_outbox drafts queued from this
  //     commercial. Only updates rows where lead_id is currently NULL — never
  //     stomps an explicit attach the operator already set on a draft.
  const [updOutbox] = await db.execute<ResultSetHeader>(
    `UPDATE social_outbox SET lead_id = ?, updated_at = NOW()
      WHERE asset_id = ? AND lead_id IS NULL AND archived_at IS NULL`,
    [args.leadId, args.assetId]
  );

  // (3) Thread the LEAD to the same line. The commercial already advances
  //     this line (linked at generate time); now the lead does too — the
  //     spine sees one cohesive story arc. Non-fatal: a link failure here
  //     doesn't undo the attach.
  await linkAssetToLine({
    tenantId: line.tenantId,
    narrativeLineId: args.lineId,
    assetType: 'lead',
    assetId: args.leadId,
    role: 'advances',
    note: 'attached via line-born commercial',
    createdByUserId: args.actorUserId ?? null
  }).catch(() => {});

  await logEvent({
    eventType: 'commercial.attached_to_lead',
    leadId: args.leadId,
    userId: args.actorUserId ?? null,
    source: 'narrative_spine',
    status: 'success',
    payload: {
      asset_id: args.assetId,
      narrative_line_id: args.lineId,
      client_id: line.clientId,
      lead_company: lead.company,
      drafts_propagated: updOutbox.affectedRows
    }
  });

  return {
    ok: true,
    leadId: args.leadId,
    draftsPropagated: updOutbox.affectedRows
  };
}

/**
 * Lightweight lead picker source for the cockpit's attach-to-lead UI.
 * Returns active leads (non-archived) under the line's owner — limited so the
 * dropdown stays usable. Empty array when there's nothing to pick from.
 */
export interface PickableLead {
  leadId: number;
  company: string;
  contactName: string | null;
  band: string | null;
}

export async function listLeadsForLineAttach(lineId: number, limit = 60): Promise<PickableLead[]> {
  const line = await getLane(lineId);
  if (!line) return [];
  const db = getAvDb();
  try {
    const ownerClause = line.clientId && line.clientId > 0 ? 'client_id = ?' : 'client_id IS NULL';
    const params: unknown[] = line.clientId && line.clientId > 0 ? [line.clientId] : [];
    const [rows] = await db.execute<(RowDataPacket & {
      id: number; company: string | null; contact_name: string | null; ai_score_band: string | null;
    })[]>(
      `SELECT id, company, contact_name, ai_score_band
         FROM leads
        WHERE archived_at IS NULL AND ${ownerClause}
        ORDER BY
          FIELD(ai_score_band, 'hot', 'warm', 'cool') ASC,
          ai_combined_score IS NULL ASC,
          ai_combined_score DESC,
          id DESC
        LIMIT ?`,
      [...params, limit]
    );
    return rows.map((r) => ({
      leadId: r.id,
      company: (r.company || `Lead #${r.id}`).trim(),
      contactName: r.contact_name && r.contact_name.trim() ? r.contact_name.trim() : null,
      band: r.ai_score_band
    }));
  } catch (err) {
    console.error('[attach_line_commercial:list]', (err as Error).message);
    return [];
  }
}
