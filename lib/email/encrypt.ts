/**
 * lib/email/encrypt.ts
 *
 * Symmetric encryption for mailbox credentials at rest.
 *
 * Reads EMAIL_ENCRYPTION_KEY from process.env (already declared in the
 * stack -- see docs/ENV_VARS_REFERENCE.md). The key MUST be a 32-byte
 * value, supplied as either:
 *   - 64-character lowercase hex string, OR
 *   - 44-character base64 string
 *
 * Uses AES-256-GCM (authenticated encryption). Output format:
 *   "v1:<iv-base64>:<authTag-base64>:<ciphertext-base64>"
 *
 * Versioned prefix lets us rotate algorithms later without breaking
 * existing rows.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const KEY_ENV = 'EMAIL_ENCRYPTION_KEY';
const VERSION = 'v1';
const ALGO = 'aes-256-gcm';

export class EncryptionKeyMissingError extends Error {
  constructor() {
    super(`${KEY_ENV} is not set in Netlify environment variables`);
    this.name = 'EncryptionKeyMissingError';
  }
}

export class EncryptionKeyMalformedError extends Error {
  constructor(reason: string) {
    super(`${KEY_ENV} is malformed: ${reason}`);
    this.name = 'EncryptionKeyMalformedError';
  }
}

export class CiphertextMalformedError extends Error {
  constructor(reason: string) {
    super(`Mailbox ciphertext is malformed: ${reason}`);
    this.name = 'CiphertextMalformedError';
  }
}

let cachedKey: Buffer | null = null;

function loadKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env[KEY_ENV];
  if (!raw) throw new EncryptionKeyMissingError();
  const trimmed = raw.trim();
  let buf: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    buf = Buffer.from(trimmed, 'hex');
  } else {
    try {
      buf = Buffer.from(trimmed, 'base64');
    } catch {
      throw new EncryptionKeyMalformedError('not 64-char hex or valid base64');
    }
  }
  if (buf.length !== 32) {
    throw new EncryptionKeyMalformedError(
      `decoded length is ${buf.length} bytes, expected 32 (256-bit key)`
    );
  }
  cachedKey = buf;
  return cachedKey;
}

/**
 * Encrypt a UTF-8 plaintext string. Returns the versioned ciphertext format.
 */
export function encryptString(plaintext: string): string {
  const key = loadKey();
  const iv = randomBytes(12); // GCM standard nonce length
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':');
}

/**
 * Decrypt a versioned ciphertext string. Throws CiphertextMalformedError
 * if the format does not parse or the auth tag fails.
 */
export function decryptString(ciphertext: string): string {
  const key = loadKey();
  const parts = ciphertext.split(':');
  if (parts.length !== 4) throw new CiphertextMalformedError('expected 4 colon-separated parts');
  const [version, ivB64, tagB64, ctB64] = parts;
  if (version !== VERSION) throw new CiphertextMalformedError(`unknown version "${version}"`);
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const ct = Buffer.from(ctB64, 'base64');
  if (iv.length !== 12) throw new CiphertextMalformedError(`iv length ${iv.length}, expected 12`);
  if (tag.length !== 16) throw new CiphertextMalformedError(`tag length ${tag.length}, expected 16`);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  try {
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return pt.toString('utf8');
  } catch (err) {
    throw new CiphertextMalformedError(`decryption failed: ${(err as Error).message}`);
  }
}

/**
 * Convenience: encrypt a JSON-serializable object.
 */
export function encryptJson<T>(value: T): string {
  return encryptString(JSON.stringify(value));
}

/**
 * Convenience: decrypt a ciphertext back into a typed object. Caller is
 * responsible for validating the shape -- this just does JSON.parse.
 */
export function decryptJson<T = unknown>(ciphertext: string): T {
  return JSON.parse(decryptString(ciphertext)) as T;
}
