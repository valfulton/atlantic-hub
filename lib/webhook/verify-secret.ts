/**
 * Constant-time comparison for the inbound webhook secret.
 * Prevents timing attacks on the secret value.
 */
import { timingSafeEqual } from 'crypto';

export function verifyWebhookSecret(received: string | null): boolean {
  const expected = process.env.NETLIFY_FORMS_WEBHOOK_SECRET;
  if (!expected || !received) return false;
  const a = Buffer.from(received, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
