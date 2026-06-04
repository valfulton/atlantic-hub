/**
 * /api/admin/av/copy/recent-edits  (newsroom team, 2026-06-04 — D4)
 *
 * Feed for the conductor steering wheel (/admin/av/conductor). Poll every
 * 30s with ?since=<ISO> to surface "copy changes since you last looked."
 *   GET ?since=2026-06-04T18:00:00Z  → { ok, edits: CopyEdit[] }
 * Sentinels are mapped out: client_id 0 → null (global), stage '' → null (any).
 * Owner/staff only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { getRecentEdits } from '@/lib/copy/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const role = headers().get('x-ah-user-role');
  if (role !== 'owner' && role !== 'staff') {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
  }
  // Default to the last 24h if no/!valid `since` provided.
  const sinceParam = req.nextUrl.searchParams.get('since');
  let since = sinceParam || new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  if (Number.isNaN(new Date(since).getTime())) {
    since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  }
  try {
    const edits = await getRecentEdits(since);
    return NextResponse.json({ ok: true, since, edits });
  } catch {
    return NextResponse.json({ ok: true, since, edits: [] });
  }
}
