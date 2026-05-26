/**
 * POST /api/client/intake-form   { token, payload }
 *
 * PUBLIC, no-login submit for the prefilled share-intake (lib/auth/intake-share).
 * Authorized purely by the signed token in the body — no session required. Saves
 * the client's answers to their brief and stamps completion. NOT in the
 * middleware matcher, so it's reachable without a portal session.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyIntakeShareToken } from '@/lib/auth/intake-share';
import { saveBriefPayload, type BriefPayload } from '@/lib/client/brief_store';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  let body: { token?: unknown; payload?: unknown } = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }

  const token = typeof body.token === 'string' ? body.token : '';
  const clientId = await verifyIntakeShareToken(token);
  if (!clientId) return NextResponse.json({ error: 'this link is invalid or expired' }, { status: 401 });

  if (!body.payload || typeof body.payload !== 'object' || Array.isArray(body.payload)) {
    return NextResponse.json({ error: 'payload must be an object' }, { status: 400 });
  }

  try {
    const payload = body.payload as Record<string, unknown>;
    payload.client_completed_at = new Date().toISOString();
    const ok = await saveBriefPayload('av', clientId, payload as BriefPayload, {
      source: 'client_intake',
      changedBy: 'intake_share'
    });
    if (!ok) return NextResponse.json({ error: 'save failed' }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}
