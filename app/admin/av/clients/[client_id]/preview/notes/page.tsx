/**
 * /admin/av/clients/[client_id]/preview/notes  (val 2026-06-09)
 *
 * Operator mirror for /client/notes — the two-way notes thread (#489) val sees
 * when she opens a client account, identical to what the client sees in their
 * portal. Required by the mirror-every-client-surface rule
 * (Atlantic_Hub_Playbook/Mirror_Pattern.md).
 *
 * Why this is read-only-ish:
 *   - The thread renders identically (NotesThread with mySide='client_to_operator').
 *   - Posting from this surface would hit /api/client/notes which expects a
 *     client cookie — preview operators can't post from here. To post AS val,
 *     she uses the operator-side notes editor on the client detail page.
 *   - markThreadRead is NOT called from preview — we don't want the operator
 *     opening the preview to silently mark the CLIENT'S notes as read.
 */
import { headers } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import { getAvDb } from '@/lib/db/av';
import { listNotes } from '@/lib/client/notes';
import NotesThread from '@/components/NotesThread';
import OperatorPreviewChrome from '@/app/admin/av/clients/[client_id]/preview/_components/OperatorPreviewChrome';
// Cream client-app design system — preview routes don't pass through
// app/client/layout.tsx, so we import the canonical styles directly.
import '@/app/client/_styles/app.css';
import type { RowDataPacket } from 'mysql2';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface ClientRow extends RowDataPacket {
  client_name: string | null;
}

export default async function ClientNotesPreview({ params }: { params: { client_id: string } }) {
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

  const notes = await listNotes(clientId);

  return (
    <div>
      <OperatorPreviewChrome
        clientId={clientId}
        clientName={clientName}
        active="dashboard"
        bannerLine={
          <>
            Read-only mirror of <code>/client/notes</code>.{' '}
            To post a note <em>as</em> val, use the operator notes editor on the client detail page.
          </>
        }
      />
      <div className="app">
        <div className="app-wrap">
          <section className="app-hello">
            <h1>Notes</h1>
            <p>
              Message your Atlantic &amp; Vine team. Everything here is kept and timestamped.
            </p>
          </section>
          <NotesThread
            notes={notes}
            mySide="client_to_operator"
            postUrl="/api/client/notes"
            composePlaceholder="Write a note to your team…"
          />
        </div>
      </div>
    </div>
  );
}
