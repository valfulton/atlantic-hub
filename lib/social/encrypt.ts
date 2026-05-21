/**
 * lib/social/encrypt.ts
 *
 * Symmetric encryption for social OAuth tokens at rest.
 *
 * Same construction as lib/email/encrypt.ts (AES-256-GCM, versioned
 * "v1:iv:tag:ciphertext" base64 format) but reads its key from
 * SOCIAL_TOKEN_ENCRYPTION_KEY so social token rotation is independent of
 * the mailbox key. Key MUST decode to 32 bytes -- either a 64-char hex
 * string or a base64 string.
 *
 * Output goes into social_connections.access_token_enc /
 * refresh_token_enc (TEXT columns).
 *
 * NEVER log the plaintext token or the key. Errors below are constructed
 * without ever embedding token material.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const KEY_ENV = 'SOCIAL_TOKEN_ENCRYPTION_KEY';
const VERSION = 'v1';
const ALGO = 'aes-256-gcm';

export class SocialKeyMissingError extends Error {
  constructor() {
    super(`${KEY_ENV} is not set in Netlify environment variables`);
    this.name = 'SocialKeyMissingError';
  }
}

export class SocialKeyMalformedError extends Error {
  constructor(reason: string) {
    super(`${KEY_ENV} is malformed: ${reason}`);
    this.name = 'SocialKeyMalformedError';
  }
}

export class SocialCiphertextMalformedError extends Error {
  constructor(reason: string) {
    super(`Social token ciphertext is malformed: ${reason}`);
    this.name = 'SocialCiphertextMalformedError';
  }
}

let cachedKey: Buffer | null = null;

function loadKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env[KEY_ENV];
  if (!raw) throw new SocialKeyMissingError();
  const trimmed = raw.trim();
  let buf: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    buf = Buffer.from(trimmed, 'hex');
  } else {
    try {
      buf = Buffer.from(trimmed, 'base64');
    } catch {
      throw new SocialKeyMalformedError('not 64-char hex or valid base64');
    }
  }
  if (buf.length !== 32) {
    throw new SocialKeyMalformedError(
      `decoded length is ${buf.length} bytes, expected 32 (256-bit key)`
    );
  }
  cachedKey = buf;
  return cachedKey;
}

/**
 * Encrypt a UTF-8 token string. Returns the versioned ciphertext format
 * suitable for the *_enc TEXT columns. Throws if the key is missing or
 * malformed. Never logs the plaintext.
 */
export function encryptToken(plaintext: string): string {
  const key = loadKey();
  const iv = randomBytes(12); // GCM standard nonce length
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':');
}

/**
 * Decrypt a versioned token ciphertext. Throws
 * SocialCiphertextMalformedError if the format does not parse or the auth
 * tag fails. Never logs the plaintext.
 */
export function decryptToken(ciphertext: string): string {
  const key = loadKey();
  const parts = ciphertext.split(':');
  if (parts.length !== 4) throw new SocialCiphertextMalformedError('expected 4 colon-separated parts');
  const [version, ivB64, tagB64, ctB64] = parts;
  if (version !== VERSION) throw new SocialCiphertextMalformedError(`unknown version "${version}"`);
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const ct = Buffer.from(ctB64, 'base64');
  if (iv.length !== 12) throw new SocialCiphertextMalformedError(`iv length ${iv.length}, expected 12`);
  if (tag.length !== 16) throw new SocialCiphertextMalformedError(`tag length ${tag.length}, expected 16`);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  try {
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return pt.toString('utf8');
  } catch (err) {
    throw new SocialCiphertextMalformedError(`decryption failed: ${(err as Error).message}`);
  }
}
