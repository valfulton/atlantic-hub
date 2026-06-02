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
    // (#45 Phase C) `w_organization_social` lets the user post as company
    // pages they administer. Tokens issued BEFORE this change lack the scope
    // -- those accounts must RECONNECT at /admin/social (or via the intake
    // connect popup) before their org targets can post. Same warning pattern
    // as the X media.write note below.
    scopes: ['openid', 'profile', 'w_member_social', 'w_organization_social'],
    usesPkce: false
  },
  x: {
    authorizeUrl: 'https://twitter.com/i/oauth2/authorize',
    tokenUrl: 'https://api.twitter.com/2/oauth2/token',
    profileUrl: 'https://api.twitter.com/2/users/me',
    // media.write is required to upload native images/video to X. It was added
    // 2026-05-22 for the publisher's X native-media path (lib/social/media.ts).
    // FLAG: tokens issued BEFORE this change lack media.write -- the account
    // must be RECONNECTED at /admin/social for X native media to work. Until
    // reconnected, X posts fall back to text+link (publishOutboxRow).
    scopes: ['tweet.read', 'tweet.write', 'users.read', 'offline.access', 'media.write'],
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
  /** Acting owner/staff userId from the admin guard. 0 when kind='intake'. */
  uid: number;
  ts: number; // issued-at epoch seconds
  /**
   * (#45 Phase C) Flow kind.
   *   - 'admin'  : default; started from /admin/social by an authenticated operator.
   *   - 'intake' : started from inside the client intake-form popup. uid is 0 because
   *                no admin session exists; trust comes from the verified intake
   *                share token that was resolved at start-time. clientId + targetId
   *                tell the callback which target to attach the new connection to and
   *                which brand to discover LinkedIn orgs for.
   */
  kind?: 'admin' | 'intake';
  /** When kind='intake': the brand the target belongs to. */
  clientId?: number;
  /** When kind='intake': the social_targets row to attach the OAuth connection to. */
  targetId?: number;
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
