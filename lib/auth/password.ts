/**
 * bcrypt-12 password hashing.
 * Using bcryptjs (pure JS) for Netlify Functions compatibility.
 * Cost factor 12 = ~250ms per hash on modest hardware.
 */
import bcrypt from 'bcryptjs';

const COST_FACTOR = 12;

export async function hashPassword(plaintext: string): Promise<string> {
  return await bcrypt.hash(plaintext, COST_FACTOR);
}

export async function verifyPassword(plaintext: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(plaintext, hash);
  } catch {
    return false;
  }
}
