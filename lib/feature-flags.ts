/**
 * Feature flag reader with 30-second in-memory cache per warm Lambda.
 *
 * Cache invalidates on TTL only — there's no pub/sub. Flipping a flag
 * in phpMyAdmin will propagate within 30 seconds across all Lambda
 * instances.
 *
 * IMPORTANT: MySQL's BOOLEAN type is TINYINT(1) under the hood. The
 * mysql2 driver may return it as a number (0|1), a Buffer (<00>|<01>),
 * or a string ('0'|'1') depending on column flags and driver config.
 * We normalize all three with `mysqlBoolToJs`.
 */
import { getPlatformDb } from '@/lib/db/platform';
import type { RowDataPacket } from 'mysql2';

const CACHE_TTL_MS = 30_000;
type CacheEntry = { value: boolean; expires: number };
const cache = new Map<string, CacheEntry>();

/**
 * Convert any MySQL representation of a boolean column to a JS boolean.
 * Handles: number (0|1), Buffer (single byte), string ('0'|'1'|'true'|'false'),
 * boolean (already converted), and null/undefined (false).
 */
function mysqlBoolToJs(val: unknown): boolean {
  if (val === null || val === undefined) return false;
  if (typeof val === 'boolean') return val;
  if (typeof val === 'number') return val !== 0;
  if (typeof val === 'string') {
    const lower = val.toLowerCase();
    return lower === '1' || lower === 'true';
  }
  if (Buffer.isBuffer(val)) {
    // BIT(1) comes back as a 1-byte Buffer. 0x00 = false, 0x01 = true.
    return val.length > 0 && val[0] !== 0;
  }
  return Boolean(val);
}

export async function isFlagEnabled(flagName: string): Promise<boolean> {
  const now = Date.now();
  const cached = cache.get(flagName);
  if (cached && cached.expires > now) {
    return cached.value;
  }

  try {
    const db = getPlatformDb();
    const [rows] = await db.execute<(RowDataPacket & { enabled: unknown })[]>(
      'SELECT enabled FROM feature_flags WHERE flag_name = ? LIMIT 1',
      [flagName]
    );
    const enabled = mysqlBoolToJs(rows[0]?.enabled);
    cache.set(flagName, { value: enabled, expires: now + CACHE_TTL_MS });
    return enabled;
  } catch (err) {
    // Fail safe: if we can't read flags, default to OFF. This degrades
    // tabs (hidden) and write paths (disabled), which is the safe choice
    // when the platform DB is unreachable.
    console.error('[feature-flags:read-failed]', flagName, (err as Error).message);
    return false;
  }
}

export function clearFlagCache(): void {
  cache.clear();
}

// Exported for use by other modules that read MySQL boolean columns.
export { mysqlBoolToJs };
