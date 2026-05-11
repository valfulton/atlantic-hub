/**
 * Feature flag reader with 30-second in-memory cache per warm Lambda.
 *
 * Cache invalidates on TTL only — there's no pub/sub. Flipping a flag
 * in phpMyAdmin will propagate within 30 seconds across all Lambda
 * instances.
 */
import { getPlatformDb } from '@/lib/db/platform';
import type { RowDataPacket } from 'mysql2';

const CACHE_TTL_MS = 30_000;
type CacheEntry = { value: boolean; expires: number };
const cache = new Map<string, CacheEntry>();

export async function isFlagEnabled(flagName: string): Promise<boolean> {
  const now = Date.now();
  const cached = cache.get(flagName);
  if (cached && cached.expires > now) {
    return cached.value;
  }

  try {
    const db = getPlatformDb();
    const [rows] = await db.execute<(RowDataPacket & { enabled: 0 | 1 })[]>(
      'SELECT enabled FROM feature_flags WHERE flag_name = ? LIMIT 1',
      [flagName]
    );
    const enabled = rows[0]?.enabled === 1;
    cache.set(flagName, { value: enabled, expires: now + CACHE_TTL_MS });
    return enabled;
  } catch (err) {
    // Fail safe: if we can't read flags, default to OFF for write-path
    // flags (audit, webhook), ON for read-path flags (tabs). Caller
    // decides. Returning false here is the conservative default; callers
    // for tab-visibility flags should treat false as "tab hidden", which
    // is acceptable degraded behavior.
    console.error('[feature-flags:read-failed]', flagName, (err as Error).message);
    return false;
  }
}

export function clearFlagCache(): void {
  cache.clear();
}
