/**
 * POST /api/webhooks/netlify-forms
 *
 * Endpoint that Netlify Forms POSTs to when a new submission arrives.
 *
 * - Header check: X-Atlantic-Hub-Webhook-Secret (constant-time compare)
 * - Rate limit: 120 req/min per IP
 * - Feature flag: webhook_ingestion_enabled
 * - Idempotent on Netlify submission.id (re-deliveries return 200 'duplicate')
 *
 * On success returns 200 + JSON status. On 5xx, Netlify will auto-retry.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyWebhookSecret } from '@/lib/webhook/verify-secret';
import { ingestNetlifyFormsSubmission } from '@/lib/webhook/ingest-netlify-form';
import { checkAndConsume, WEBHOOK_RATE_LIMIT } from '@/lib/rate-limit';
import { writeAuditRow, extractClientIp } from '@/lib/audit';
import { isFlagEnabled } from '@/lib/feature-flags';
import { ipHash } from '@/lib/crypto/hash';

export const runtime = 'nodejs';

const MAX_BODY_BYTES = 100_000; // 100 KB cap on webhook payload

export async function POST(req: NextRequest) {
  const ip = extractClientIp(req.headers);
  const ua = req.headers.get('user-agent');

  // Rate limit per source IP.
  const rl = await checkAndConsume({
    bucketKey: `webhook:ip:${ipHash(ip)}`,
    limit: WEBHOOK_RATE_LIMIT.limit,
    windowSeconds: WEBHOOK_RATE_LIMIT.windowSeconds
  });
  if (!rl.allowed) {
    await writeAuditRow({
      targetResource: '/api/webhooks/netlify-forms',
      action: 'webhook_rate_limited',
      ip, userAgent: ua, statusCode: 429, errorClass: 'RateLimited'
    });
    return NextResponse.json({ error: 'rate limited' }, { status: 429 });
  }

  // Secret verification.
  const provided = req.headers.get('x-atlantic-hub-webhook-secret');
  if (!verifyWebhookSecret(provided)) {
    await writeAuditRow({
      targetResource: '/api/webhooks/netlify-forms',
      action: 'webhook_bad_secret',
      ip, userAgent: ua, statusCode: 401, errorClass: 'BadWebhookSecret'
    });
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // Feature flag.
  if (!(await isFlagEnabled('webhook_ingestion_enabled'))) {
    await writeAuditRow({
      targetResource: '/api/webhooks/netlify-forms',
      action: 'webhook_disabled',
      ip, userAgent: ua, statusCode: 503, errorClass: 'WebhookDisabled'
    });
    return NextResponse.json({ error: 'webhook ingestion disabled' }, { status: 503 });
  }

  // Read body with a cap.
  let raw: string;
  try {
    raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) {
      await writeAuditRow({
        targetResource: '/api/webhooks/netlify-forms',
        action: 'webhook_body_too_large',
        ip, userAgent: ua, statusCode: 413, errorClass: 'PayloadTooLarge'
      });
      return NextResponse.json({ error: 'payload too large' }, { status: 413 });
    }
  } catch {
    return NextResponse.json({ error: 'cannot read body' }, { status: 400 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    await writeAuditRow({
      targetResource: '/api/webhooks/netlify-forms',
      action: 'webhook_bad_json',
      ip, userAgent: ua, statusCode: 400, errorClass: 'BadJSON'
    });
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  try {
    const result = await ingestNetlifyFormsSubmission(payload as Record<string, unknown>, raw);

    await writeAuditRow({
      tenantId: 'hunterhoney',
      targetResource: '/api/webhooks/netlify-forms',
      action: `webhook_ingest_${result.status}`,
      ip,
      userAgent: ua,
      statusCode: result.status === 'failed' ? 500 : 200,
      errorClass: result.error ? 'IngestFailed' : null
    });

    if (result.status === 'failed') {
      return NextResponse.json({ status: 'failed', error: result.error }, { status: 500 });
    }
    return NextResponse.json({ status: result.status }, { status: 200 });
  } catch (err) {
    await writeAuditRow({
      targetResource: '/api/webhooks/netlify-forms',
      action: 'webhook_exception',
      ip, userAgent: ua, statusCode: 500, errorClass: (err as Error).name
    });
    return NextResponse.json({ error: 'server error' }, { status: 500 });
  }
}
