/**
 * POST /api/admin/av/outreach/draft/[audit_id]
 *
 * Generate a personalized draft for one lead within a campaign. Caller
 * supplies the campaign_id in the body. The draft is inserted into
 * outreach_messages with status='pending_approval' so it appears in the
 * queue. Returns the draft so the UI can preview it inline.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { isFlagEnabled } from '@/lib/feature-flags';
import { getAvDb } from '@/lib/db/av';
import {
  generateOutreachDraft,
  insertDraftRow,
  OutreachDraftInsufficientDataError,
  OutreachDraftLeadNotFoundError
} from '@/lib/ai/outreach_drafter';
// (#371) Provider/key errors caught by name (set by router.ts + openai/client)
// instead of importing the legacy classes.
import type { RowDataPacket } from 'mysql2';

export const runtime = 'nodejs';
export const maxDuration = 60;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface CampaignCtxRow extends RowDataPacket {
  id: number;
  name: string;
  mailbox_id: number;
  ai_offer_summary: string | null;
  ai_cta: string | null;
  ai_signature: string | null;
  status: string;
  mailbox_display_name: string | null;
  mailbox_from_name: string | null;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { audit_id: string } }
) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/outreach/draft/[audit_id]',
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

  let body: { campaign_id?: number; campaignId?: number };
  try {
    body = (await req.json()) as { campaign_id?: number; campaignId?: number };
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  const campaignId = body.campaign_id ?? body.campaignId;
  if (!campaignId || !Number.isFinite(campaignId)) {
    return NextResponse.json({ error: 'campaign_id required' }, { status: 400 });
  }

  const db = getAvDb();
  const [crows] = await db.execute<CampaignCtxRow[]>(
    `SELECT c.id, c.name, c.mailbox_id, c.ai_offer_summary, c.ai_cta, c.ai_signature, c.status,
            mb.display_name AS mailbox_display_name, mb.from_name AS mailbox_from_name
       FROM outreach_campaigns c
       JOIN outreach_mailboxes mb ON mb.id = c.mailbox_id
      WHERE c.id = ? AND c.archived_at IS NULL
      LIMIT 1`,
    [campaignId]
  );
  if (crows.length === 0) {
    return NextResponse.json({ error: 'campaign not found' }, { status: 404 });
  }
  const c = crows[0];

  try {
    const draft = await generateOutreachDraft({
      auditId: params.audit_id,
      campaign: {
        campaignId: c.id,
        campaignName: c.name,
        offerSummary: c.ai_offer_summary,
        cta: c.ai_cta,
        signature: c.ai_signature,
        senderDisplayName:
          c.ai_signature || c.mailbox_from_name || c.mailbox_display_name || 'our team'
      }
    });

    // Look up lead id for the insert. The drafter doesn't return it.
    const [lrows] = await db.execute<(RowDataPacket & { id: number })[]>(
      `SELECT id FROM leads WHERE audit_id = ? AND archived_at IS NULL LIMIT 1`,
      [params.audit_id]
    );
    if (lrows.length === 0) {
      return NextResponse.json({ error: 'lead not found' }, { status: 404 });
    }
    const leadId = lrows[0].id;

    const messageId = await insertDraftRow({
      campaignId: c.id,
      leadId,
      mailboxId: c.mailbox_id,
      draft,
      status: 'pending_approval'
    });

    return NextResponse.json({
      ok: true,
      messageId,
      draft: {
        subject: draft.subject,
        body: draft.body,
        groundedExcerpt: draft.groundedExcerpt,
        groundedOnAudit: draft.groundedOnAudit,
        model: draft.model,
        tokensUsed: draft.tokensUsed
      }
    });
  } catch (err) {
    if (err instanceof OutreachDraftLeadNotFoundError) {
      return NextResponse.json({ error: 'lead not found' }, { status: 404 });
    }
    if (err instanceof OutreachDraftInsufficientDataError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    const e = err as Error;
    if (e.name === 'OpenAIKeyMissingError' || e.name === 'UnsupportedProviderError') {
      return NextResponse.json({ error: e.message }, { status: 503 });
    }
    if (e.name === 'OpenAIApiError' || e.name === 'OpenRouterTransientError' || e.name === 'GeminiTransientError') {
      return NextResponse.json({ error: e.message }, { status: 502 });
    }
    return NextResponse.json({ error: e.message || 'internal error' }, { status: 500 });
  }
}
