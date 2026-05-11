/**
 * SHA-256 helpers.
 * Used for email_hash (PK on accounts), ip_hash (audit log), and
 * payload integrity checks.
 */
import { createHash } from 'crypto';

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

export function emailHash(email: string): string {
  // Normalize to avoid duplicate accounts from case/whitespace variance.
  const normalized = email.trim().toLowerCase();
  return sha256Hex(normalized);
}

export function ipHash(ip: string): string {
  const salt = process.env.IP_SALT;
  if (!salt) throw new Error('IP_SALT not configured');
  return sha256Hex(ip + ':' + salt);
}

export function userAgentHash(ua: string | null | undefined): string | null {
  if (!ua) return null;
  return sha256Hex(ua);
}
