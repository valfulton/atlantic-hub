/**
 * POST /api/client/intake/social/connect-start  (#45 Phase C)
 *
 * Client-side OAuth start for the intake-form popup flow. Body: { targetId }.
 * Auth via the share token in the `x-intake-share-token` header.
 *
 * The share token NEVER hits the URL -- it's validated here, then the state
 * cookie carries the resolved brand + target ids (not the token itself) so the
 * popup window can safely navigate to LinkedIn directly. The OAuth callback
 * trusts the state cookie's intake bag (per lib/social/handlers.ts).
 *
 * Returns { authorizeUrl }. Caller window.open()s that URL in a popup; the
 * callback eventually postMessage's `av:oauth:done` back to window.opener.
 */
import { NextRequest, NextResponse } from 'next/server';
import { headers as nextHeaders } from 'next/headers';
import { resolveScopeFromRequest } from '@/lib/auth/intake-share-scope';
import { getTargetById } from '@/lib/social/targets';
import {
  PROVIDER_CONFIG,
  STATE_COOKIE,
  STATE_TTL_SECONDS,
  clientCredentials,
  codeChallengeS256,
  encodeStateBag,
  makeCodeVerifier,
  makeState,
  redirectUri
} from '@/lib/social/oauth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  let body: { targetId?: unknown } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const targetId = typeof body.targetId === 'number' ? body.targetId : Number.parseInt(String(body.targetId ?? ''), 10);
  if (!Number.isFinite(targetId) || targetId <= 0) {
    return NextResponse.json({ error: 'invalid target id' }, { status: 400 });
  }

  // Resolve the share-token scope first. We pass the target's brand as the
  // requested brand so scope resolution validates the target is in scope.
  const target = await getTargetById(targetId);
  if (!target) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (target.clientId == null) {
    return NextResponse.json({ error: 'target has no brand scope' }, { status: 400 });
  }
  const scope = await resolveScopeFromRequest(nextHeaders(), target.clientId);
  if (!scope) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (scope.clientId !== target.clientId) {
    return NextResponse.json({ error: 'wrong brand' }, { status: 403 });
  }

  // Phase C only supports LinkedIn in-intake. X/IG/FB/etc. come later when we
  // have the respective company-asset OAuth paths.
  if (target.provider !== 'linkedin') {
    return NextResponse.json({ error: 'provider not yet connectable from intake' }, { status: 400 });
  }
  const provider = 'linkedin' as const;
  const cfg = PROVIDER_CONFIG[provider];
  const creds = clientCredentials(provider);
  if (!creds.id || !creds.secret) {
    return NextResponse.json({ error: 'oauth not configured' }, { status: 500 });
  }

  const state = makeState();
  const verifier = cfg.usesPkce ? makeCodeVerifier() : undefined;

  const authorize = new URL(cfg.authorizeUrl);
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('client_id', creds.id);
  authorize.searchParams.set('redirect_uri', redirectUri(provider));
  authorize.searchParams.set('state', state);
  authorize.searchParams.set('scope', cfg.scopes.join(' '));
  if (verifier) {
    authorize.searchParams.set('code_challenge', codeChallengeS256(verifier));
    authorize.searchParams.set('code_challenge_method', 'S256');
  }

  const bag = encodeStateBag({
    state,
    provider,
    tenant: `client:${scope.clientId}`,
    verifier,
    uid: 0,
    ts: Math.floor(Date.now() / 1000),
    kind: 'intake',
    clientId: scope.clientId,
    targetId
  });

  const res = NextResponse.json({ ok: true, authorizeUrl: authorize.toString() });
  res.cookies.set(STATE_COOKIE, bag, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: STATE_TTL_SECONDS
  });
  return res;
}
