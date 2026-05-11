/**
 * JWT signing for session cookies.
 * HS256 with a 32+ byte secret. Default expiry: 8 hours.
 *
 * Verification lives in middleware.ts (Edge runtime) — kept separate
 * because middleware uses jose directly to avoid pulling Node-only
 * code into the Edge bundle.
 */
import { SignJWT } from 'jose';

const ISSUER = process.env.JWT_ISSUER || 'atlantic-hub';
const DEFAULT_TTL_SECONDS = 8 * 60 * 60; // 8 hours

export async function signSessionJwt(params: {
  userId: number;
  role: 'owner' | 'staff' | 'client_user';
  sessionId: string;
  ttlSeconds?: number;
}): Promise<string> {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET not configured');
  const ttl = params.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const now = Math.floor(Date.now() / 1000);
  const key = new TextEncoder().encode(secret);
  return await new SignJWT({
    sub: String(params.userId),
    role: params.role,
    sid: params.sessionId
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER)
    .setIssuedAt(now)
    .setExpirationTime(now + ttl)
    .sign(key);
}
