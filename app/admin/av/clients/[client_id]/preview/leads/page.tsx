/**
 * /admin/av/clients/[client_id]/preview/leads  (#401, val 2026-06-03)
 *
 * V3 mirror of /client/leads. Renders the SAME ClientLeadCardV3 the
 * client sees, with lead-detail links routed at the operator preview
 * sibling. preview=true hides the client-only Reject control.
 *
 * Wrapped in data-skin="social" so the V3 register applies on the
 * operator route. WaveDivider import removed (kill-list).
 */
import { headers } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { getAvDb } from '@/lib/db/av';
import { findClientUserById } from '@/lib/auth/client-user';
import { listClientLeads, type ClientLead } from '@/lib/client/leads';
import ClientLeadCardV3 from '@/app/client/_components/ClientLeadCardV3';
import '@/app/client/skin.social.css';
import '@/app/client/client-social.css';
import type { RowDataPacket } from 'mysql2';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface ClientRow extends RowDataPacket { client_name: string | null }
interface MemberRow extends RowDataPacket { client_user_id: number }

export default async function ClientLeadsPreview({ params }: { params: { client_id: string } }) {
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
  const firstName = clientName.split(/[ ,]/)[0];

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
  const tier = member?.tier ?? 'sprint';
  const locked = tier === 'audit_only';

  let leads: ClientLead[] = [];
  if (!locked) {
    try {
      leads = await listClientLeads({ client_id: clientId });
    } catch {
      leads = [];
    }
  }
  const hot = leads.filter((l) => l.band === 'hot').length;

  return (
    <div>
      <div className="mb-3 rounded-lg border border-amber-400/40 bg-amber-400/10 px-4 py-2.5 text-sm text-amber-200 flex items-center justify-between gap-3 flex-wrap">
        <span>
          <span className="font-semibold">Operator preview</span> — {clientName}&apos;s leads list. Find-leads
          and reject controls are hidden here (client session required).
        </span>
        <span className="shrink-0 flex items-center gap-4">
          <Link href={`/admin/av/clients/${clientId}`} className="text-amber-100 hover:underline">Back to client</Link>
        </span>
      </div>

      <div className="mb-4 flex items-center gap-2 text-xs flex-wrap">
        <span className="text-muted/70 uppercase tracking-[0.2em] text-[10px] mr-1">See what {clientName} sees:</span>
        <Link href={`/admin/av/clients/${clientId}/preview`} className="inline-flex items-center rounded-md border border-border bg-surface px-2.5 py-1 text-ink hover:border-amber-400/40 hover:text-amber-100">Dashboard</Link>
        <span className="inline-flex items-center rounded-md border border-amber-400/30 bg-amber-400/5 px-2.5 py-1 text-amber-100">Leads list</span>
        <Link href={`/admin/av/clients/${clientId}/preview/watchlist`} className="inline-flex items-center rounded-md border border-border bg-surface px-2.5 py-1 text-ink hover:border-amber-400/40 hover:text-amber-100">Watchlist</Link>
        <Link href={`/admin/av/clients/${clientId}/preview/audit`} className="inline-flex items-center rounded-md border border-border bg-surface px-2.5 py-1 text-ink hover:border-amber-400/40 hover:text-amber-100">Audit</Link>
        <Link href={`/admin/av/clients/${clientId}/preview/intake`} className="inline-flex items-center rounded-md border border-border bg-surface px-2.5 py-1 text-ink hover:border-amber-400/40 hover:text-amber-100">Intake / brief</Link>
        <Link href={`/admin/av/clients/${clientId}/preview/pr`} className="inline-flex items-center rounded-md border border-border bg-surface px-2.5 py-1 text-ink hover:border-amber-400/40 hover:text-amber-100">Press queue</Link>
      </div>

      <div data-skin="social">
        <main className="v3-wrap" style={{ maxWidth: 980 }}>
          <header className="v3-top">
            <img src="/brand/av-monogram.png" alt="Atlantic & Vine" className="v3-top__logo" />
            <span className="v3-top__nm">Atlantic &amp; Vine</span>
          </header>

          <section className="v3-greet">
            <p className="v3-eyebrow">Your pipeline</p>
            <h1 className="v3-h1">
              Your leads, <em>{firstName}.</em>
            </h1>
            <p className="v3-lede">
              {locked
                ? 'Lead discovery unlocks on Sprint.'
                : leads.length > 0
                  ? `${leads.length} in your pipeline${hot > 0 ? `, ${hot} scored hot` : ''}. Ranked best-first.`
                  : 'We surface prospects for your business and they land here, best-first.'}
            </p>
          </section>

          {locked ? (
            <article className="v3-card">
              <h3 className="v3-card__h">Lead discovery unlocks on Sprint.</h3>
              <p className="v3-card__p">
                {clientName} is on the audit tier — they&apos;d see this until you move them up.
              </p>
            </article>
          ) : leads.length === 0 ? (
            <article className="v3-card">
              <h3 className="v3-card__h">Pipeline is warming up.</h3>
              <p className="v3-card__p">
                Leads will land here as the engine finds them, ranked best-first.
              </p>
            </article>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '14px' }}>
              {leads.map((l) => (
                <ClientLeadCardV3
                  key={l.id}
                  lead={l}
                  leadHref={l.auditId ? `/admin/av/clients/${clientId}/preview/leads/${l.auditId}` : '#'}
                  preview
                />
              ))}
            </div>
          )}

          <p className="v3-foot">Operator preview · read-only</p>
        </main>
      </div>
    </div>
  );
}
