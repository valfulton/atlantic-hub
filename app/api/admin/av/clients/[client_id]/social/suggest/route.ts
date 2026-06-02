/**
 * POST /api/admin/av/clients/[client_id]/social/suggest  (#45, val 2026-06-02)
 *
 * Operator paste-box endpoint. Body: { urls: string[] } OR { paste: string }.
 * Each URL parses, fetches og:image, lands in social_targets as 'suggested'
 * for THIS brand (client_id). Returns the saved targets.
 *
 * Idempotent: re-pasting the same URL for the same brand returns the existing
 * row (note='duplicate'). Unrecognized URLs come back with note='unrecognized'
 * so the UI can warn val without aborting the batch.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { addSuggestedTargets } from '@/lib/social/targets';
import { extractUrlsFromPaste } from '@/lib/social/url_parser';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: { client_id: string } }) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/clients/social/suggest:POST',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const clientId = Number.parseInt(params.client_id, 10);
  if (!Number.isFinite(clientId) || clientId <= 0) {
    return NextResponse.json({ error: 'invalid client id' }, { status: 400 });
  }

  let body: { urls?: unknown; paste?: unknown } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  let urls: string[] = [];
  if (Array.isArray(body.urls)) {
    urls = body.urls.filter((u): u is string => typeof u === 'string' && u.trim().length > 0).map((u) => u.trim());
  } else if (typeof body.paste === 'string') {
    urls = extractUrlsFromPaste(body.paste);
  } else {
    return NextResponse.json({ error: 'urls[] or paste required' }, { status: 400 });
  }
  if (urls.length === 0) {
    return NextResponse.json({ error: 'no URLs provided' }, { status: 400 });
  }
  if (urls.length > 25) {
    return NextResponse.json({ error: 'max 25 URLs per request' }, { status: 400 });
  }

  const results = await addSuggestedTargets(
    'av',
    clientId,
    urls,
    'val_intake',
    guard.actor.userId ?? null
  );

  return NextResponse.json({
    ok: true,
    results: results.map((r, i) => ({
      url: urls[i],
      ok: r.ok,
      note: r.note ?? null,
      target: r.target
    }))
  });
}
