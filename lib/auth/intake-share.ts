/**
 * lib/auth/intake-share.ts
 *
 * A signed, no-login share token for a client's PREFILLED intake form. The
 * operator copies a link like /client/intake-form/<token> and sends it; the
 * client opens it and sees their prefilled intake — no password, no session, no
 * gate. The token is a JWT signed with JWT_SECRET (same secret as sessions),
 * carries only the client_id + purpose, and is good for 30 days.
 *
 * This deliberately bypasses the portal auth/gate: it ONLY grants viewing +
 * submitting that one client's intake, nothing else.
 */
import { SignJWT, jwtVerify } from 'jose';

const ISSUER = process.env.JWT_ISSUER || 'atlantic-hub';
function key(): Uint8Array {
  return new TextEncoder().encode(process.env.JWT_SECRET || '');
}

export async function signIntakeShareToken(clientId: number): Promise<string> {
  return await new SignJWT({ clientId, purpose: 'intake_share' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(key());
}

/** Returns the client_id if the token is a valid intake-share token, else null. */
export async function verifyIntakeShareToken(token: string): Promise<number | null> {
  if (!token || !process.env.JWT_SECRET) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { issuer: ISSUER, algorithms: ['HS256'] });
    if (payload.purpose !== 'intake_share') return null;
    const cid = Number((payload as { clientId?: unknown }).clientId);
    return Number.isInteger(cid) && cid > 0 ? cid : null;
  } catch {
    return null;
  }
}
