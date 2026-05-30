/**
 * POST /api/admin/av/clients/[client_id]/score-icp-fit  (#95)
 *
 * Bulk-score this client's pipeline leads against their saved ICP + brief.
 * Body: { mode?: 'unscored' | 'all', limit?: number }
 *   - 'unscored' (default): only leads with NULL client_icp_fit_score
 *   - 'all': rescore everything (use after a brief / ICP change)
 *
 * Each lead costs one OpenAI call. A pipeline of 30 leads is ~$0.01 in
 * tokens. The endpoint hard-deadlines at 55s (under Netlify's 60s cap) and
 * returns whatever was scored so val never hits a 504.
 *
 * Owner / staff only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { scoreClientLeadsBulk } from '@/lib/ai/client_icp_fit';
import { logEvent } from '@/lib/events/log';

export const runtime = 'nodejs';
export const maxDuration = 60;

// Soft deadline 5s under Netlify's max so we still get the response out.
const SOFT_DEADLINE_MS = 55_000;

export async function POST(req: NextRequest, { params }: { params: { client_id: string } }) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/clients/[client_id]/score-icp-fit:POST',
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

  let body: { mode?: 'unscored' | 'all'; limit?: number } = {};
  try { body = await req.json(); } catch { /* empty body is fine — defaults apply */ }

  const mode: 'unscored' | 'all' = body.mode === 'all' ? 'all' : 'unscored';
  const limit = typeof body.limit === 'number' && body.limit > 0 ? Math.min(body.limit, 500) : 100;
  const startedAt = Date.now();
  const softDeadline = startedAt + SOFT_DEADLINE_MS;

  try {
    const result = await scoreClientLeadsBulk({ clientId, mode, limit, softDeadline });
    await logEvent({
      eventType: 'lead.icp_fit.bulk_completed',
      userId: guard.actor.userId,
      source: 'operator',
      executionTimeMs: Date.now() - startedAt,
      payload: { client_id: clientId, mode, ...result }
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: 'server error', detail: (err as Error).message },
      { status: 500 }
    );
  }
}
