/**
 * /client/notes  (#489)
 *
 * The client side of the two-way notes channel. A chat-style thread with val,
 * scoped to the client's active brand. Opening the page marks val's notes as
 * read; the compose box posts a reply (direction client_to_operator).
 */
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { readClientActorFromHeaders } from '@/lib/auth/client-session';
import { findClientUserById } from '@/lib/auth/client-user';
import { activeBrandFor } from '@/lib/client/active-brand';
import { listNotes, markThreadRead } from '@/lib/client/notes';
import NotesThread from '@/components/NotesThread';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function ClientNotesPage() {
  const actor = readClientActorFromHeaders(headers() as unknown as Headers);
  if (!actor) redirect('/client/login');

  const user = await findClientUserById(actor.clientUserId);
  if (!user) redirect('/client/login');

  const clientId = await activeBrandFor(actor.clientUserId, user.client_id ?? null);
  if (!clientId) {
    return (
      <div className="app-wrap">
        <section className="app-hello">
          <h1>Notes</h1>
          <p>Your account is being set up. Check back shortly.</p>
        </section>
      </div>
    );
  }

  // Opening the thread marks val's notes to this client as read.
  await markThreadRead(clientId, 'operator_to_client');
  const notes = await listNotes(clientId);

  return (
    <div className="app-wrap">
      <section className="app-hello">
        <h1>Notes</h1>
        <p>Message your Atlantic &amp; Vine team. Everything here is kept and timestamped.</p>
      </section>
      <NotesThread
        notes={notes}
        mySide="client_to_operator"
        postUrl="/api/client/notes"
        composePlaceholder="Write a note to your team…"
      />
    </div>
  );
}
