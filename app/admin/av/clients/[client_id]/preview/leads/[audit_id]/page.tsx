/**
 * /admin/av/clients/[client_id]/preview/leads/[audit_id]
 *
 * OPERATOR-ONLY, read-only mirror of /client/leads/[audit_id] — the curated
 * lead-detail view a client sees when they click into one of their leads
 * (audit, AI scoring, what to say on the call, calls / notes / outreach tabs).
 *
 * Pattern mirrors the existing /preview dashboard route: instead of reading the
 * client session cookie, we resolve the representative client_user from the
 * URL's client_id (with brand_members fallback for added brands), then call the
 * SAME getClientLeadDetail() the live route uses — so the rendered surface is
 * the exact body the client sees.
 *
 * Interactive bits (call logging, note POSTs, reject) currently render live in
 * preview — the operator will see the buttons and can use them. If we want
 * preview-truly-read-only, we'd pass a `preview` flag down into
 * ClientLeadDetailTabs and gate the action handlers there. Defer until needed.
 */
import { headers } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { getAvDb } from '@/lib/db/av';
import { findClientUserById } from '@/lib/auth/client-user';
import { getClientLeadDetail } from '@/lib/client/lead_detail';
import ClientLeadDetailTabs from '@/app/client/leads/[audit_id]/ClientLeadDetailTabs';
import ClientV3TopNav from '@/app/client/_components/ClientV3TopNav';
// V3 skin imports — see preview/page.tsx for rationale.
import '@/app/client/skin.social.css';
import '@/app/client/client-social.css';
import type { RowDataPacket } from 'mysql2';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface ClientRow extends RowDataPacket { client_name: string | null }

export default async function ClientLeadDetailPreview({
  params
}: {
  params: { client_id: string; audit_id: string };
}) {
  // Operator-side guard — clients should never reach this route.
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

  // Same identity-resolution pattern as the dashboard preview: prefer a
  // client_user directly linked to this client_id; fall back to a brand_members
  // owner for ADDED brands that don't have a directly-linked login (#101).
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

  const lead = await getClientLeadDetail(clientId, params.audit_id);
  if (!lead) notFound();

  return (
    <div>
      {/* Operator preview banner — clearly not the client's own login. */}
      <div className="mb-4 rounded-lg border border-amber-400/40 bg-amber-400/10 px-4 py-2.5 text-sm text-amber-200 flex items-center justify-between gap-3">
        <span>
          <span className="font-semibold">Operator preview</span> — this is the lead-detail view{' '}
          <span className="font-semibold">{clientName}</span> sees when they click into this lead.
          {member?.email && (
            <>
              {' '}Resolved as <span className="text-amber-100">{member.email}</span>.
            </>
          )}
        </span>
        <span className="shrink-0 flex items-center gap-4">
          <Link
            href={`/admin/av/clients/${clientId}/preview`}
            className="text-amber-100 hover:underline"
          >
            &larr; Preview dashboard
          </Link>
          <Link
            href={`/admin/av/clients/${clientId}`}
            className="text-amber-100 hover:underline"
          >
            Back to client
          </Link>
        </span>
      </div>

      <div data-skin="social">
        <main className="v3-wrap" style={{ maxWidth: 980 }}>
          <ClientV3TopNav preview />

          <section className="v3-greet">
            <Link
              href={`/admin/av/clients/${clientId}/preview/leads`}
              className="v3-link"
              style={{ display: 'inline-block', marginBottom: '14px' }}
            >
              ← Pipeline
            </Link>
            <p className="v3-eyebrow">
              {lead.score !== null ? `Score ${Math.round(lead.score)}` : 'Lead'}
              {lead.band ? ` · ${lead.band[0].toUpperCase()}${lead.band.slice(1)}` : ''}
            </p>
            <h1 className="v3-h1">{lead.company}</h1>
            {lead.industry && (
              <p className="v3-lede" style={{ marginTop: '4px' }}>{lead.industry}</p>
            )}
          </section>

          <div style={{ marginTop: '8px' }}>
            <ClientLeadDetailTabs lead={lead} />
          </div>

          <p className="v3-foot">Operator preview · read-only</p>
        </main>
      </div>
    </div>
  );
}
