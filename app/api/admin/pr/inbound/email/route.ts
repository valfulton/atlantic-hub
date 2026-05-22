/**
 * /api/admin/pr/inbound/email
 *
 * PUBLIC inbound-parse webhook for the PR inbox (PR@api.atlanticandvine.com).
 * Lives under /api/admin/* for code organization but is called by an external
 * inbound-email service (or a forwarding rule) that has no operator session, so
 * it authenticates itself with a shared secret in the X-Webhook-Secret header --
 * exactly the Clay webhook pattern (lib/clay/webhook.ts). It is exempted from the
 * operator session wall in middleware.ts PUBLIC_WEBHOOK_PATHS.
 *
 * Flow: verify secret -> extract one or more raw items from the payload ->
 * ingestRawItem() for each (dedupe -> parseOpportunity -> pr_opportunities
 * origin='email_inbox' -> pr_ingestion_log). See lib/pr/ingest.ts.
 *
 * Honest scope: each posted item becomes ONE opportunity. We do NOT attempt to
 * blindly split a multi-request digest into pieces (that is unreliable); the
 * forwarding/inbound-parse service (or a Zapier step) is expected to post one
 * request per call, or an explicit `items` array. Qwoted / Featured /
 * SourceBottle / Help-a-B2B-Writer / Google Alerts all email digests the
 * operator points at this endpoint.
 *
 * Env: PR_INBOUND_EMAIL_SECRET (shared secret; mirror CLAY_WEBHOOK_SECRET).
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  verifyPrInboundSecret,
  ingestBatch,
  type RawInboundItem
} from '@/lib/pr/ingest';
import { DEFAULT_TENANT, isPrSource } from '@/lib/pr/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

const BATCH_CAP = 25;

/**
 * GET -> reachability check. Secret-gated so the public path does not leak
 * configuration. Returns 200 only when the X-Webhook-Secret matches; lets the
 * operator confirm the endpoint is wired before pointing a forwarder at it.
 */
export async function GET(req: NextRequest) {
  if (!verifyPrInboundSecret(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return NextResponse.json({ ok: true, endpoint: 'pr-inbound-email', expects: 'POST { rawText | items[] }' });
}

export async function POST(req: NextRequest) {
  if (!verifyPrInboundSecret(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // Accept JSON (most inbound-parse providers / Zapier) or urlencoded form posts
  // (some raw inbound-email services). Fall back to treating the body as text.
  let body: Record<string, unknown> = {};
  const ct = req.headers.get('content-type') || '';
  try {
    if (ct.includes('application/json')) {
      body = (await req.json()) as Record<string, unknown>;
    } else if (ct.includes('application/x-www-form-urlencoded') || ct.includes('multipart/form-data')) {
      const form = await req.formData();
      for (const [k, v] of form.entries()) {
        if (typeof v === 'string') body[k] = v;
      }
    } else {
      const text = await req.text();
      try {
        body = JSON.parse(text) as Record<string, unknown>;
      } catch {
        body = { rawText: text };
      }
    }
  } catch {
    return NextResponse.json({ error: 'could not read request body' }, { status: 400 });
  }

  const tenantId =
    typeof body.tenantId === 'string' && body.tenantId ? body.tenantId.slice(0, 64) : DEFAULT_TENANT;

  const items = extractItems(body);
  if (!items.length) {
    return NextResponse.json(
      { error: 'no usable content: provide rawText, or an items[] array, or an email subject+body' },
      { status: 400 }
    );
  }

  try {
    const summary = await ingestBatch({ items, origin: 'email_inbox', tenantId, cap: BATCH_CAP });
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    console.error('[pr:inbound:email]', (err as Error).message);
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// Payload extraction -- fuzzy, like the Clay receiver, because inbound-email
// providers all shape their POST differently (SendGrid Inbound Parse, Mailgun,
// CloudMailin, Zapier email parser, raw forwards).
// ---------------------------------------------------------------------------

function extractItems(body: Record<string, unknown>): RawInboundItem[] {
  // 1. Explicit items[] array wins.
  if (Array.isArray(body.items)) {
    const out: RawInboundItem[] = [];
    for (const raw of body.items as unknown[]) {
      const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
      const text = firstString(obj, ['rawText', 'text', 'body', 'plain', 'body_plain', 'content', 'description']);
      if (!text) continue;
      out.push({
        rawText: assemble(firstString(obj, ['subject', 'title']), text),
        source: isPrSource(obj.source) ? obj.source : null,
        externalId: firstString(obj, ['externalId', 'id', 'guid', 'message_id', 'messageId']),
        url: firstString(obj, ['url', 'link', 'permalink'])
      });
    }
    if (out.length) return out;
  }

  // 2. Single explicit rawText.
  const explicit = firstString(body, ['rawText']);
  if (explicit) {
    return [
      {
        rawText: explicit,
        source: isPrSource(body.source) ? body.source : null,
        externalId: firstString(body, ['externalId', 'message_id', 'messageId', 'id']),
        url: firstString(body, ['url', 'link'])
      }
    ];
  }

  // 3. An inbound-email shape: subject + a text/plain body.
  const subject = firstString(body, ['subject', 'Subject', 'title']);
  const text = firstString(body, [
    'text',
    'plain',
    'body-plain',
    'body_plain',
    'bodyPlain',
    'TextBody',
    'stripped-text',
    'html',
    'body',
    'content'
  ]);
  if (subject || text) {
    return [
      {
        rawText: assemble(subject, stripHtmlIfNeeded(text)),
        source: isPrSource(body.source) ? body.source : null,
        externalId: firstString(body, ['Message-Id', 'message_id', 'messageId', 'MessageID']),
        url: firstString(body, ['url', 'link'])
      }
    ];
  }

  return [];
}

function assemble(subject: string | null, text: string | null): string {
  const s = subject?.trim();
  const t = text?.trim();
  if (s && t) return `${s}\n\n${t}`;
  return (t || s || '').trim();
}

/** Best-effort HTML -> text only when the value clearly looks like HTML. */
function stripHtmlIfNeeded(v: string | null): string | null {
  if (!v) return v;
  if (!/<[a-z][\s\S]*>/i.test(v)) return v;
  return v
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<\/(p|div|br|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function firstString(src: Record<string, unknown>, keys: string[]): string | null {
  const norm = new Map<string, string>();
  for (const k of Object.keys(src)) norm.set(normKey(k), k);
  for (const k of keys) {
    const realKey = norm.get(normKey(k));
    if (!realKey) continue;
    const v = src[realKey];
    if (typeof v === 'string') {
      const t = v.trim();
      if (t.length > 0) return t;
    }
  }
  return null;
}

function normKey(k: string): string {
  return k.toLowerCase().replace(/[\s\-_.]+/g, '');
}
