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
import { getAvDb } from '@/lib/db/av';
import type { RowDataPacket } from 'mysql2';
import { watchlistForClient } from '@/lib/public_intel/distress_engine';
import ClientWatchlistV3, { type ClientWatchlistRow } from '@/app/client/_components/ClientWatchlistV3';
import ClientV3TopNav from '@/app/client/_components/ClientV3TopNav';
import OperatorPreviewChrome from '@/app/admin/av/clients/[client_id]/preview/_components/OperatorPreviewChrome';
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
      <OperatorPreviewChrome
        clientId={clientId}
        clientName={clientName}
        active="watchlist"
        bannerLine={<>Draft + Add to pipeline are read-only here.</>}
      />

      {/* V3 body — wrapped in data-skin="social" so the navy register applies on the operator route. */}
      <div data-skin="social">
        <main className="v3-wrap" style={{ maxWidth: 1200 }}>
          <ClientV3TopNav preview />

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
