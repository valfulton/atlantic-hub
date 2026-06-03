/**
 * POST /api/admin/av/leads/[audit_id]/draft-email-quick  (#222)
 *
 * One-click "draft me an email for this lead" -- no campaign required.
 *
 * Uses the same generateOutreachDraft engine as the campaign-tied drafter
 * (so it inherits the CLIENT_OFFER briefContext wired in #197 -- the email
 * is written from the client's selling vantage when the lead has a client_id),
 * but does NOT insert a row in outreach_messages. The operator/rep gets a
 * subject + body they can copy, edit, and send from their own mail client.
 *
 * If they then send it for real, they log the effort via the call_log
 * endpoint with kind='email' (or use the "Mark sent" affordance in the UI).
 *
 * Owner + staff only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { isFlagEnabled } from '@/lib/feature-flags';
import {
  generateOutreachDraft,
  OutreachDraftInsufficientDataError,
  OutreachDraftLeadNotFoundError
} from '@/lib/ai/outreach_drafter';
// (#371) Provider/key errors now propagate from inside runLlm; we recognize
// them by name rather than importing the legacy openai/client classes so this
// file doesn't bring the legacy import path back.

export const runtime = 'nodejs';
export const maxDuration = 60;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest, { params }: { params: { audit_id: string } }) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/leads/[audit_id]/draft-email-quick',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  if (!(await isFlagEnabled('tab_av_enabled'))) {
    return NextResponse.json({ error: 'av tab disabled' }, { status: 403 });
  }
  if (!UUID_RE.test(params.audit_id)) {
    return NextResponse.json({ error: 'invalid audit_id' }, { status: 400 });
  }

  // Synthetic "campaign" context -- no real campaign_id, no insert. The
  // drafter still receives a sender display name + cta so the body has a
  // sensible signature line. Sender name is generic; the rep edits as needed.
  const senderDisplayName = 'Our team';
  const campaign = {
    campaignId: 0,
    campaignName: 'Direct outreach',
    offerSummary: null,
    cta: 'Reply if a quick call this week makes sense.',
    signature: null,
    senderDisplayName
  };

  try {
    const draft = await generateOutreachDraft({
      auditId: params.audit_id,
      campaign
    });
    return NextResponse.json({
      ok: true,
      subject: draft.subject,
      body: draft.body,
      groundedExcerpt: draft.groundedExcerpt,
      groundedOnAudit: draft.groundedOnAudit,
      model: draft.model,
      tokensUsed: draft.tokensUsed
    });
  } catch (err) {
    if (err instanceof OutreachDraftLeadNotFoundError) {
      return NextResponse.json({ error: 'lead_not_found' }, { status: 404 });
    }
    if (err instanceof OutreachDraftInsufficientDataError) {
      return NextResponse.json({ error: 'insufficient_data', message: err.message }, { status: 422 });
    }
    const e = err as Error;
    if (e.name === 'OpenAIKeyMissingError' || e.name === 'UnsupportedProviderError') {
      return NextResponse.json({ error: 'llm_key_missing', message: e.message.slice(0, 300) }, { status: 503 });
    }
    if (e.name === 'OpenAIApiError' || e.name === 'OpenRouterTransientError' || e.name === 'GeminiTransientError') {
      return NextResponse.json({ error: 'llm_provider_error', message: e.message.slice(0, 300) }, { status: 502 });
    }
    console.error('[draft-email-quick]', (err as Error).message);
    return NextResponse.json(
      { error: 'draft_failed', message: (err as Error).message.slice(0, 300) },
      { status: 500 }
    );
  }
}
