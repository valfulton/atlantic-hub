/**
 * /admin/av/clients/[client_id]/notes  (#489)
 *
 * The operator side of the two-way notes channel — the same thread the client
 * sees at /client/notes, scoped to this brand. Opening it marks the client's
 * notes to val as read (which clears the roster + nav badges); the compose box
 * posts a note (direction operator_to_client).
 */
import { headers } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { getAvDb } from '@/lib/db/av';
import type { RowDataPacket } from 'mysql2';
import { listNotes, markThreadRead } from '@/lib/client/notes';
import NotesThread from '@/components/NotesThread';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface ClientRow extends RowDataPacket {
  client_name: string | null;
}

export default async function OperatorClientNotesPage({ params }: { params: { client_id: string } }) {
  const role = headers().get('x-ah-user-role');
  if (role !== 'owner' && role !== 'staff') redirect('/admin');

  const clientId = Number.parseInt(params.client_id, 10);
  if (!Number.isFinite(clientId) || clientId <= 0) notFound();

  const db = getAvDb();
  const [rows] = await db.execute<ClientRow[]>(
    `SELECT client_name FROM clients WHERE client_id = ? LIMIT 1`,
    [clientId]
  );
  if (!rows[0]) notFound();
  const clientName = rows[0].client_name || `Client #${clientId}`;

  // Opening the thread marks the client's notes to val as read.
  await markThreadRead(clientId, 'client_to_operator');
  const notes = await listNotes(clientId);

  return (
    <div style={{ minHeight: '100vh', background: '#0B1B2D', color: '#E7ECF3', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          background: 'rgba(11,27,45,.96)',
          backdropFilter: 'blur(8px)',
          borderBottom: '1px solid rgba(255,255,255,.1)',
          padding: '14px 16px'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Notes</h1>
          <span style={{ fontSize: 12, color: '#9FB0C7' }}>
            with <b style={{ color: 'var(--gold-bright, #C9A961)' }}>{clientName}</b>
          </span>
          <Link
            href={`/admin/av/clients/${clientId}`}
            style={{ marginLeft: 'auto', fontSize: 12, color: '#9FB0C7', textDecoration: 'none' }}
          >
            ← Back to client
          </Link>
        </div>
      </div>

      <div style={{ padding: '18px 16px 96px' }}>
        <NotesThread
          notes={notes}
          mySide="operator_to_client"
          postUrl={`/api/admin/av/clients/${clientId}/notes`}
          composePlaceholder={`Write a note to ${clientName}…`}
        />
      </div>
    </div>
  );
}
