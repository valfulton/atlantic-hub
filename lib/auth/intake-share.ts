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

// ----------------------------------------------------------------------------
// OWNER-SCOPED intake share token (#45 Phase B, multi-brand owners).
//
// Replaces "two magic links per multi-brand owner" — val generates ONE link
// scoped to the OWNER (client_user_id) and Adriana sees a tab per brand
// (CBB / CLDA) above the intake form. Each tab loads its own brief; the
// active brand is taken from a ?brand=<id> URL param on the intake page.
//
// Authorization on the receiving end: the page calls listBrandsForUser(userId)
// and only renders/loads brands that membership actually allows. A tampered
// ?brand=<id> in the URL is dropped to the first allowed brand. The token
// proves "this person can fill ANY of their brands' intakes" — same trust
// level as the single-brand token, but the scope is the person, not the brand.
// ----------------------------------------------------------------------------

export async function signOwnerIntakeShareToken(clientUserId: number): Promise<string> {
  return await new SignJWT({ clientUserId, purpose: 'owner_intake_share' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(key());
}

/** Returns the client_user_id if the token is a valid owner-scoped intake-share token, else null. */
export async function verifyOwnerIntakeShareToken(token: string): Promise<number | null> {
  if (!token || !process.env.JWT_SECRET) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { issuer: ISSUER, algorithms: ['HS256'] });
    if (payload.purpose !== 'owner_intake_share') return null;
    const uid = Number((payload as { clientUserId?: unknown }).clientUserId);
    return Number.isInteger(uid) && uid > 0 ? uid : null;
  } catch {
    return null;
  }
}

/**
 * Convenience: try owner-scoped first, fall back to single-brand. Returns the
 * resolved scope so the intake page can branch.
 */
export type IntakeShareScope =
  | { kind: 'single'; clientId: number }
  | { kind: 'owner'; clientUserId: number }
  | { kind: 'invalid' };

export async function resolveIntakeShareToken(token: string): Promise<IntakeShareScope> {
  const owner = await verifyOwnerIntakeShareToken(token);
  if (owner) return { kind: 'owner', clientUserId: owner };
  const single = await verifyIntakeShareToken(token);
  if (single) return { kind: 'single', clientId: single };
  return { kind: 'invalid' };
}
