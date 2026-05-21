/**
 * lib/social/handlers.ts
 *
 * The OAuth connect-flow handlers shared by the per-provider route files.
 *   handleOAuthStart    -> guarded; builds the authorize URL + state cookie
 *   handleOAuthCallback -> validates the state cookie, exchanges the code,
 *                          stores the connection
 *
 * AUTH MODEL
 *   /start is hit by a same-site navigation, so the operator session cookie
 *   is present and we guard it with guardAdminRequest (owner/staff only).
 *   /callback is hit by a cross-site top-level redirect from the provider,
 *   so the SameSite=Strict session cookie is NOT sent. Instead the callback
 *   trusts the short-lived httpOnly + SameSite=Lax state cookie that /start
 *   set: it carries the acting userId and could only have been created by an
 *   authenticated operator. middleware.ts lets the /callback path through for
 *   this reason; every other social route stays fully guarded.
 *
 * Both handlers return a tiny HTML page that closes the popup window (when
 * the flow was opened in one) or falls back to a full-page redirect to
 * /admin/social. No token value is ever logged.
 */

import { NextRequest, NextResponse } from 'next/server';
import type { ResultSetHeader } from 'mysql2';
import { guardAdminRequest } from '@/lib/api-guard';
import { getAvDb } from '@/lib/db/av';
import { encryptToken } from './encrypt';
import { completeOAuth } from './providers';
import {
  PROVIDER_CONFIG,
  STATE_COOKIE,
  STATE_TTL_SECONDS,
  clientCredentials,
  codeChallengeS256,
  decodeStateBag,
  encodeStateBag,
  makeCodeVerifier,
  makeState,
  normalizeTenant,
  redirectUri,
  type SocialProvider
} from './oauth';

const COOKIE_BASE = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const, // lax so the cookie survives the provider's top-level redirect back
  path: '/'
};

/**
 * Return an HTML page that, if opened in a popup, notifies the opener and
 * closes itself; otherwise it redirects the full page to /admin/social with
 * the same query. `query` is a short ASCII string like "connected=linkedin"
 * or "oauth_error=state_expired".
 */
function finish(req: NextRequest, query: string): NextResponse {
  const target = new URL(`/admin/social?${query}`, req.nextUrl.origin).toString();
  const html =
    '<!doctype html><html><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Finishing connection</title></head>' +
    '<body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;' +
    'background:#0b0f14;color:#cbd5e1;font-family:system-ui,-apple-system,sans-serif">' +
    '<div style="text-align:center"><div style="font-size:14px;opacity:.8">Finishing up...</div></div>' +
    '<script>(function(){var q=' +
    JSON.stringify(query) +
    ';try{if(window.opener&&!window.opener.closed){' +
    'window.opener.postMessage({source:"social-oauth",query:q},window.location.origin);' +
    'window.close();return;}}catch(e){}' +
    'window.location.replace(' +
    JSON.stringify(target) +
    ');})();</script></body></html>';
  return new NextResponse(html, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }
  });
}

export async function handleOAuthStart(
  req: NextRequest,
  provider: SocialProvider
): Promise<NextResponse> {
  const guard = await guardAdminRequest(req, {
    targetResource: `/api/admin/social/oauth/${provider}/start`
  });
  if (!guard.ok) return finish(req, 'oauth_error=forbidden');
  if (guard.actor.role === 'client_user') return finish(req, 'oauth_error=forbidden');

  const cfg = PROVIDER_CONFIG[provider];
  const creds = clientCredentials(provider);
  if (!creds.id || !creds.secret) return finish(req, 'oauth_error=missing_client_config');

  const tenant = normalizeTenant(req.nextUrl.searchParams.get('tenant'));
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
    tenant,
    verifier,
    uid: guard.actor.userId,
    ts: Math.floor(Date.now() / 1000)
  });

  const res = NextResponse.redirect(authorize.toString());
  res.cookies.set(STATE_COOKIE, bag, { ...COOKIE_BASE, maxAge: STATE_TTL_SECONDS });
  return res;
}

export async function handleOAuthCallback(
  req: NextRequest,
  provider: SocialProvider
): Promise<NextResponse> {
  // No guardAdminRequest here: the session cookie is not sent on this
  // cross-site return. Actor identity comes from the signed-by-possession
  // state cookie validated below.
  const params = req.nextUrl.searchParams;
  const providerError = params.get('error');
  if (providerError) {
    return finish(req, `oauth_error=${encodeURIComponent(providerError.slice(0, 60))}`);
  }

  const code = params.get('code');
  const returnedState = params.get('state');
  if (!code || !returnedState) return finish(req, 'oauth_error=missing_code');

  const bag = decodeStateBag(req.cookies.get(STATE_COOKIE)?.value);
  if (!bag) return finish(req, 'oauth_error=state_expired');
  if (bag.provider !== provider) return finish(req, 'oauth_error=state_provider_mismatch');
  if (bag.state !== returnedState) return finish(req, 'oauth_error=state_mismatch');
  if (!Number.isInteger(bag.uid) || bag.uid <= 0) return finish(req, 'oauth_error=bad_state');

  let res: NextResponse;
  try {
    const result = await completeOAuth(provider, code, bag.verifier);

    const accessEnc = encryptToken(result.accessToken);
    const refreshEnc = result.refreshToken ? encryptToken(result.refreshToken) : null;

    const db = getAvDb();
    await db.execute<ResultSetHeader>(
      `INSERT INTO social_connections
         (tenant_id, provider, provider_account_id, display_name, avatar_url, scopes_json,
          access_token_enc, refresh_token_enc, access_token_expires_at, refresh_token_expires_at,
          status, last_error, connected_by_user_id, connected_at, last_used_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', NULL, ?, NOW(), NULL)
       ON DUPLICATE KEY UPDATE
          display_name = VALUES(display_name),
          avatar_url = VALUES(avatar_url),
          scopes_json = VALUES(scopes_json),
          access_token_enc = VALUES(access_token_enc),
          refresh_token_enc = VALUES(refresh_token_enc),
          access_token_expires_at = VALUES(access_token_expires_at),
          refresh_token_expires_at = VALUES(refresh_token_expires_at),
          status = 'active',
          last_error = NULL,
          connected_by_user_id = VALUES(connected_by_user_id),
          connected_at = NOW()`,
      [
        bag.tenant,
        provider,
        result.providerAccountId,
        result.displayName,
        result.avatarUrl,
        JSON.stringify(result.scopes),
        accessEnc,
        refreshEnc,
        result.accessTokenExpiresAt,
        result.refreshTokenExpiresAt,
        bag.uid
      ]
    );

    res = finish(req, `connected=${provider}`);
  } catch (err) {
    // err.message is token-free (providers.ts truncates + omits secrets)
    console.error(`[social:oauth:${provider}:callback]`, (err as Error).name, (err as Error).message);
    res = finish(req, 'oauth_error=exchange_failed');
  }

  res.cookies.set(STATE_COOKIE, '', { ...COOKIE_BASE, maxAge: 0 }); // one-time use
  return res;
}
