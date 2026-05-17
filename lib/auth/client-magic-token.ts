/**
 * Magic-link token generator.
 *
 * 32 bytes of CSPRNG randomness -> 64 hex chars. Stored as-is in
 * client_users.magic_token. Single-use; the magic-link consumption
 * route clears it on success. 24-hour TTL by default.
 *
 * We store the raw token (not a hash). Justification: the token is
 * short-lived (24h), single-use, and bound to the user row at issue
 * time. If we ever leak DB dumps, the token is one factor among
 * several; we can move to hashed storage in a follow-up.
 */
import { randomBytes } from 'crypto';

export const MAGIC_TOKEN_TTL_HOURS = 24;
export const MAGIC_TOKEN_TTL_MS = MAGIC_TOKEN_TTL_HOURS * 60 * 60 * 1000;

export function generateMagicToken(): string {
  return randomBytes(32).toString('hex');
}

export function magicTokenExpiresAt(now: Date = new Date()): Date {
  return new Date(now.getTime() + MAGIC_TOKEN_TTL_MS);
}

/**
 * Build a fully-qualified magic-link URL pointing at the portal.
 * MAGIC_LINK_BASE_URL should be set in Netlify env to the public origin
 * of atlantic-hub (e.g. https://atlantic-hub.netlify.app). Falls back to
 * a relative URL if not configured, which still works once the client
 * is on-site but is no good for email delivery.
 */
export function buildMagicLinkUrl(token: string): string {
  const base = process.env.MAGIC_LINK_BASE_URL?.replace(/\/+$/, '') || '';
  return `${base}/api/client/magic-link/${token}`;
}
