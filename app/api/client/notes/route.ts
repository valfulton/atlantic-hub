/**
 * POST /api/client/notes   { body }
 *
 * A logged-in client posts a note to their operator (direction
 * client_to_operator). The brand scope is resolved server-side from the
 * session + active-brand cookie; author_email is the client's own email.
 * direction is fixed here — never taken from the request.
 */
import { NextRequest, NextResponse } from 'next/server';
import { readClientActorFromHeaders } from '@/lib/auth/client-session';
import { findClientUserById } from '@/lib/auth/client-user';
import { activeBrandFor } from '@/lib/client/active-brand';
import { postNote } from '@/lib/client/notes';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const actor = readClientActorFromHeaders(req.headers);
  if (!actor) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const user = await findClientUserById(actor.clientUserId);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const clientId = await activeBrandFor(actor.clientUserId, user.client_id ?? null);
  if (!clientId) return NextResponse.json({ error: 'no client scope' }, { status: 403 });

  let payload: { body?: unknown } = {};
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const body = typeof payload.body === 'string' ? payload.body : '';
  if (!body.trim()) return NextResponse.json({ error: 'empty' }, { status: 400 });

  const noteId = await postNote({
    clientId,
    direction: 'client_to_operator',
    authorEmail: user.email,
    body
  });
  if (!noteId) return NextResponse.json({ error: 'could not save' }, { status: 500 });

  return NextResponse.json({ ok: true, noteId });
}
