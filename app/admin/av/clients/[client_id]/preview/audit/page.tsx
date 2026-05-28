/**
 * /admin/av/clients/[client_id]/preview/audit
 *
 * OPERATOR-ONLY mirror of /client/audit — the Strategic Marketing Audit the
 * client sees. Resolves the audit by the representative client_user's email
 * (same shared loader as the live route).
 */
import { headers } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { getAvDb } from '@/lib/db/av';
import { findClientUserById } from '@/lib/auth/client-user';
import { getClientOwnAudit } from '@/lib/client/dashboard_data';
import type { RowDataPacket } from 'mysql2';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface ClientRow extends RowDataPacket { client_name: string | null }

export default async function ClientAuditPreview({ params }: { params: { client_id: string } }) {
  const role = headers().get('x-ah-user-role') as 'owner' | 'staff' | 'client_user' | null;
  if (role === 'client_user') redirect('/admin');

  const clientId = Number.parseInt(params.client_id, 10);
  if (!Number.isFinite(clientId) || clientId <= 0) notFound();

  const db = getAvDb();
  const [crows] = await db.execute<ClientRow[]>(
    `SELECT client_name FROM clients WHERE client_id = ? LIMIT 1`,
    [clientId]
  );
  if (!crows[0]) notFound();
  const clientName = crows[0].client_name || `Client #${clientId}`;

  const [mrows] = await db.execute<(RowDataPacket & { client_user_id: number })[]>(
    `SELECT client_user_id FROM client_users WHERE client_id = ? ORDER BY client_user_id ASC LIMIT 1`,
    [clientId]
  );
  let memberUserId = mrows[0]?.client_user_id ?? null;
  if (!memberUserId) {
    const [orows] = await db.execute<(RowDataPacket & { client_user_id: number })[]>(
      `SELECT client_user_id FROM brand_members
        WHERE client_id = ? AND role = 'owner'
        ORDER BY client_user_id ASC LIMIT 1`,
      [clientId]
    );
    memberUserId = orows[0]?.client_user_id ?? null;
  }
  const member = memberUserId ? await findClientUserById(memberUserId) : null;

  const audit = member?.email ? await getClientOwnAudit(member.email) : null;

  return (
    <div>
      <div className="mb-4 rounded-lg border border-amber-400/40 bg-amber-400/10 px-4 py-2.5 text-sm text-amber-200 flex items-center justify-between gap-3">
        <span>
          <span className="font-semibold">Operator preview</span> — {clientName}&apos;s Strategic Marketing Audit
          {member?.email && <> (resolved by <span className="text-amber-100">{member.email}</span>)</>}.
        </span>
        <span className="shrink-0 flex items-center gap-4">
          <Link href={`/admin/av/clients/${clientId}/preview`} className="text-amber-100 hover:underline">&larr; Dashboard preview</Link>
          <Link href={`/admin/av/clients/${clientId}`} className="text-amber-100 hover:underline">Back to client</Link>
        </span>
      </div>

      <main className="max-w-3xl mx-auto px-4 py-6">
        <div className="mb-6">
          <div className="text-[10px] uppercase tracking-[0.16em] text-muted">
            Strategic Marketing Audit
          </div>
          <h1 className="text-2xl sm:text-3xl font-semibold text-ink mt-1">
            {audit?.company || member?.display_name || clientName}
          </h1>
          {audit && (
            <div className="mt-2 text-xs text-muted flex flex-wrap gap-x-4 gap-y-1">
              {audit.industry && <span>Industry: <span className="text-ink">{audit.industry}</span></span>}
              <span>
                Generated:{' '}
                <span className="text-ink">
                  {(audit.audit_generated ?? audit.created_at)?.toISOString().slice(0, 10) || 'Recently'}
                </span>
              </span>
            </div>
          )}
        </div>

        {audit ? (
          <article className="rounded-2xl border border-border bg-surface p-6 sm:p-8 text-ink leading-relaxed whitespace-pre-line text-[15px]">
            {audit.audit_content}
          </article>
        ) : (
          <div className="rounded-2xl border border-border bg-surface p-6 text-sm text-muted">
            No audit on file for this client yet. (Audits are keyed by the client&apos;s email — if the email here doesn&apos;t match the original audit-form submission, it won&apos;t resolve.)
          </div>
        )}
      </main>
    </div>
  );
}
