/**
 * lib/social/handlers.ts
 *
 * The OAuth connect-flow handlers shared by the per-provider route files.
 *   handleOAuthStart    -> builds the authorize URL + sets the state cookie
 *   handleOAuthCallback -> validates state, exchanges code, stores connection
 *
 * Both guard with guardAdminRequest (owner/staff only; client_user is
 * rejected). On any failure they redirect back to /admin/social with an
 * oauth_error query param rather than returning JSON, since these routes
 * are hit by top-level browser navigation. No token value is ever logged.
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

function backTo(req: NextRequest, query: string): NextResponse {
  return NextResponse.redirect(new URL(`/admin/social?${query}`, req.nextUrl.origin));
}

const COOKIE_BASE = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const, // lax so the cookie survives the provider's top-level redirect back
  path: '/'
};

export async function handleOAuthStart(
  req: NextRequest,
  provider: SocialProvider
): Promise<NextResponse> {
  const guard = await guardAdminRequest(req, {
    targetResource: `/api/admin/social/oauth/${provider}/start`
  });
  if (!guard.ok) return backTo(req, 'oauth_error=forbidden');
  if (guard.actor.role === 'client_user') return backTo(req, 'oauth_error=forbidden');

  const cfg = PROVIDER_CONFIG[provider];
  const creds = clientCredentials(provider);
  if (!creds.id || !creds.secret) return backTo(req, `oauth_error=missing_client_config`);

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
  const guard = await guardAdminRequest(req, {
    targetResource: `/api/admin/social/oauth/${provider}/callback`
  });
  if (!guard.ok) return backTo(req, 'oauth_error=forbidden');
  if (guard.actor.role === 'client_user') return backTo(req, 'oauth_error=forbidden');

  const params = req.nextUrl.searchParams;
  const providerError = params.get('error');
  if (providerError) {
    return backTo(req, `oauth_error=${encodeURIComponent(providerError.slice(0, 60))}`);
  }

  const code = params.get('code');
  const returnedState = params.get('state');
  if (!code || !returnedState) return backTo(req, 'oauth_error=missing_code');

  const bag = decodeStateBag(req.cookies.get(STATE_COOKIE)?.value);
  if (!bag) return backTo(req, 'oauth_error=state_expired');
  if (bag.provider !== provider) return backTo(req, 'oauth_error=state_provider_mismatch');
  if (bag.state !== returnedState) return backTo(req, 'oauth_error=state_mismatch');
  if (bag.uid !== guard.actor.userId) return backTo(req, 'oauth_error=actor_mismatch');

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
        guard.actor.userId
      ]
    );

    res = backTo(req, `connected=${provider}`);
  } catch (err) {
    // err.message is token-free (providers.ts truncates + omits secrets)
    console.error(`[social:oauth:${provider}:callback]`, (err as Error).name, (err as Error).message);
    res = backTo(req, 'oauth_error=exchange_failed');
  }

  res.cookies.set(STATE_COOKIE, '', { ...COOKIE_BASE, maxAge: 0 }); // one-time use
  return res;
}
