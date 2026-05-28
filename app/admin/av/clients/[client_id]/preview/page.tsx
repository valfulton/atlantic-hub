/**
 * /admin/av/clients/[client_id]/preview
 *
 * OPERATOR-ONLY, read-only TRUE MIRROR of a client's dashboard, for a given
 * client_id — WITHOUT the client logging in. Renders the EXACT same body the
 * client sees (<ClientDashboardBody> fed by getClientDashboardData), so the
 * preview can never drift from the real /client/dashboard. The `preview` flag
 * makes client-only actions read-only; leadsHref points lead links at the
 * operator client page instead of the live portal.
 *
 * NOTE: this lives under [client_id] to match the sibling client-detail route —
 * Next.js forbids two different slug names at one path level.
 */
import { headers } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { getAvDb } from '@/lib/db/av';
import { findClientUserById } from '@/lib/auth/client-user';
import { getClientDashboardData } from '@/lib/client/dashboard_data';
import ClientDashboardBody from '@/app/client/_components/ClientDashboardBody';
import type { RowDataPacket } from 'mysql2';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface ClientRow extends RowDataPacket { client_name: string | null }

export default async function ClientDashboardPreview({ params }: { params: { client_id: string } }) {
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

  // The representative member gives us the client identity the dashboard loads
  // against. Reuse findClientUserById (same path the real dashboard uses) so tier
  // / email / display_name are resolved identically — no column guessing.
  const [mrows] = await db.execute<(RowDataPacket & { client_user_id: number })[]>(
    `SELECT client_user_id FROM client_users WHERE client_id = ? ORDER BY client_user_id ASC LIMIT 1`,
    [clientId]
  );
  let memberUserId = mrows[0]?.client_user_id ?? null;
  // Multi-brand (#101): an ADDED brand has no login directly linked to its
  // client_id — its owner lives in brand_members. Fall back to that owner so the
  // preview resolves the right identity (email/tier) instead of an empty shell.
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

  const data = await getClientDashboardData({
    clientUserId: member?.client_user_id ?? 0,
    clientId,
    email: member?.email ?? '',
    tier: member?.tier ?? 'sprint',
    displayName: member?.display_name ?? clientName
  });

  return (
    <div>
      {/* Operator preview banner — clearly not the client's own login. */}
      <div className="mb-4 rounded-lg border border-amber-400/40 bg-amber-400/10 px-4 py-2.5 text-sm text-amber-200 flex items-center justify-between gap-3">
        <span>
          <span className="font-semibold">Operator preview</span> — this is what{' '}
          <span className="font-semibold">{clientName}</span> sees on their dashboard. Read-only.
        </span>
        <span className="shrink-0 flex items-center gap-4">
          <Link href={`/admin/av/brief?clientId=${clientId}`} className="text-amber-100 hover:underline">Edit creative brief &rarr;</Link>
          <Link href={`/admin/av/clients/${clientId}`} className="text-amber-100 hover:underline">Back to client</Link>
        </span>
      </div>

      <ClientDashboardBody
        data={data}
        email={member?.email ?? clientName}
        preview
        leadsHref={`/admin/av/clients/${clientId}`}
      />
    </div>
  );
}
