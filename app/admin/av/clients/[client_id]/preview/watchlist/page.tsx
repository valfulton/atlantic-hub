/**
 * /admin/av/clients/[client_id]/preview/watchlist  (#398, val 2026-06-03)
 *
 * V3 mirror of /client/watchlist. Renders the SAME ClientWatchlistV3 body
 * the client sees, with server-rendered initialRows (operator session
 * can't hit /api/client/* and would 401) and preview=true (disables
 * Draft + Add to pipeline so val doesn't accidentally trigger client-side
 * writes from the operator surface).
 *
 * The body itself is identical to the live client view — it cannot drift.
 * Wraps in <div data-skin="social"> so the V3 CSS scopes hit on the
 * operator route, with the navy skin + component CSS imported here too.
 */
import { headers } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { getAvDb } from '@/lib/db/av';
import type { RowDataPacket } from 'mysql2';
import { watchlistForClient } from '@/lib/public_intel/distress_engine';
import ClientWatchlistV3, { type ClientWatchlistRow } from '@/app/client/_components/ClientWatchlistV3';
import '@/app/client/skin.social.css';
import '@/app/client/client-social.css';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ClientRow extends RowDataPacket {
  client_name: string | null;
}

export default async function PreviewWatchlistMirror({ params }: { params: { client_id: string } }) {
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

  // Server-render the watchlist (operator-auth works here; client-API would 401).
  const rawRows = await watchlistForClient(clientId, 25);
  const initialRows: ClientWatchlistRow[] = rawRows.map((r) => ({
    entityKey: r.entityKey,
    entityLabel: r.entityLabel,
    regionCode: r.regionCode,
    score: r.score,
    contributingSignals: r.contributingSignals,
    firstSeenAt: r.firstSeenAt instanceof Date ? r.firstSeenAt.toISOString() : String(r.firstSeenAt),
    lastRecomputedAt: r.lastRecomputedAt instanceof Date ? r.lastRecomputedAt.toISOString() : String(r.lastRecomputedAt),
    lastAction: r.lastAction,
    lastActedAt: r.lastActedAt instanceof Date ? r.lastActedAt.toISOString() : (r.lastActedAt ?? null)
  }));

  return (
    <div>
      {/* Operator preview banner */}
      <div className="mb-3 rounded-lg border border-amber-400/40 bg-amber-400/10 px-4 py-2.5 text-sm text-amber-200 flex items-center justify-between gap-3 flex-wrap">
        <span>
          <span className="font-semibold">Operator preview</span> — this is{' '}
          <span className="font-semibold">{clientName}</span>&apos;s watchlist, exactly as they see it.
          Draft + Add to pipeline are read-only here; use your own panel on the client page to take action.
        </span>
        <span className="shrink-0 flex items-center gap-4">
          <Link href={`/admin/av/clients/${clientId}`} className="text-amber-100 hover:underline">Back to client</Link>
        </span>
      </div>

      {/* Sibling preview surfaces */}
      <div className="mb-4 flex items-center gap-2 text-xs flex-wrap">
        <span className="text-muted/70 uppercase tracking-[0.2em] text-[10px] mr-1">See what {clientName} sees:</span>
        <Link href={`/admin/av/clients/${clientId}/preview`} className="inline-flex items-center rounded-md border border-border bg-surface px-2.5 py-1 text-ink hover:border-amber-400/40 hover:text-amber-100">Dashboard</Link>
        <Link href={`/admin/av/clients/${clientId}/preview/leads`} className="inline-flex items-center rounded-md border border-border bg-surface px-2.5 py-1 text-ink hover:border-amber-400/40 hover:text-amber-100">Leads list</Link>
        <span className="inline-flex items-center rounded-md border border-amber-400/30 bg-amber-400/5 px-2.5 py-1 text-amber-100">Watchlist</span>
        <Link href={`/admin/av/clients/${clientId}/preview/audit`} className="inline-flex items-center rounded-md border border-border bg-surface px-2.5 py-1 text-ink hover:border-amber-400/40 hover:text-amber-100">Audit</Link>
        <Link href={`/admin/av/clients/${clientId}/preview/intake`} className="inline-flex items-center rounded-md border border-border bg-surface px-2.5 py-1 text-ink hover:border-amber-400/40 hover:text-amber-100">Intake / brief</Link>
        <Link href={`/admin/av/clients/${clientId}/preview/pr`} className="inline-flex items-center rounded-md border border-border bg-surface px-2.5 py-1 text-ink hover:border-amber-400/40 hover:text-amber-100">Press queue</Link>
      </div>

      {/* V3 body — wrapped in data-skin="social" so the navy register applies on the operator route. */}
      <div data-skin="social">
        <main className="v3-wrap">
          <header className="v3-top">
            <img src="/brand/av_logo_white1152.png" alt="Atlantic & Vine" className="v3-top__logo" />
            <span className="v3-top__nm">Atlantic &amp; Vine</span>
          </header>

          <section className="v3-greet">
            <p className="v3-eyebrow">Your watchlist</p>
            <h1 className="v3-h1">
              Who&apos;s about to need you, <em>{firstName}.</em>
            </h1>
            <p className="v3-lede">
              Businesses showing public signals of distress, ranked every morning. Open one to see who
              they are and how to reach out.
            </p>
          </section>

          <ClientWatchlistV3 initialRows={initialRows} preview />

          <p className="v3-foot">QUIET · LEGIBLE · VERIFIABLE</p>
        </main>
      </div>
    </div>
  );
}
