/**
 * POST /api/admin/av/cockpit/greenlight  (#550 v1 stub)
 *
 * Accepts a green-light / kill action from the campaign cockpit's pending-
 * approvals list and records intent. v1 is INTENT-ONLY — no actual publish
 * happens, no asset is moved through the publish pipeline. Returns 200 so
 * the cockpit UI can show the LIVE/killed pill confidently during demo.
 *
 * Why a stub: the real wiring needs narrative_line_links + outbox + the
 * commercials/press_release/op_ed publish endpoints. Those exist; threading
 * them through the cockpit is a meaningful build (an afternoon). For the
 * demo arc tonight, val needs the UI to feel real — and intent-logging gets
 * us there without forging publish events.
 *
 * #550 v2 swaps this for real publish dispatch + outbox write.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/av/cockpit/greenlight:POST', tenantId: 'av' });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  let body: { clientId?: number; approvalId?: string; action?: 'green' | 'kill' };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  const { clientId, approvalId, action } = body;
  if (!Number.isFinite(clientId) || !approvalId || !action) {
    return NextResponse.json({ error: 'clientId, approvalId, action required' }, { status: 400 });
  }

  // v1 intent log. Replace with publish dispatch in v2.
  // (actor type is { userId, role, sessionId } — no email field; use userId.)
  console.log('[cockpit:greenlight]', {
    actorUserId: guard.actor.userId,
    actorRole: guard.actor.role,
    clientId,
    approvalId,
    action,
    at: new Date().toISOString()
  });

  return NextResponse.json({ ok: true, recorded: true, stub: true });
}
