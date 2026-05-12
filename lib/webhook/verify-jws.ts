/**
 * Netlify Forms webhook signature verification — JWS / HS256.
 *
 * Netlify signs every outgoing form-submission webhook with a compact JWS
 * placed in the X-Webhook-Signature request header. The algorithm is HS256
 * and the signing secret is the "JWS secret token" set in the form
 * notification UI (stored here as NETLIFY_FORMS_WEBHOOK_SECRET).
 *
 * The JWS payload carries two claims the receiver MUST check:
 *   - iss: must equal "netlify"
 *   - sha256: hex-encoded SHA-256 of the raw request body
 *
 * Verifying sha256 against a locally-computed digest proves the body was not
 * tampered with in transit — the signature alone only proves the header
 * wasn't forged. Both checks are required.
 *
 * This module intentionally never throws. Any error (bad signature, malformed
 * token, missing env var, claim mismatch) produces a false return so the
 * caller can treat all failure modes uniformly as 401.
 *
 * Reference: Netlify Forms webhook notification docs (verified May 2026).
 */

import { jwtVerify } from 'jose';
import { createHash, timingSafeEqual } from 'crypto';

export async function verifyNetlifyFormsSignature(
  signatureHeader: string | null,
  rawBody: string
): Promise<boolean> {
  if (!signatureHeader) return false;

  const secret = process.env.NETLIFY_FORMS_WEBHOOK_SECRET;
  if (!secret) return false;

  try {
    const key = new TextEncoder().encode(secret);

    const { payload } = await jwtVerify(signatureHeader, key, {
      algorithms: ['HS256'],
    });

    if (payload.iss !== 'netlify') return false;

    const claimedHex = payload.sha256;
    if (typeof claimedHex !== 'string' || claimedHex.length === 0) return false;

    const localHex = createHash('sha256').update(rawBody, 'utf8').digest('hex');

    // Constant-time comparison to prevent timing oracle on the body digest.
    if (claimedHex.length !== localHex.length) return false;
    const a = Buffer.from(claimedHex, 'utf8');
    const b = Buffer.from(localHex, 'utf8');
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
