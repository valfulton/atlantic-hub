/**
 * lib/social/oauth.ts
 *
 * Shared OAuth helpers for the social connect flow (LinkedIn + X in v1).
 *
 * Provides:
 *   - provider config (authorize / token / profile endpoints, scopes)
 *   - the exact registered redirect URI per provider
 *   - CSRF state generation + a one-cookie state-bag helper
 *   - PKCE (verifier + S256 challenge) for X
 *
 * No token material is logged anywhere in this module.
 */

import { createHash, randomBytes } from 'crypto';

export type SocialProvider = 'linkedin' | 'x';

export const SUPPORTED_PROVIDERS: SocialProvider[] = ['linkedin', 'x'];

export function isSupportedProvider(v: string): v is SocialProvider {
  return v === 'linkedin' || v === 'x';
}

/**
 * Valid tenant ids from the "POSTING AS" switcher. External clients use
 * the "client:<id>" form. Default is 'av'.
 */
export function normalizeTenant(raw: string | null | undefined): string {
  if (!raw) return 'av';
  const t = raw.trim();
  if (t === 'av' || t === 'ebw' || t === 'hh') return t;
  if (/^client:[A-Za-z0-9_-]{1,48}$/.test(t)) return t;
  return 'av';
}

/**
 * Base URL the providers redirect back to. MUST match the redirect URI
 * registered in each provider app. The registered value is the Netlify
 * production URL; SOCIAL_OAUTH_BASE_URL can override it for a preview
 * deploy whose URI is also registered. No trailing slash.
 */
function appBaseUrl(): string {
  const override = process.env.SOCIAL_OAUTH_BASE_URL?.trim();
  const base = override || 'https://atlantic-hub.netlify.app';
  return base.replace(/\/+$/, '');
}

export function redirectUri(provider: SocialProvider): string {
  return `${appBaseUrl()}/api/admin/social/oauth/${provider}/callback`;
}

interface ProviderConfig {
  authorizeUrl: string;
  tokenUrl: string;
  profileUrl: string;
  scopes: string[];
  usesPkce: boolean;
}

export const PROVIDER_CONFIG: Record<SocialProvider, ProviderConfig> = {
  linkedin: {
    authorizeUrl: 'https://www.linkedin.com/oauth/v2/authorization',
    tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken',
    profileUrl: 'https://api.linkedin.com/v2/userinfo',
    scopes: ['openid', 'profile', 'w_member_social'],
    usesPkce: false
  },
  x: {
    authorizeUrl: 'https://twitter.com/i/oauth2/authorize',
    tokenUrl: 'https://api.twitter.com/2/oauth2/token',
    profileUrl: 'https://api.twitter.com/2/users/me',
    scopes: ['tweet.read', 'tweet.write', 'users.read', 'offline.access'],
    usesPkce: true
  }
};

export function clientCredentials(provider: SocialProvider): { id: string; secret: string } {
  if (provider === 'linkedin') {
    return {
      id: process.env.LINKEDIN_CLIENT_ID || '',
      secret: process.env.LINKEDIN_CLIENT_SECRET || ''
    };
  }
  return {
    id: process.env.X_CLIENT_ID || '',
    secret: process.env.X_CLIENT_SECRET || ''
  };
}

// ---- CSRF state + PKCE -----------------------------------------------------

export const STATE_COOKIE = 'sc_oauth_state';
export const STATE_TTL_SECONDS = 600; // 10 minutes

export interface StateBag {
  state: string; // random CSRF nonce echoed back via ?state=
  provider: SocialProvider;
  tenant: string;
  verifier?: string; // PKCE code_verifier (X only)
  uid: number; // acting owner/staff userId from the guard
  ts: number; // issued-at epoch seconds
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function makeState(): string {
  return randomToken(24);
}

/** PKCE code_verifier: 43-128 chars of unreserved URL-safe characters. */
export function makeCodeVerifier(): string {
  return randomBytes(48).toString('base64url'); // ~64 chars
}

/** PKCE S256 challenge = base64url(sha256(verifier)). */
export function codeChallengeS256(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export function encodeStateBag(bag: StateBag): string {
  return Buffer.from(JSON.stringify(bag), 'utf8').toString('base64url');
}

export function decodeStateBag(raw: string | undefined): StateBag | null {
  if (!raw) return null;
  try {
    const json = Buffer.from(raw, 'base64url').toString('utf8');
    const bag = JSON.parse(json) as StateBag;
    if (!bag || typeof bag.state !== 'string' || typeof bag.ts !== 'number') return null;
    if (Date.now() / 1000 - bag.ts > STATE_TTL_SECONDS) return null; // expired
    return bag;
  } catch {
    return null;
  }
}
