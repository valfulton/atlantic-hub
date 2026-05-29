/**
 * /api/pr/inbox/[slug]  (#226)
 *
 * PER-CLIENT public PR inbox. HostGator's catch-all on pr.atlanticandvine.com
 * forwards every inbound email to POST <this URL>/<slug>, where <slug> matches
 * the client_users.pr_inbox_slug column. The slug IS the authentication.
 *
 * Body shape: same as /api/admin/pr/inbound/email -- inbound-email providers
 * post JSON with subject/body OR form-encoded fields OR raw text. The actual
 * ingestion is delegated to the existing ingestBatch() / parseOpportunity()
 * pipeline so we get dedupe + structured parsing + matched_lead_id for free.
 *
 * What's different from the global inbox:
 *   - No X-Webhook-Secret header required. The slug IS the secret. Slugs are
 *     ~72 bits of entropy (a-z0-9-, 14 random chars after a name hint).
 *   - We log the routed_via_client_id on each created opportunity so the
 *     per-client PR section (#213) can surface them even when the parser
 *     couldn't match a specific lead.
 *
 * Add this path's PREFIX to middleware.ts PUBLIC_WEBHOOK_PATHS handling so
 * the operator-session wall lets it through.
 *
 * Failure modes:
 *   - Unknown slug -> 404. Don't leak which slugs exist.
 *   - Empty body  -> 400 with helpful message.
 *   - Ingest throws -> 500, logged to system_events via the ingester.
 */
import { NextRequest, NextResponse } from 'next/server';
import { findClientBySlug } from '@/lib/clients/pr_inbox';
import { ingestBatch, type RawInboundItem } from '@/lib/pr/ingest';
import { DEFAULT_TENANT, isPrSource } from '@/lib/pr/types';
import { logEvent } from '@/lib/events/log';

export const runtime = 'nodejs';
export const maxDuration = 60;

const BATCH_CAP = 25;

export async function GET(req: NextRequest, { params }: { params: { slug: string } }) {
  const client = await findClientBySlug(params.slug);
  if (!client) {
    return NextResponse.json({ error: 'unknown_slug' }, { status: 404 });
  }
  // Don't echo the client name -- keep this endpoint opaque even when probed.
  return NextResponse.json({
    ok: true,
    endpoint: 'pr-inbox-per-client',
    expects: 'POST { rawText | items[] } or an inbound-email shape'
  });
}

export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  const client = await findClientBySlug(params.slug);
  if (!client) {
    return NextResponse.json({ error: 'unknown_slug' }, { status: 404 });
  }

  // Accept JSON, form-encoded, or raw text -- same as the global inbox at
  // /api/admin/pr/inbound/email. Mirrored intentionally so a single
  // forwarding rule works for both paths.
  let body: Record<string, unknown> = {};
  const ct = req.headers.get('content-type') || '';
  try {
    if (ct.includes('application/json')) {
      body = (await req.json()) as Record<string, unknown>;
    } else if (ct.includes('application/x-www-form-urlencoded') || ct.includes('multipart/form-data')) {
      const form = await req.formData();
      for (const [k, v] of form.entries()) if (typeof v === 'string') body[k] = v;
    } else {
      const text = await req.text();
      try { body = JSON.parse(text) as Record<string, unknown>; }
      catch { body = { rawText: text }; }
    }
  } catch {
    return NextResponse.json({ error: 'could not read request body' }, { status: 400 });
  }

  const items = extractItems(body);
  if (!items.length) {
    return NextResponse.json(
      { error: 'no usable content: provide rawText, an items[] array, or subject+body' },
      { status: 400 }
    );
  }

  try {
    const summary = await ingestBatch({
      items,
      origin: 'email_inbox',
      tenantId: DEFAULT_TENANT,
      cap: BATCH_CAP
    });
    // Log the client routing so the per-client PR section (#213) can attribute
    // any opportunity that came in via this slug -- useful even when the
    // parser couldn't match a specific lead inside the client's pipeline.
    await logEvent({
      eventType: 'pr.inbox_routed_per_client',
      source: 'pr_inbox',
      payload: {
        client_id: client.clientId,
        slug: params.slug,
        items_received: items.length,
        items_parsed: summary.parsed,
        items_duplicate: summary.duplicate,
        items_failed: summary.failed
      }
    });
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    console.error('[pr:inbox:slug]', (err as Error).message);
    return NextResponse.json({ error: 'server_error', errorClass: (err as Error).name }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// Payload extraction -- mirrors app/api/admin/pr/inbound/email/route.ts so a
// single forwarding rule works for both endpoints. Duplicated intentionally
// rather than imported because the global inbox lives under /api/admin/* and
// I don't want a public route reaching into admin-namespaced helpers.
// ---------------------------------------------------------------------------

function extractItems(body: Record<string, unknown>): RawInboundItem[] {
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
  const explicit = firstString(body, ['rawText']);
  if (explicit) {
    return [{
      rawText: explicit,
      source: isPrSource(body.source) ? body.source : null,
      externalId: firstString(body, ['externalId', 'message_id', 'messageId', 'id']),
      url: firstString(body, ['url', 'link'])
    }];
  }
  const subject = firstString(body, ['subject', 'Subject', 'title']);
  const text = firstString(body, [
    'text', 'plain', 'body-plain', 'body_plain', 'bodyPlain', 'TextBody',
    'stripped-text', 'html', 'body', 'content'
  ]);
  if (subject || text) {
    return [{
      rawText: assemble(subject, stripHtmlIfNeeded(text)),
      source: isPrSource(body.source) ? body.source : null,
      externalId: firstString(body, ['Message-Id', 'message_id', 'messageId', 'MessageID']),
      url: firstString(body, ['url', 'link'])
    }];
  }
  return [];
}

function assemble(subject: string | null, text: string | null): string {
  const s = subject?.trim();
  const t = text?.trim();
  if (s && t) return `${s}\n\n${t}`;
  return (t || s || '').trim();
}

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
