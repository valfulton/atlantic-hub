/**
 * lib/cron/worker_auth.ts  (#380, val 2026-06-03)
 *
 * Worker-token bypass for cron-driven calls. The HostGator worker hits the
 * Atlantic Hub API with `Authorization: Bearer <WORKER_INTERNAL_TOKEN>` and
 * bypasses session auth.
 *
 * Token is set in Netlify env as `WORKER_INTERNAL_TOKEN`. NEVER log the
 * value. Rotate quarterly.
 */
import type { NextRequest } from 'next/server';

export function checkWorkerToken(req: NextRequest): boolean {
  const expected = process.env.WORKER_INTERNAL_TOKEN;
  if (!expected) return false;
  const auth = req.headers.get('authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return false;
  const presented = auth.slice('Bearer '.length).trim();
  // Constant-time-ish comparison: short circuit on length first then char-by-char.
  if (presented.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= presented.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}
