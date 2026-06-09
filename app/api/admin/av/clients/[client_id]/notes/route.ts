/**
 * POST /api/admin/av/clients/[client_id]/notes   { body }
 *
 * The operator (val) posts a note to a client (direction operator_to_client).
 * Owner/staff only — same gate as the other /api/admin/av routes.
 * author_email is the operator's email; direction is fixed here.
 */
import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { postNote } from '@/lib/client/notes';

export const runtime = 'nodejs';

function operatorEmail(): string {
  return headers().get('x-ah-user-email') || headers().get('x-ah-user-role') || 'operator';
}

export async function POST(req: NextRequest, { params }: { params: { client_id: string } }) {
  const role = headers().get('x-ah-user-role');
  if (role !== 'owner' && role !== 'staff') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const clientId = Number.parseInt(params.client_id, 10);
  if (!Number.isFinite(clientId) || clientId <= 0) {
    return NextResponse.json({ error: 'invalid client id' }, { status: 400 });
  }

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
    direction: 'operator_to_client',
    authorEmail: operatorEmail(),
    body
  });
  if (!noteId) return NextResponse.json({ error: 'could not save' }, { status: 500 });

  return NextResponse.json({ ok: true, noteId });
}
