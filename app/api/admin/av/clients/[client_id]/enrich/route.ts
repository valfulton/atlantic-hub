/**
 * POST /api/admin/av/clients/[client_id]/enrich
 *
 * Operator-only. Enriches THIS client's leads on their behalf — fills missing
 * contact details (name + email via Hunter) for leads in their hub only
 * (runEnrichmentBatch scoped by client_id). Respects the same monthly Hunter
 * credit ceiling as the global enrich. Owner + staff only.
 *
 * Body: { limit?: number }  (default 10, max 50)
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { runEnrichmentBatch } from '@/lib/enrichment/enricher';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: NextRequest, { params }: { params: { client_id: string } }) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/av/clients/enrich:POST', tenantId: 'av' });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const clientId = Number.parseInt(params.client_id, 10);
  if (!Number.isFinite(clientId) || clientId <= 0) {
    return NextResponse.json({ error: 'invalid client id' }, { status: 400 });
  }

  let body: { limit?: unknown } = {};
  try { body = await req.json(); } catch { /* defaults */ }
  const limit =
    typeof body.limit === 'number' && Number.isFinite(body.limit)
      ? Math.max(1, Math.min(50, Math.floor(body.limit)))
      : 10;

  try {
    const summary = await runEnrichmentBatch({ limit, triggerSource: 'manual', clientId });
    const message =
      summary.enriched > 0
        ? `Enriched ${summary.enriched} of ${summary.attempted} lead${summary.attempted === 1 ? '' : 's'} with contact details.`
        : summary.stoppedEarlyReason
          ? summary.stoppedEarlyReason
          : summary.attempted === 0
            ? 'No leads needed enrichment — they already have contact details.'
            : 'No new contact details found this run.';
    return NextResponse.json({ ok: true, ...summary, message });
  } catch (err) {
    return NextResponse.json({ error: 'enrichment failed', errorClass: (err as Error).name }, { status: 500 });
  }
}
