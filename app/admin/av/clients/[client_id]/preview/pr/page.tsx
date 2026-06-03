/**
 * /admin/av/clients/[client_id]/preview/pr  (#220)
 *
 * OPERATOR-ONLY mirror of /client/pr -- the exact same press queue this
 * client sees in their portal, rendered without logging in as them.
 *
 * Same data path as the live page (listPrOpportunitiesForClientView).
 * ClientPrView is mounted in mode='preview' so the approve / pass / review
 * buttons render visibly (so val can see what the client will see) but are
 * read-only (they'd 401 against /api/client/* without a client cookie).
 *
 * Required by the mirror-every-client-surface rule -- see
 * Atlantic_Hub_Playbook/Mirror_Pattern.md.
 */
import { headers } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { getAvDb } from '@/lib/db/av';
import { findClientUserById } from '@/lib/auth/client-user';
import { TIER_LABEL } from '@/lib/client-portal/tiers';
// V3 skin imports — see preview/page.tsx for the rationale.
import '@/app/client/skin.social.css';
import '@/app/client/client-social.css';
import {
  listPrOpportunitiesForClientView,
  summarizeForClient,
  type ClientFacingPrOpportunity,
  type ClientPrSummary
} from '@/lib/pr/client_pr_actions';
import ClientPrView from '@/app/client/pr/ClientPrView';
import type { RowDataPacket } from 'mysql2';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface ClientRow extends RowDataPacket { client_name: string | null }

export default async function ClientPrPreview({ params }: { params: { client_id: string } }) {
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

  // Resolve the representative client_user the same way the dashboard preview
  // does, so we render with the right tier + display name.
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

  const tier = member?.tier ?? 'sprint';
  const locked = tier === 'audit_only' || tier === 'sprint';
  const headline = member?.display_name?.split(/[ ,]/)[0] || clientName.split(/[ ,]/)[0] || 'there';

  let opps: ClientFacingPrOpportunity[] = [];
  let stats: ClientPrSummary = { total: 0, awaitingMyApproval: 0, iApproved: 0, iSentForReview: 0, urgent: 0 };
  if (!locked) {
    try {
      opps = await listPrOpportunitiesForClientView(clientId, { limit: 30 });
      stats = summarizeForClient(opps);
    } catch {
      opps = [];
    }
  }

  return (
    <div>
      {/* Operator preview banner */}
      <div className="mb-4 rounded-lg border border-amber-400/40 bg-amber-400/10 px-4 py-2.5 text-sm text-amber-200 flex items-center justify-between gap-3 flex-wrap">
        <span>
          <span className="font-semibold">Operator preview</span> — {clientName}&apos;s press queue. Buttons render so you can see the layout but are read-only here (they need the client&apos;s own session).
        </span>
        <span className="shrink-0 flex items-center gap-4">
          <Link href={`/admin/av/clients/${clientId}/preview`} className="text-amber-100 hover:underline">&larr; Dashboard preview</Link>
          <Link href={`/admin/av/clients/${clientId}`} className="text-amber-100 hover:underline">Back to client</Link>
          <Link href="/admin/pr" className="text-amber-100 hover:underline">Operator PR desk &rarr;</Link>
        </span>
      </div>

      {/* Sibling preview surfaces - match the dashboard preview's nav. */}
      <div className="mb-4 flex items-center gap-2 text-xs flex-wrap">
        <span className="text-muted/70 uppercase tracking-[0.2em] text-[10px] mr-1">See what {clientName} sees:</span>
        <Link href={`/admin/av/clients/${clientId}/preview`} className="inline-flex items-center rounded-md border border-border bg-surface px-2.5 py-1 text-ink hover:border-amber-400/40 hover:text-amber-100">Dashboard</Link>
        <Link href={`/admin/av/clients/${clientId}/preview/leads`} className="inline-flex items-center rounded-md border border-border bg-surface px-2.5 py-1 text-ink hover:border-amber-400/40 hover:text-amber-100">Leads list</Link>
        <Link href={`/admin/av/clients/${clientId}/preview/audit`} className="inline-flex items-center rounded-md border border-border bg-surface px-2.5 py-1 text-ink hover:border-amber-400/40 hover:text-amber-100">Audit</Link>
        <Link href={`/admin/av/clients/${clientId}/preview/intake`} className="inline-flex items-center rounded-md border border-border bg-surface px-2.5 py-1 text-ink hover:border-amber-400/40 hover:text-amber-100">Intake / brief</Link>
        <span className="inline-flex items-center rounded-md border border-amber-400/30 bg-amber-400/5 px-2.5 py-1 text-amber-100">Press queue</span>
      </div>

      <div data-skin="social">
      <main className="max-w-6xl mx-auto px-4 py-6">
        <section
          className="mb-8 rounded-2xl border border-border overflow-hidden"
          style={{
            background:
              'linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01))'
          }}
        >
          <div className="px-6 sm:px-8 py-7">
            <div className="text-[10px] uppercase tracking-[0.22em] text-brand mb-2">Your press queue</div>
            <h1 className="text-2xl sm:text-3xl font-semibold text-ink tracking-tight">In the news for you, {headline}.</h1>
            <p className="text-muted text-sm mt-4 max-w-xl leading-relaxed">
              {locked
                ? 'Press opportunities — journalist requests + relevant stories matched to your business, with a drafted pitch in your voice for one-click approval. Unlocks on Momentum.'
                : opps.length > 0
                  ? `${opps.length} press opportunit${opps.length === 1 ? 'y' : 'ies'} matched to you${stats.urgent ? `, ${stats.urgent} urgent` : ''}. Approve, pass, or ask us to take another look — pitches are drafted in your voice and only go out with your nod.`
                  : 'When a journalist puts out a request that fits your story, we draft a pitch in your voice and surface it here for your approval.'}
            </p>
          </div>
        </section>

        {locked ? (
          <section className="rounded-2xl border border-dashed border-border bg-surface/60 p-8 text-center">
            <div className="text-3xl mb-3" aria-hidden="true">&#x1F4F0;</div>
            <h2 className="text-lg font-semibold text-ink">Press opportunities unlock on Momentum</h2>
            <p className="text-sm text-muted mt-2 max-w-md mx-auto leading-relaxed">
              {clientName} is on the <span className="text-ink font-medium">{TIER_LABEL[tier]}</span> plan. They&apos;d
              see this upgrade panel until you move them to Momentum or higher.
            </p>
          </section>
        ) : (
          <ClientPrView opps={opps} stats={stats} headline={headline} mode="preview" />
        )}
      </main>
      </div>
    </div>
  );
}
