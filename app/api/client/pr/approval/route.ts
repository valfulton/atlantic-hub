/**
 * POST /api/client/pr/approval  { pitchId, decision, note? }  (#220)
 *
 * The client portal's single mutation endpoint for PR pitches:
 * decision = 'approved' | 'declined' | 'review_requested'.
 *
 * Authentication: middleware checks the ah_client_session cookie and sets
 * x-ah-client-user-id; we resolve the user, look up their client_id, then
 * pass that to recordClientApproval which double-scopes the write so a
 * client can only act on a pitch tied to a lead they own.
 *
 * Multi-brand (#101): the brand-switcher governs which client_id the rest
 * of the portal is viewing; we use activeBrandFor here for the same reason
 * /client/leads does.
 */
import { NextRequest, NextResponse } from 'next/server';
import { readClientActorFromHeaders } from '@/lib/auth/client-session';
import { findClientUserById } from '@/lib/auth/client-user';
import { activeBrandFor } from '@/lib/client/active-brand';
import { recordClientApproval, type ClientApproval } from '@/lib/pr/client_pr_actions';

export const runtime = 'nodejs';
export const maxDuration = 15;

const VALID: ClientApproval[] = ['approved', 'declined', 'review_requested'];

export async function POST(req: NextRequest) {
  const actor = readClientActorFromHeaders(req.headers);
  if (!actor) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const user = await findClientUserById(actor.clientUserId);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const clientId = await activeBrandFor(actor.clientUserId, user.client_id ?? null);
  if (!clientId) return NextResponse.json({ error: 'no client scope' }, { status: 403 });

  let body: { pitchId?: unknown; decision?: unknown; note?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const pitchId = Number.parseInt(String(body.pitchId ?? ''), 10);
  if (!Number.isFinite(pitchId) || pitchId <= 0) {
    return NextResponse.json({ error: 'invalid pitchId' }, { status: 400 });
  }
  const decision = String(body.decision ?? '') as ClientApproval;
  if (!VALID.includes(decision)) {
    return NextResponse.json({ error: 'invalid decision' }, { status: 400 });
  }
  const note = typeof body.note === 'string' ? body.note : null;

  try {
    const result = await recordClientApproval({
      clientId,
      clientUserId: actor.clientUserId,
      pitchId,
      decision,
      note
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ ok: true, pitchId: result.pitchId, decision });
  } catch (err) {
    console.error('[client:pr:approval]', (err as Error).message);
    return NextResponse.json(
      { error: 'server error', errorClass: (err as Error).name },
      { status: 500 }
    );
  }
}
