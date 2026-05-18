/**
 * Audit-id → internal-lead-id resolution.
 *
 * Public URLs use `audit_id` (CHAR(36) UUID) so we never expose internal
 * BIGINT PKs. Every sub-route that operates on a single lead translates
 * the URL audit_id into `{ leadId, clientId }` and asserts that the
 * owning client is still active (kill-switch enforcement).
 */
import { getAvDb } from '@/lib/db/av';
import { resolveActiveAvClientById, type ResolvedAvClient } from '@/lib/av/client';
import type { RowDataPacket } from 'mysql2';

export interface ResolvedLead {
  leadId: number;
  auditId: string;
  client: ResolvedAvClient;
}

interface LeadKeyRow extends RowDataPacket {
  lead_id: number;
  client_id: number;
}

/**
 * Returns `null` if the audit_id doesn't exist, the lead is archived, or
 * the owning client is disabled/archived. Callers should 404 on null
 * regardless of cause — we don't leak which condition failed.
 */
export async function resolveLeadByAuditId(auditId: string): Promise<ResolvedLead | null> {
  if (!auditId || auditId.length !== 36) return null;
  const db = getAvDb();
  const [rows] = await db.execute<LeadKeyRow[]>(
    `SELECT lead_id, client_id
     FROM leads
     WHERE audit_id = ? AND archived_at IS NULL
     LIMIT 1`,
    [auditId]
  );
  if (rows.length === 0) return null;
  const client = await resolveActiveAvClientById(rows[0].client_id);
  if (!client) return null;
  return { leadId: rows[0].lead_id, auditId, client };
}
