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
import OperatorPreviewChrome from '@/app/admin/av/clients/[client_id]/preview/_components/OperatorPreviewChrome';
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

      {/* The V3 dashboard body — exact same component the client sees.
          Wrapped in data-skin="social" so the navy V3 tokens + classes apply
          on the operator route (the skin CSS is scoped to that attribute). */}
      <div data-skin="social">
        <ClientDashboardV3 {...v3} />
      </div>
    </div>
  );
}
