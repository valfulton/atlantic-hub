/**
 * JWT signing for client-portal session cookies.
 *
 * Mirrors lib/auth/jwt.ts but the resulting token is meant to live in
 * the `ah_client_session` cookie (not `ah_session`). Same HS256 + same
 * JWT_SECRET / JWT_ISSUER so we don't double the key surface; the
 * difference is purely the cookie name + the matcher that gates client
 * routes.
 *
 * Default expiry: 8 hours, matching the operator session.
 */
import { SignJWT } from 'jose';

const ISSUER = process.env.JWT_ISSUER || 'atlantic-hub';
const DEFAULT_TTL_SECONDS = 8 * 60 * 60; // 8 hours

export async function signClientSessionJwt(params: {
  clientUserId: number;
  sessionId: string;
  ttlSeconds?: number;
}): Promise<string> {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET not configured');
  const ttl = params.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const now = Math.floor(Date.now() / 1000);
  const key = new TextEncoder().encode(secret);
  return await new SignJWT({
    sub: String(params.clientUserId),
    role: 'client_user',
    sid: params.sessionId,
    aud: 'client-portal'
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER)
    .setIssuedAt(now)
    .setExpirationTime(now + ttl)
    .sign(key);
}
