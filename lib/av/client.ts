/**
 * AV client resolution + kill-switch enforcement.
 *
 * Every AV API route needs to:
 *   1. Translate a `client_slug` (or `client_uuid`) into the internal
 *      BIGINT `client_id` used by every child table.
 *   2. Refuse to proceed if `clients.enabled = FALSE` (kill switch).
 *   3. Refuse to proceed if `clients.archived_at IS NOT NULL`.
 *
 * Centralized here so the rule is one grep away.
 *
 * The kill switch is APPLICATION-ENFORCED. MySQL has no constraint that
 * makes `enabled = FALSE` block reads or writes — every route must call
 * `resolveActiveAvClient()` (or the looser `resolveAvClientById()` for
 * audit-id-based lookups where we derive the client_id from the lead row).
 */
import { getAvDb } from '@/lib/db/av';
import { mysqlBoolToJs } from '@/lib/feature-flags';
import type { RowDataPacket } from 'mysql2';

export interface ResolvedAvClient {
  clientId: number;
  clientUuid: string;
  clientSlug: string;
  clientName: string;
  enabled: boolean;
  archivedAt: string | null;
}

interface ClientRow extends RowDataPacket {
  client_id: number;
  client_uuid: string;
  client_slug: string;
  client_name: string;
  enabled: unknown;
  archived_at: string | null;
}

/**
 * Look up an AV client by slug and assert it's currently active.
 * Returns `null` if not found, disabled, or archived. Callers should
 * 404 on null — we don't tell the world whether a slug exists.
 */
export async function resolveActiveAvClient(slug: string): Promise<ResolvedAvClient | null> {
  if (!slug) return null;
  const db = getAvDb();
  const [rows] = await db.execute<ClientRow[]>(
    `SELECT client_id, client_uuid, client_slug, client_name, enabled, archived_at
     FROM clients
     WHERE client_slug = ?
     LIMIT 1`,
    [slug]
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  const enabled = mysqlBoolToJs(r.enabled);
  if (!enabled || r.archived_at !== null) return null;
  return {
    clientId: r.client_id,
    clientUuid: r.client_uuid,
    clientSlug: r.client_slug,
    clientName: r.client_name,
    enabled,
    archivedAt: r.archived_at
  };
}

/**
 * Look up an AV client by internal BIGINT id. Used when we already have a
 * client_id (e.g. derived from a leads row) and want to assert it's still
 * active before letting a mutation through.
 */
export async function resolveActiveAvClientById(clientId: number): Promise<ResolvedAvClient | null> {
  const db = getAvDb();
  const [rows] = await db.execute<ClientRow[]>(
    `SELECT client_id, client_uuid, client_slug, client_name, enabled, archived_at
     FROM clients
     WHERE client_id = ?
     LIMIT 1`,
    [clientId]
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  const enabled = mysqlBoolToJs(r.enabled);
  if (!enabled || r.archived_at !== null) return null;
  return {
    clientId: r.client_id,
    clientUuid: r.client_uuid,
    clientSlug: r.client_slug,
    clientName: r.client_name,
    enabled,
    archivedAt: r.archived_at
  };
}

/**
 * V1 default client. Until the multi-client UI lands, every route falls
 * back to Val's internal AV client. Seeded in 004_av_detail.sql.
 */
export const DEFAULT_AV_CLIENT_SLUG = 'av-internal';
