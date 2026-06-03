/**
 * /admin/av/clients/[client_id]/preview/watchlist  (#385/#389, val 2026-06-03)
 *
 * Operator's preview-as-client mirror of /client/watchlist. Renders the SAME
 * DistressWatchlistPanel Adriana sees, with server-rendered initial data so
 * val gets a real watchlist view (not a 401 placeholder).
 *
 * Chrome matches the rest of the preview pages (dashboard / leads / audit /
 * intake / pr) — same operator banner, same tab strip with Watchlist
 * highlighted.
 *
 * Draft / Promote-to-lead buttons inside the panel will 401 in this preview
 * because they POST to /api/client/* (client-session-gated). That's expected
 * — the operator has her own write surface on the main client page. The
 * preview is for "what does Adriana see when she logs in," not for action.
 */
import { headers } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { getAvDb } from '@/lib/db/av';
import type { RowDataPacket } from 'mysql2';
import { watchlistForClient } from '@/lib/public_intel/distress_engine';
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
  const [crows] = await db.execute<ClientRow[]>(
    `SELECT client_name FROM clients WHERE client_id = ? LIMIT 1`,
    [clientId]
  );
  if (!crows[0]) notFound();
  const clientName = crows[0].client_name || `Client #${clientId}`;

  // (#389) Server-render the watchlist. operatorsAuth works here; the panel
  // gets data without ever hitting the client-session-gated API.
  const rawRows = await watchlistForClient(clientId, 25);
  // Convert Date fields to ISO strings for the client component boundary.
  const initialRows = rawRows.map((r) => ({
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
      {/* Operator preview banner — same shape as the dashboard / leads / etc. mirrors. */}
      <div className="mb-3 rounded-lg border border-amber-400/40 bg-amber-400/10 px-4 py-2.5 text-sm text-amber-200 flex items-center justify-between gap-3 flex-wrap">
        <span>
          <span className="font-semibold">Operator preview</span> — this is{' '}
          <span className="font-semibold">{clientName}</span>&apos;s watchlist exactly as they see it. Draft + Add to pipeline buttons inside route to the client&apos;s session; use your own panel on the client page to take action.
        </span>
        <span className="shrink-0 flex items-center gap-4">
          <Link href={`/admin/av/clients/${clientId}`} className="text-amber-100 hover:underline">Back to client</Link>
        </span>
      </div>

      {/* Sibling preview surfaces — Watchlist is the active tab here. */}
      <div className="mb-4 flex items-center gap-2 text-xs flex-wrap">
        <span className="text-muted/70 uppercase tracking-[0.2em] text-[10px] mr-1">See what {clientName} sees:</span>
        <Link href={`/admin/av/clients/${clientId}/preview`} className="inline-flex items-center rounded-md border border-border bg-surface px-2.5 py-1 text-ink hover:border-amber-400/40 hover:text-amber-100">Dashboard</Link>
        <Link href={`/admin/av/clients/${clientId}/preview/leads`} className="inline-flex items-center rounded-md border border-border bg-surface px-2.5 py-1 text-ink hover:border-amber-400/40 hover:text-amber-100">Leads list</Link>
        <span className="inline-flex items-center rounded-md border border-amber-400/30 bg-amber-400/5 px-2.5 py-1 text-amber-100">Watchlist</span>
        <Link href={`/admin/av/clients/${clientId}/preview/audit`} className="inline-flex items-center rounded-md border border-border bg-surface px-2.5 py-1 text-ink hover:border-amber-400/40 hover:text-amber-100">Audit</Link>
        <Link href={`/admin/av/clients/${clientId}/preview/intake`} className="inline-flex items-center rounded-md border border-border bg-surface px-2.5 py-1 text-ink hover:border-amber-400/40 hover:text-amber-100">Intake / brief</Link>
        <Link href={`/admin/av/clients/${clientId}/preview/pr`} className="inline-flex items-center rounded-md border border-border bg-surface px-2.5 py-1 text-ink hover:border-amber-400/40 hover:text-amber-100">Press queue</Link>
      </div>

      {/* (#390) Flex to screen size — no fixed max-width that traps the panel
          to a narrow strip on wide monitors. */}
      <div className="w-full">
        <DistressWatchlistPanel
          clientId={clientId}
          clientName={clientName}
          mode="client"
          initialRows={initialRows}
          startOpen
        />
      </div>
    </div>
  );
}
