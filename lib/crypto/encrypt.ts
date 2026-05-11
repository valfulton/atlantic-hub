/**
 * AES-256-GCM encryption for emails stored in shhdbite_atlantic_hub.accounts.
 *
 * Storage layout (Buffer concat):
 *   [ 12 bytes IV ][ 16 bytes auth tag ][ ciphertext... ]
 *
 * Key is base64-decoded from EMAIL_ENCRYPTION_KEY env var (must be 32 bytes
 * once decoded).
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

function getKey(): Buffer {
  const b64 = process.env.EMAIL_ENCRYPTION_KEY;
  if (!b64) throw new Error('EMAIL_ENCRYPTION_KEY not configured');
  const key = Buffer.from(b64, 'base64');
  if (key.length !== 32) {
    throw new Error('EMAIL_ENCRYPTION_KEY must decode to 32 bytes');
  }
  return key;
}

export function encryptEmail(plaintext: string): Buffer {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]);
}

export function decryptEmail(blob: Buffer): string {
  const key = getKey();
  const iv = blob.subarray(0, 12);
  const tag = blob.subarray(12, 28);
  const ct = blob.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString('utf8');
}
