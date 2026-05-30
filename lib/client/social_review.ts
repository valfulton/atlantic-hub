/**
 * lib/client/social_review.ts  (#61 Inc 3)
 *
 * The client-side approval queue for line-born commercial drafts. The operator
 * queues drafts (Inc 2) into the client's tenant (`client:<id>`). This module
 * reads them back for the client to APPROVE or REJECT.
 *
 * Approval lifecycle:
 *   draft (queued by operator)
 *     ── approve ──> scheduled (publisher picks up at scheduled_for)
 *     ── reject  ──> canceled  (publisher ignores; line-link stays as a
 *                                provenance trail — "we tried this angle")
 *
 * Scoped by client_id at every read/write. A client_user can only touch their
 * own tenant rows; the API guard enforces this on top of the tenant filter.
 */
import { getAvDb } from '@/lib/db/av';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

export interface ClientReviewItem {
  outboxId: number;
  provider: string;
  providerDisplayName: string | null;
  bodyText: string | null;
  mediaUrl: string | null;
  mediaType: 'none' | 'image' | 'video' | 'carousel';
  assetId: number | null;
  /** When the asset is a branded line-born commercial, this is the in-hub URL
   *  that streams the BRANDED version (for the client preview). Falls back to
   *  the raw media_url when there's no branded copy. */
  previewUrl: string | null;
  /** Narrative line this draft belongs to (null when not threaded). */
  narrativeLineId: number | null;
  narrativeLineName: string | null;
  createdAt: string;
}

function clientTenantId(clientId: number): string {
  return `client:${clientId}`;
}

/**
 * Pending drafts in this client's tenant — what they need to approve. Empty
 * array when there's nothing to review. The query joins to social_connections
 * for the provider display name + (best-effort) to narrative_lanes so the UI
 * can say "this draft belongs to your Founder Story line."
 */
export async function listClientReviewQueue(clientId: number): Promise<ClientReviewItem[]> {
  if (!Number.isInteger(clientId) || clientId <= 0) return [];
  const tenantId = clientTenantId(clientId);
  const db = getAvDb();
  try {
    const [rows] = await db.execute<(RowDataPacket & {
      id: number;
      provider: string;
      display_name: string | null;
      body_text: string | null;
      media_url: string | null;
      media_type: 'none' | 'image' | 'video' | 'carousel';
      asset_id: number | null;
      narrative_line_id: number | null;
      line_name: string | null;
      branded_status: string | null;
      created_at: string;
    })[]>(
      `SELECT
          o.id, c.provider, c.display_name,
          o.body_text, o.media_url, o.media_type, o.asset_id,
          a.narrative_line_id, nl.name AS line_name, a.branded_status,
          o.created_at
        FROM social_outbox o
        JOIN social_connections c ON c.id = o.connection_id
        LEFT JOIN grok_imagine_assets a ON a.id = o.asset_id
        LEFT JOIN narrative_lanes nl ON nl.id = a.narrative_line_id
       WHERE o.tenant_id = ?
         AND o.status = 'draft'
         AND o.archived_at IS NULL
       ORDER BY o.created_at DESC
       LIMIT 100`,
      [tenantId]
    );

    return rows.map((r) => {
      // Prefer the branded video stream for the client preview (so the client
      // sees the logo'd version, not the raw cut). Falls back to the raw url
      // when no branded copy exists yet — defensive: the queue-social route
      // already gates this, but the preview shouldn't break if state drifts.
      const previewUrl = r.narrative_line_id && r.asset_id && r.branded_status === 'ready'
        ? `/api/client/campaigns/lines/${r.narrative_line_id}/commercial/${r.asset_id}/brand-video`
        : r.media_url;
      return {
        outboxId: r.id,
        provider: r.provider,
        providerDisplayName: r.display_name,
        bodyText: r.body_text,
        mediaUrl: r.media_url,
        mediaType: r.media_type,
        assetId: r.asset_id,
        previewUrl,
        narrativeLineId: r.narrative_line_id,
        narrativeLineName: r.line_name,
        createdAt: String(r.created_at)
      };
    });
  } catch (err) {
    console.error('[social_review:list]', (err as Error).message);
    return [];
  }
}

export type ReviewDecision = 'approve' | 'reject';

export interface DecisionResult {
  ok: boolean;
  outboxId: number;
  newStatus?: 'scheduled' | 'canceled';
  reason?: string;
}

/**
 * Apply a client's decision to a single outbox row. Tenant-scoped — refuses
 * to act if the row isn't in this client's tenant or isn't still a draft
 * (double-click protection). Approve flips to 'scheduled' with
 * scheduled_for=NOW() so the publisher picks it up on the next cron.
 */
export async function decideClientReviewItem(args: {
  clientId: number;
  outboxId: number;
  decision: ReviewDecision;
}): Promise<DecisionResult> {
  if (!Number.isInteger(args.clientId) || args.clientId <= 0) {
    return { ok: false, outboxId: args.outboxId, reason: 'invalid client' };
  }
  if (!Number.isInteger(args.outboxId) || args.outboxId <= 0) {
    return { ok: false, outboxId: args.outboxId, reason: 'invalid outbox id' };
  }
  const tenantId = clientTenantId(args.clientId);
  const db = getAvDb();

  // Read first to refuse cleanly on tenant mismatch / wrong state — gives the
  // UI a usable reason rather than a silent 200 with 0 rows updated.
  const [rows] = await db.execute<(RowDataPacket & { id: number; tenant_id: string; status: string })[]>(
    `SELECT id, tenant_id, status FROM social_outbox WHERE id = ? LIMIT 1`,
    [args.outboxId]
  );
  const row = rows[0];
  if (!row) return { ok: false, outboxId: args.outboxId, reason: 'not found' };
  if (row.tenant_id !== tenantId) {
    return { ok: false, outboxId: args.outboxId, reason: 'not yours to decide' };
  }
  if (row.status !== 'draft') {
    return { ok: false, outboxId: args.outboxId, reason: `already ${row.status}` };
  }

  if (args.decision === 'approve') {
    const [res] = await db.execute<ResultSetHeader>(
      `UPDATE social_outbox
          SET status = 'scheduled', scheduled_for = NOW(), updated_at = NOW()
        WHERE id = ? AND tenant_id = ? AND status = 'draft'`,
      [args.outboxId, tenantId]
    );
    if (res.affectedRows === 0) {
      return { ok: false, outboxId: args.outboxId, reason: 'state changed mid-decision; reload' };
    }
    return { ok: true, outboxId: args.outboxId, newStatus: 'scheduled' };
  }

  // Reject path. We KEEP the row (canceled, not deleted) so the spine has
  // the audit trail — "client rejected this angle" is signal the learning
  // loop wants. archived_at stays null; canceled drafts are filtered out
  // of the review queue by the status='draft' filter above.
  const [res] = await db.execute<ResultSetHeader>(
    `UPDATE social_outbox
        SET status = 'canceled', updated_at = NOW()
      WHERE id = ? AND tenant_id = ? AND status = 'draft'`,
    [args.outboxId, tenantId]
  );
  if (res.affectedRows === 0) {
    return { ok: false, outboxId: args.outboxId, reason: 'state changed mid-decision; reload' };
  }
  return { ok: true, outboxId: args.outboxId, newStatus: 'canceled' };
}
