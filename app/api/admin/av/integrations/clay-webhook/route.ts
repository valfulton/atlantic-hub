/**
 * POST /api/admin/av/integrations/clay-webhook
 *
 * Called by Clay tables when a row finishes enrichment. NOT a user-authed
 * endpoint -- it intentionally does NOT use guardAdminRequest. The caller is
 * Clay's webhook system, not an operator browser session.
 *
 * Auth: shared secret in the X-Webhook-Secret header. Constant-time compared
 * against CLAY_WEBHOOK_SECRET. Missing or wrong -> 401.
 *
 * Rate limit: 100 requests / minute / clay_table_id (or the global "no table
 * id" bucket if Clay does not send one). Returns 429 when exceeded so Clay
 * will retry with backoff instead of dropping the row.
 *
 * Response shape:
 *   200 { ok: true, outcome: 'inserted'|'updated'|'duplicate', leadId? }
 *   400 { ok: false, error: 'invalid_payload' }            (no usable fields)
 *   401 { ok: false, error: 'unauthorized' }                (secret check)
 *   429 { ok: false, error: 'rate_limited' }                (per-table budget)
 *   500 { ok: false, error: 'server_error' }                (unexpected)
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyClaySecret, parseClayPayload, payloadIsUseful } from '@/lib/clay/webhook';
import { ingestClayRow } from '@/lib/clay/discoverer';

export const runtime = 'nodejs';
// Webhook endpoints must be dynamic -- never statically cached, every POST
// must hit the handler.
export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------
// In-memory rate limiter. Scoped per Netlify function instance, which is
// fine for v1 -- Clay POSTs are bursty per-table and within-instance limits
// catch a runaway loop before the cost is meaningful. Replace with the
// shared rate-limit helper if cross-instance bounds are needed later.
// ---------------------------------------------------------------------
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 100;
const rateBuckets = new Map<string, number[]>();

function checkRateLimit(tableId: string | null): boolean {
  const key = tableId ?? '__no_table__';
  const now = Date.now();
  const cutoff = now - RATE_WINDOW_MS;
  const arr = rateBuckets.get(key) ?? [];
  // Drop timestamps outside the window.
  const fresh = arr.filter((t) => t > cutoff);
  if (fresh.length >= RATE_MAX) {
    rateBuckets.set(key, fresh);
    return false;
  }
  fresh.push(now);
  rateBuckets.set(key, fresh);
  return true;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // 1. Secret check (constant time, header-based).
  if (!verifyClaySecret(req)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  // 2. Parse body. Tolerate empty / malformed JSON -> 400.
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  const payload = parseClayPayload(rawBody);

  // 3. Rate limit per clay_table_id (or the no-id bucket).
  if (!checkRateLimit(payload.clayTableId)) {
    return NextResponse.json({ ok: false, error: 'rate_limited' }, { status: 429 });
  }

  // 4. Reject payloads with no usable fields. Clay sends test pings; treat
  //    those as 400 so the operator sees the count in the status page.
  if (!payloadIsUseful(payload)) {
    return NextResponse.json({ ok: false, error: 'invalid_payload' }, { status: 400 });
  }

  // 5. Dispatch to the ingester. ingestClayRow never throws -- failures
  //    surface as outcome: 'error'.
  const result = await ingestClayRow(payload, rawBody);

  if (result.outcome === 'error') {
    return NextResponse.json(
      { ok: false, error: 'server_error', detail: result.error ?? null },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    outcome: result.outcome,
    leadId: result.leadId,
    fieldsFilled: result.fieldsFilled ?? undefined
  });
}
