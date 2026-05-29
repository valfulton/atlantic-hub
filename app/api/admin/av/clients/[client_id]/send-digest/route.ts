/**
 * POST /api/admin/av/clients/[client_id]/send-digest  (#216 v1)
 *
 * Body: { mode?: 'preview' | 'send', force?: boolean }
 *   - 'preview' (default): builds the digest and returns the HTML + text +
 *     items + subject without sending. Lets val see what the email will look
 *     like before firing.
 *   - 'send': actually sends via SMTP.
 *   - force: send even when the digest is empty (skipped by default).
 *
 * Owner / staff only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { buildClientDigest, sendClientDigest } from '@/lib/client/weekly_digest';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(req: NextRequest, { params }: { params: { client_id: string } }) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/clients/[client_id]/send-digest:POST',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const clientId = Number.parseInt(params.client_id, 10);
  if (!Number.isFinite(clientId) || clientId <= 0) {
    return NextResponse.json({ error: 'invalid client_id' }, { status: 400 });
  }

  let body: { mode?: 'preview' | 'send'; force?: boolean } = {};
  try { body = await req.json(); } catch { /* empty body OK; defaults apply */ }
  const mode = body.mode === 'send' ? 'send' : 'preview';
  const force = body.force === true;

  try {
    if (mode === 'preview') {
      const build = await buildClientDigest(clientId);
      return NextResponse.json({
        ok: true,
        mode: 'preview',
        to: build.to,
        subject: build.subject,
        items: build.items,
        isEmpty: build.isEmpty,
        html: build.html,
        text: build.text,
        brandName: build.brandName
      });
    }
    const { build, send } = await sendClientDigest(clientId, { force });
    return NextResponse.json({
      ok: send.sent,
      mode: 'send',
      to: build.to,
      subject: build.subject,
      itemsCount: build.items.length,
      isEmpty: build.isEmpty,
      sent: send.sent,
      reason: 'reason' in send ? send.reason : undefined
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'server error', detail: (err as Error).message },
      { status: 500 }
    );
  }
}
