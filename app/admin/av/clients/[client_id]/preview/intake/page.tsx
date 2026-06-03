/**
 * /admin/av/clients/[client_id]/preview/intake
 *
 * OPERATOR-ONLY mirror of /client/intake — the prefilled, editable brief the
 * client sees. Form actions in <ClientIntakeForm /> POST to /api/client/* and
 * require the client session cookie; in preview those will fail. The form
 * itself still renders prefilled so val can see what the client sees;
 * editing/saving is reserved for the client's own login (or for val from the
 * operator brief editor at /admin/av/brief).
 */
import { headers } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { getAvDb } from '@/lib/db/av';
import { findClientUserById } from '@/lib/auth/client-user';
import { getBriefPayload } from '@/lib/client/brief_store';
import ClientIntakeForm from '@/app/client/intake/ClientIntakeForm';
// V3 skin imports — see preview/page.tsx for the rationale.
import '@/app/client/skin.social.css';
import '@/app/client/client-social.css';
import type { RowDataPacket } from 'mysql2';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface ClientRow extends RowDataPacket { client_name: string | null }

export default async function ClientIntakePreview({ params }: { params: { client_id: string } }) {
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

  let initial: Record<string, unknown> = {};
  try {
    initial = (await getBriefPayload('av', clientId)) ?? {};
  } catch {
    initial = {};
  }

  const brandName = member?.display_name?.trim() || clientName;

  return (
    <div>
      <div className="mb-3 rounded-lg border border-amber-400/40 bg-amber-400/10 px-4 py-2.5 text-sm text-amber-200 flex items-center justify-between gap-3 flex-wrap">
        <span>
          <span className="font-semibold">Operator preview</span> — what {clientName} sees in the intake / details form. Save will fail here (it needs the client&apos;s own session); edit via{' '}
          <Link href={`/admin/av/brief?clientId=${clientId}`} className="text-amber-100 underline">the operator brief editor</Link> instead.
        </span>
        <span className="shrink-0 flex items-center gap-4">
          <Link href={`/admin/av/clients/${clientId}`} className="text-amber-100 hover:underline">Back to client</Link>
        </span>
      </div>

      {/* (#389) Sibling preview surfaces — consistent nav across every mirror. */}
      <div className="mb-4 flex items-center gap-2 text-xs flex-wrap">
        <span className="text-muted/70 uppercase tracking-[0.2em] text-[10px] mr-1">See what {clientName} sees:</span>
        <Link href={`/admin/av/clients/${clientId}/preview`} className="inline-flex items-center rounded-md border border-border bg-surface px-2.5 py-1 text-ink hover:border-amber-400/40 hover:text-amber-100">Dashboard</Link>
        <Link href={`/admin/av/clients/${clientId}/preview/leads`} className="inline-flex items-center rounded-md border border-border bg-surface px-2.5 py-1 text-ink hover:border-amber-400/40 hover:text-amber-100">Leads list</Link>
        <Link href={`/admin/av/clients/${clientId}/preview/watchlist`} className="inline-flex items-center rounded-md border border-border bg-surface px-2.5 py-1 text-ink hover:border-amber-400/40 hover:text-amber-100">Watchlist</Link>
        <Link href={`/admin/av/clients/${clientId}/preview/audit`} className="inline-flex items-center rounded-md border border-border bg-surface px-2.5 py-1 text-ink hover:border-amber-400/40 hover:text-amber-100">Audit</Link>
        <span className="inline-flex items-center rounded-md border border-amber-400/30 bg-amber-400/5 px-2.5 py-1 text-amber-100">Intake / brief</span>
        <Link href={`/admin/av/clients/${clientId}/preview/pr`} className="inline-flex items-center rounded-md border border-border bg-surface px-2.5 py-1 text-ink hover:border-amber-400/40 hover:text-amber-100">Press queue</Link>
      </div>

      <div data-skin="social">
        <main className="max-w-4xl mx-auto px-4 py-6">
          <ClientIntakeForm initial={initial} brandName={brandName} />
        </main>
      </div>
    </div>
  );
}
