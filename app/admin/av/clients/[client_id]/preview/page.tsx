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
import { loadAdrianaDashboard } from '@/lib/client/adriana_dashboard_loader';
import AdrianaDashboard from '@/app/client/dashboard/AdrianaDashboard';
import OperatorPreviewChrome from '@/app/admin/av/clients/[client_id]/preview/_components/OperatorPreviewChrome';
// AdrianaDashboard renders against the canonical client-app design system.
// The operator preview route doesn't go through app/client/layout.tsx, so
// we import the design system here directly.
import '@/app/client/_styles/app.css';
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

  // Same loader the live /client/dashboard calls — mirror cannot drift.
  const props = await loadAdrianaDashboard({
    clientUserId: member?.client_user_id ?? 0,
    activeClientId: clientId,
    firstName: data.firstName || clientName.split(/\s+/)[0] || 'there',
    brandName: 'Atlantic & Vine',
    brandPill: 'Client'
  });

  return (
    <div>
      <OperatorPreviewChrome
        clientId={clientId}
        clientName={clientName}
        active="dashboard"
        bannerLine="Read-only."
        bannerExtra={
          <Link
            href={`/admin/av/brief?clientId=${clientId}`}
            style={{ color: '#EBCB6B', textDecoration: 'none' }}
            className="hover:underline"
          >
            Edit creative brief →
          </Link>
        }
      />

      {/* Exact same component the client sees. Wrap in `.app` because this
          route doesn't pass through app/client/layout.tsx (which is where
          the design-system shell normally hangs). */}
      <div className="app">
        <AdrianaDashboard {...props} />
      </div>
    </div>
  );
}
