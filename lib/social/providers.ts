/**
 * lib/social/providers.ts
 *
 * Token exchange + profile fetch for the v1 connect flow (LinkedIn, X).
 * Returns a normalized result the callback route stores in
 * social_connections. No token value is ever logged; provider error
 * bodies are truncated before they reach the caller.
 */

import {
  PROVIDER_CONFIG,
  clientCredentials,
  redirectUri,
  type SocialProvider
} from './oauth';

export interface OAuthResult {
  providerAccountId: string;
  displayName: string | null;
  avatarUrl: string | null;
  accessToken: string;
  refreshToken: string | null;
  accessTokenExpiresAt: Date | null;
  refreshTokenExpiresAt: Date | null;
  scopes: string[];
}

export class OAuthExchangeError extends Error {
  constructor(stage: string, detail: string) {
    // detail is already truncated + token-free by the caller
    super(`${stage}: ${detail}`);
    this.name = 'OAuthExchangeError';
  }
}

function truncate(s: string, n = 300): string {
  return s.length > n ? `${s.slice(0, n)}...` : s;
}

function expiryFromSeconds(seconds: unknown): Date | null {
  const n = typeof seconds === 'number' ? seconds : parseInt(String(seconds || ''), 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(Date.now() + n * 1000);
}

/**
 * Exchange the authorization code for tokens and fetch the account
 * profile. `verifier` is the PKCE code_verifier (required for X).
 */
export async function completeOAuth(
  provider: SocialProvider,
  code: string,
  verifier: string | undefined
): Promise<OAuthResult> {
  const cfg = PROVIDER_CONFIG[provider];
  const creds = clientCredentials(provider);
  const redirect = redirectUri(provider);

  const body = new URLSearchParams();
  body.set('grant_type', 'authorization_code');
  body.set('code', code);
  body.set('redirect_uri', redirect);
  body.set('client_id', creds.id);

  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json'
  };

  if (provider === 'linkedin') {
    body.set('client_secret', creds.secret);
  } else {
    // X OAuth2 + PKCE. Confidential clients authenticate with HTTP Basic.
    if (verifier) body.set('code_verifier', verifier);
    const basic = Buffer.from(`${creds.id}:${creds.secret}`).toString('base64');
    headers.Authorization = `Basic ${basic}`;
  }

  const tokenResp = await fetch(cfg.tokenUrl, { method: 'POST', headers, body });
  const tokenText = await tokenResp.text();
  if (!tokenResp.ok) {
    throw new OAuthExchangeError('token_exchange', `${tokenResp.status} ${truncate(tokenText)}`);
  }
  let token: Record<string, unknown>;
  try {
    token = JSON.parse(tokenText) as Record<string, unknown>;
  } catch {
    throw new OAuthExchangeError('token_parse', truncate(tokenText));
  }

  const accessToken = String(token.access_token || '');
  if (!accessToken) throw new OAuthExchangeError('token_missing', 'no access_token in response');
  const refreshToken = token.refresh_token ? String(token.refresh_token) : null;
  const accessTokenExpiresAt = expiryFromSeconds(token.expires_in);
  const scopes =
    typeof token.scope === 'string' && token.scope.length > 0
      ? token.scope.split(/[\s,]+/).filter(Boolean)
      : cfg.scopes;

  // ---- profile ----
  const profResp = await fetch(cfg.profileUrl, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }
  });
  const profText = await profResp.text();
  if (!profResp.ok) {
    throw new OAuthExchangeError('profile_fetch', `${profResp.status} ${truncate(profText)}`);
  }
  let profile: Record<string, unknown>;
  try {
    profile = JSON.parse(profText) as Record<string, unknown>;
  } catch {
    throw new OAuthExchangeError('profile_parse', truncate(profText));
  }

  let providerAccountId = '';
  let displayName: string | null = null;
  let avatarUrl: string | null = null;

  if (provider === 'linkedin') {
    // OpenID userinfo: { sub, name, picture, ... }
    providerAccountId = String(profile.sub || '');
    displayName = profile.name ? String(profile.name) : null;
    avatarUrl = profile.picture ? String(profile.picture) : null;
  } else {
    // X: { data: { id, name, username } }
    const data = (profile.data || {}) as Record<string, unknown>;
    providerAccountId = String(data.id || '');
    const name = data.name ? String(data.name) : null;
    const username = data.username ? String(data.username) : null;
    displayName = username ? `@${username}` : name;
  }

  if (!providerAccountId) {
    throw new OAuthExchangeError('profile_missing', 'no account id in profile response');
  }

  return {
    providerAccountId,
    displayName,
    avatarUrl,
    accessToken,
    refreshToken,
    accessTokenExpiresAt,
    refreshTokenExpiresAt: null,
    scopes
  };
}
