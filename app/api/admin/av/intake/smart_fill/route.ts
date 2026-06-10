/**
 * POST /api/admin/av/intake/smart_fill  (#582, val 2026-06-10)
 *
 * Operator-side smart-fill: "paste a paragraph, get a brief partial." Used by:
 *   - /admin/av/clients/new (when val creates a client from a paragraph)
 *   - /admin/av/clients/[id]/intake (when val updates an existing client's brief)
 *
 * Owner + staff only — same guardAdminRequest as every other AV operator route.
 * The client-facing equivalent is at /api/client/intake/smart_fill (separate
 * route so the auth guard is per-surface, but both call the same lib).
 *
 * The response includes the PROMPT and the raw model output per val's QC rule
 * — the UI should show both so val can audit before spending more credits.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { isFlagEnabled } from '@/lib/feature-flags';
import { smartFillFromParagraph } from '@/lib/av/smart_fill';
import { isEngagementKind } from '@/lib/client/engagement_kind';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/av/intake/smart_fill', tenantId: 'av' });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (!(await isFlagEnabled('tab_av_enabled'))) {
    return NextResponse.json({ error: 'av tab disabled' }, { status: 403 });
  }

  let body: { paragraph?: unknown; clientId?: unknown; hintKind?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const paragraph = typeof body.paragraph === 'string' ? body.paragraph : '';
  if (!paragraph.trim()) {
    return NextResponse.json({ error: 'paragraph required' }, { status: 400 });
  }
  const clientIdRaw = body.clientId;
  const clientId = typeof clientIdRaw === 'number' && Number.isFinite(clientIdRaw) && clientIdRaw > 0
    ? Math.floor(clientIdRaw)
    : null;
  const hintKind = isEngagementKind(body.hintKind) ? body.hintKind : null;

  try {
    const result = await smartFillFromParagraph({ paragraph, clientId, hintKind });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: 'server error', errorClass: (err as Error).name, errorMessage: (err as Error).message },
      { status: 500 }
    );
  }
}
