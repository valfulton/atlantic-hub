/**
 * /admin/av/clients/[client_id]/preview  (#397, val 2026-06-03)
 *
 * OPERATOR-ONLY mirror of /client/dashboard — TRUE mirror that cannot
 * drift, because it calls the same `loadDashboardV3` loader and renders
 * the same `<ClientDashboardV3>` body that the live page renders.
 *
 * What's different from the live page:
 *   - Operator amber banner up top ("Operator preview · Read-only")
 *   - Sibling tab strip (Dashboard | Leads | Watchlist | Audit | Intake | Press)
 *   - No <WelcomePopover> (that's identity-scoped to the real client_user)
 *   - The body itself is identical to what the client sees
 */
import { headers } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { getAvDb } from '@/lib/db/av';
import { findClientUserById } from '@/lib/auth/client-user';
import { getClientDashboardData } from '@/lib/client/dashboard_data';
import { loadDashboardV3 } from '@/lib/client/dashboard_v3_loader';
import ClientDashboardV3 from '@/app/client/dashboard/ClientDashboardV3';
// The V3 skin CSS is scoped to [data-skin="social"]. The live client portal
// gets it from app/client/layout.tsx; the operator route does not, so import
// it here too or the mirror renders unstyled.
import '@/app/client/skin.social.css';
import '@/app/client/client-social.css';
import type { RowDataPacket } from 'mysql2';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface ClientRow extends RowDataPacket { client_name: string | null }
interface MemberRow extends RowDataPacket { client_user_id: number }

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

  // Resolve the representative member exactly the way the live page does.
  const [mrows] = await db.execute<MemberRow[]>(
    `SELECT client_user_id FROM client_users WHERE client_id = ? ORDER BY client_user_id ASC LIMIT 1`,
    [clientId]
  );
  let memberUserId = mrows[0]?.client_user_id ?? null;
  if (!memberUserId) {
    const [orows] = await db.execute<MemberRow[]>(
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

  // Shared loader — same function the live /client/dashboard page calls.
  const v3 = await loadDashboardV3({
    clientId,
    clientUserId: member?.client_user_id ?? 0,
    data
  });

  return (
    <div>
      {/* Operator preview banner */}
      <div className="mb-3 rounded-lg border border-amber-400/40 bg-amber-400/10 px-4 py-2.5 text-sm text-amber-200 flex items-center justify-between gap-3 flex-wrap">
        <span>
          <span className="font-semibold">Operator preview</span> — this is what{' '}
          <span className="font-semibold">{clientName}</span> sees on their dashboard. Read-only.
        </span>
        <span className="shrink-0 flex items-center gap-4">
          <Link href={`/admin/av/brief?clientId=${clientId}`} className="text-amber-100 hover:underline">Edit creative brief &rarr;</Link>
          <Link href={`/admin/av/clients/${clientId}`} className="text-amber-100 hover:underline">Back to client</Link>
        </span>
      </div>

      {/* Sibling preview surfaces */}
      <div className="mb-4 flex items-center gap-2 text-xs flex-wrap">
        <span className="text-muted/70 uppercase tracking-[0.2em] text-[10px] mr-1">See what {clientName} sees:</span>
        <span className="inline-flex items-center rounded-md border border-amber-400/30 bg-amber-400/5 px-2.5 py-1 text-amber-100">Dashboard</span>
        <Link href={`/admin/av/clients/${clientId}/preview/leads`} className="inline-flex items-center rounded-md border border-border bg-surface px-2.5 py-1 text-ink hover:border-amber-400/40 hover:text-amber-100">Leads list</Link>
        <Link href={`/admin/av/clients/${clientId}/preview/watchlist`} className="inline-flex items-center rounded-md border border-border bg-surface px-2.5 py-1 text-ink hover:border-amber-400/40 hover:text-amber-100">Watchlist</Link>
        <Link href={`/admin/av/clients/${clientId}/preview/audit`} className="inline-flex items-center rounded-md border border-border bg-surface px-2.5 py-1 text-ink hover:border-amber-400/40 hover:text-amber-100">Audit</Link>
        <Link href={`/admin/av/clients/${clientId}/preview/intake`} className="inline-flex items-center rounded-md border border-border bg-surface px-2.5 py-1 text-ink hover:border-amber-400/40 hover:text-amber-100">Intake / brief</Link>
        <Link href={`/admin/av/clients/${clientId}/preview/pr`} className="inline-flex items-center rounded-md border border-border bg-surface px-2.5 py-1 text-ink hover:border-amber-400/40 hover:text-amber-100">Press queue</Link>
      </div>

      {/* The V3 dashboard body — exact same component the client sees.
          Wrapped in data-skin="social" so the navy V3 tokens + classes apply
          on the operator route (the skin CSS is scoped to that attribute). */}
      <div data-skin="social">
        <ClientDashboardV3 {...v3} />
      </div>
    </div>
  );
}
