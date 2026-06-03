/**
 * /admin/av/clients/[client_id]/preview/intelligence  (#321)
 *
 * OPERATOR-ONLY mirror of /client/intelligence — the exact "what your
 * investment produced" impact view this client sees, rendered without logging
 * in as them. Same loader (loadIntelligenceTrifecta) + same body
 * (IntelligenceImpactBody) as the live page, so the two can never drift.
 *
 * Required by the mirror-every-client-surface rule (see Mirror_Pattern.md +
 * memory feedback_mirror_every_client_page).
 */
import { headers } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { getAvDb } from '@/lib/db/av';
import { findClientUserById } from '@/lib/auth/client-user';
import { TIER_LABEL } from '@/lib/client-portal/tiers';
import { loadIntelligenceTrifecta } from '@/lib/av/intelligence_metrics';
import IntelligenceImpactBody from '@/app/client/_components/IntelligenceImpactBody';
import OperatorPreviewChrome from '@/app/admin/av/clients/[client_id]/preview/_components/OperatorPreviewChrome';
// V3 skin imports — see preview/page.tsx for the rationale.
import '@/app/client/skin.social.css';
import '@/app/client/client-social.css';
import type { RowDataPacket } from 'mysql2';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface ClientRow extends RowDataPacket { client_name: string | null }

export default async function ClientIntelligencePreview({ params }: { params: { client_id: string } }) {
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

  // Resolve the representative client_user for tier + display name (same path
  // as the dashboard + pr previews).
  const [mrows] = await db.execute<(RowDataPacket & { client_user_id: number })[]>(
    `SELECT client_user_id FROM client_users WHERE client_id = ? ORDER BY client_user_id ASC LIMIT 1`,
    [clientId]
  );
  let memberUserId = mrows[0]?.client_user_id ?? null;
  if (!memberUserId) {
    const [orows] = await db.execute<(RowDataPacket & { client_user_id: number })[]>(
      `SELECT client_user_id FROM brand_members WHERE client_id = ? AND role = 'owner' ORDER BY client_user_id ASC LIMIT 1`,
      [clientId]
    );
    memberUserId = orows[0]?.client_user_id ?? null;
  }
  const member = memberUserId ? await findClientUserById(memberUserId) : null;
  const tier = member?.tier ?? 'sprint';
  const locked = tier === 'audit_only';
  const headline = member?.display_name?.split(/[ ,]/)[0] || clientName.split(/[ ,]/)[0] || 'there';

  return (
    <div>
      <OperatorPreviewChrome
        clientId={clientId}
        clientName={clientName}
        active="dashboard"
        bannerLine="Exactly what they see at /client/intelligence."
        bannerExtra={
          <Link
            href={`/admin/av/intelligence?client=${clientId}`}
            style={{ color: '#EBCB6B', textDecoration: 'none' }}
            className="hover:underline"
          >
            Operator chain →
          </Link>
        }
      />

      <div data-skin="social">
        {locked ? (
          <main className="max-w-6xl mx-auto px-4 py-6">
            <section className="rounded-2xl border border-dashed border-border bg-surface/60 p-8 text-center">
              <div className="text-3xl mb-3" aria-hidden="true">&#x1F4C8;</div>
              <h2 className="text-lg font-semibold text-ink">Impact view unlocks on Sprint</h2>
              <p className="text-sm text-muted mt-2 max-w-md mx-auto leading-relaxed">
                {clientName} is on the <span className="text-ink font-medium">{TIER_LABEL[tier]}</span> plan. They&apos;d see
                this upgrade panel until you move them to Sprint or higher.
              </p>
            </section>
          </main>
        ) : (
          <IntelligenceImpactBody trifecta={await loadIntelligenceTrifecta({ clientId, sinceDays: 30 })} headline={headline} />
        )}
      </div>
    </div>
  );
}
