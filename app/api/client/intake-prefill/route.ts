/**
 * GET /api/client/intake-prefill?t=<token>
 *
 * PUBLIC, CORS-enabled. Returns a client's saved intake answers so the website
 * intake form (client-intake.html) can PREFILL itself — the client opens a link,
 * sees their info already filled, reviews/completes, and submits as normal.
 *
 * Authorized only by the signed share token (lib/auth/intake-share). Returns the
 * brief payload keyed by the form's own field names (company, contact_name,
 * key_message, pr_expert_topics, ...). Internal markers are stripped.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyIntakeShareToken } from '@/lib/auth/intake-share';
import { getBriefPayload } from '@/lib/client/brief_store';
import { corsHeadersFor } from '@/lib/auth/client-cors';

export const runtime = 'nodejs';
export const maxDuration = 20;

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeadersFor(req.headers.get('origin')) });
}

export async function GET(req: NextRequest) {
  const cors = corsHeadersFor(req.headers.get('origin'));
  const token = req.nextUrl.searchParams.get('t') || '';
  const clientId = await verifyIntakeShareToken(token);
  if (!clientId) {
    return NextResponse.json({ ok: false, error: 'invalid or expired link' }, { status: 401, headers: cors });
  }

  let payload: Record<string, unknown> = {};
  try {
    payload = ((await getBriefPayload('av', clientId)) as Record<string, unknown>) ?? {};
  } catch {
    payload = {};
  }

  // Strip internal/operator-only markers — never send these to the form.
  const {
    client_completed_at: _a,
    portal_full_access: _b,
    intel_posture: _c,
    default_voice: _d,
    ...fields
  } = payload;

  return NextResponse.json({ ok: true, fields }, { headers: cors });
}
