/**
 * lib/client/dashboard_data.ts
 *
 * Single source of truth for data shared across the client dashboard surfaces:
 *   - /client/dashboard            (what the client sees)
 *   - /client/audit                (the full audit page)
 *   - /admin/av/clients/[id]/preview (operator's read-only mirror)
 *
 * Pass 1 of the "one view, one loader" refactor. The audit query in particular
 * had to be fixed in THREE places (it kept showing a prospect's audit as the
 * client's own); centralizing it here means it can only ever be fixed once.
 *
 * The returned shape intentionally mirrors the leads row (snake_case) so existing
 * render code at the call sites is a drop-in — no template churn, lower risk.
 */
import { getAvDb } from '@/lib/db/av';
import type { RowDataPacket } from 'mysql2';

export interface ClientOwnAuditRow {
  audit_id: string | null;
  company: string | null;
  industry: string | null;
  audit_content: string | null;
  audit_generated: Date | null;
  created_at: Date | null;
}

/**
 * The client's OWN business audit: the lead matching THEIR email. Never a
 * prospect scoped to their hub (client_id) — a prospect's marketing audit is not
 * the client's own. Returns null when the client has no audit on file yet.
 */
export async function getClientOwnAudit(email: string | null | undefined): Promise<ClientOwnAuditRow | null> {
  if (!email || !email.trim()) return null;
  const db = getAvDb();
  const [rows] = await db.execute<(RowDataPacket & ClientOwnAuditRow)[]>(
    `SELECT audit_id, company, industry, audit_content, audit_generated, created_at
       FROM leads
      WHERE archived_at IS NULL AND audit_content IS NOT NULL AND email = ?
      ORDER BY COALESCE(audit_generated, created_at) DESC
      LIMIT 1`,
    [email]
  );
  return rows[0] ?? null;
}
