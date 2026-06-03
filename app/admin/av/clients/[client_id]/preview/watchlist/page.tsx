/**
 * /admin/av/clients/[client_id]/preview/watchlist  (#385, val 2026-06-03)
 *
 * Operator's preview-as-client mirror of /client/watchlist. Val opens this
 * route to confirm exactly what Adriana sees on her watchlist — without
 * needing to log in as Adriana. Per the mirror-every-client-page rule.
 *
 * NOTE on live data: the panel renders in mode='client', which hits the
 * /api/client/distress endpoints. Those endpoints check the client-session
 * cookie — when val (operator) is on this preview page, those XHRs will 401.
 * The preview is for layout + copy verification; for live data flow val uses
 * the operator-mode panel on /admin/av/clients/[id].
 */
import { headers } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import { getAvDb } from '@/lib/db/av';
import type { RowDataPacket } from 'mysql2';
import DistressWatchlistPanel from '@/app/admin/av/clients/[client_id]/DistressWatchlistPanel';

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
  const [rows] = await db.execute<ClientRow[]>(
    `SELECT client_name FROM clients WHERE client_id = ? LIMIT 1`,
    [clientId]
  );
  if (!rows[0]) notFound();
  const clientName = rows[0].client_name || `Client #${clientId}`;

  return (
    <main className="max-w-5xl mx-auto px-6 py-8">
      <div className="mb-5 text-[11px] uppercase tracking-[0.18em] text-muted">
        Preview as client · {clientName}
      </div>
      <h1 className="text-xl font-semibold text-ink mb-1">Watchlist mirror</h1>
      <p className="text-[12px] text-muted mb-6 leading-relaxed max-w-2xl">
        This renders the client-side Watchlist panel exactly as {clientName} sees it at{' '}
        <code className="text-ink">/client/watchlist</code>. Layout + copy are verified here; live data flow
        requires a real client session (their cookie scope can&apos;t cross over to an operator session).
      </p>
      <DistressWatchlistPanel clientId={clientId} clientName={clientName} mode="client" />
    </main>
  );
}
