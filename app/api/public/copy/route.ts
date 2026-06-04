/**
 * /api/public/copy  (newsroom team, 2026-06-04)
 *
 * PUBLIC, read-only copy for PRE-AUTH surfaces (the gates: /client/login,
 * /client/set-password). No auth — but locked down hard:
 *   - GLOBAL scope only (never per-client; can't leak one tenant's copy)
 *   - whitelisted to `gate.*` keys only (nothing else is publicly readable)
 *   - capped key count
 * Gate pages render their hardcoded DEFAULT immediately and overlay any
 * override from this endpoint (no flash). GET ?keys=gate.client_login.h1,…
 */
import { NextRequest, NextResponse } from 'next/server';
import { getCopyMap } from '@/lib/copy/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOW = /^gate\./; // only gate copy is publicly readable

export async function GET(req: NextRequest) {
  const raw = (req.nextUrl.searchParams.get('keys') || '')
    .split(',').map((k) => k.trim()).filter((k) => k && ALLOW.test(k)).slice(0, 40);
  if (!raw.length) return NextResponse.json({ copy: {} });
  const copy = await getCopyMap(raw, {}); // GLOBAL scope only — no ctx
  return NextResponse.json({ copy });
}
