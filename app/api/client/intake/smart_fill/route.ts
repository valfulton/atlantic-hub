/**
 * POST /api/client/intake/smart_fill  (#582, val 2026-06-10)
 *
 * Client-facing smart-fill: a logged-in client_user pastes a paragraph from
 * their company's about page / press release / book pitch and gets the brief
 * partial back. Used by /client/intake.
 *
 * Auth: standard client-session cookie, validated via readClientActorFromHeaders.
 * The clientId is the actor's own scope — we never let a client pass an
 * arbitrary clientId for cost reporting.
 *
 * Public marketing-site smart-fill (used by atlanticandvine.netlify.app/audit)
 * goes through this route too — the CORS layer + the actor check both validate.
 * For unauthenticated marketing audits, see /api/public/smart_fill (TODO).
 */
import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { readClientActorFromHeaders } from '@/lib/auth/client-session';
import { findClientUserById } from '@/lib/auth/client-user';
import { smartFillFromParagraph } from '@/lib/av/smart_fill';
import { isEngagementKind } from '@/lib/client/engagement_kind';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const actor = readClientActorFromHeaders(headers() as unknown as Headers);
  if (!actor) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const user = await findClientUserById(actor.clientUserId);
  if (!user) return NextResponse.json({ error: 'unknown user' }, { status: 401 });

  let body: { paragraph?: unknown; hintKind?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const paragraph = typeof body.paragraph === 'string' ? body.paragraph : '';
  if (!paragraph.trim()) {
    return NextResponse.json({ error: 'paragraph required' }, { status: 400 });
  }
  const hintKind = isEngagementKind(body.hintKind) ? body.hintKind : null;

  try {
    const result = await smartFillFromParagraph({
      paragraph,
      // Scope cost reporting to the client's own brand.
      clientId: user.client_id ?? null,
      hintKind
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: 'server error', errorClass: (err as Error).name, errorMessage: (err as Error).message },
      { status: 500 }
    );
  }
}
