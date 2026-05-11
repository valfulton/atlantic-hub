/**
 * Sliding-window rate limiter backed by rate_limit_buckets table.
 *
 * Strategy: bucket by minute. To enforce N requests per 60 seconds,
 * sum hit_count for the last 60 seconds. Cheap, MySQL-only, no Redis.
 *
 * Buckets are addressable by an arbitrary string key — for login:
 *   'login:ip:<ip_hash>'
 * For API:
 *   'api:session:<session_id>'
 */
import { getPlatformDb } from '@/lib/db/platform';
import type { RowDataPacket } from 'mysql2';

export interface RateLimitResult {
  allowed: boolean;
  hits: number;
  limit: number;
  windowSeconds: number;
}

function nowFloorToMinute(): Date {
  const n = new Date();
  n.setSeconds(0, 0);
  return n;
}

export async function checkAndConsume(params: {
  bucketKey: string;
  limit: number;
  windowSeconds: number;
}): Promise<RateLimitResult> {
  const { bucketKey, limit, windowSeconds } = params;
  const db = getPlatformDb();

  // Upsert the current-minute bucket: +1 hit.
  const currentMinute = nowFloorToMinute();
  await db.execute(
    `INSERT INTO rate_limit_buckets (bucket_key, window_start, hit_count)
     VALUES (?, ?, 1)
     ON DUPLICATE KEY UPDATE hit_count = hit_count + 1`,
    [bucketKey, currentMinute]
  );

  // Sum hits across the rolling window.
  const windowStart = new Date(Date.now() - windowSeconds * 1000);
  const [rows] = await db.execute<(RowDataPacket & { total: number })[]>(
    `SELECT COALESCE(SUM(hit_count), 0) AS total
     FROM rate_limit_buckets
     WHERE bucket_key = ? AND window_start >= ?`,
    [bucketKey, windowStart]
  );
  const hits = Number(rows[0]?.total ?? 0);
  return {
    allowed: hits <= limit,
    hits,
    limit,
    windowSeconds
  };
}

// Common keyed limiters.
export const LOGIN_RATE_LIMIT = { limit: 5, windowSeconds: 15 * 60 };
export const API_RATE_LIMIT = { limit: 60, windowSeconds: 60 };
export const WEBHOOK_RATE_LIMIT = { limit: 120, windowSeconds: 60 };
