/**
 * POST /api/admin/av/leads/[audit_id]/social-content
 *
 * Generates AI-drafted social posts for a specific lead's business.
 * Returns 3 LinkedIn posts + 3 Twitter/X posts + 3 Instagram captions
 * crafted around the lead's company, industry, and existing audit content.
 *
 * Used two ways:
 *   1. As a deliverable bundled into the audit — operator sends the client
 *      "free starter content for your business" as the audit hook
 *   2. As outbound material — operator publishes posts about the industry
 *      vertical and tags the prospect to warm them up
 *
 * Body: { variant?: 'for_prospect' | 'about_industry', count?: number }
 *   - 'for_prospect' (default) — content the PROSPECT could post on their
 *     business's own channels
 *   - 'about_industry' — content the operator could post that would
 *     resonate with this industry vertical
 *
 * Returns: { linkedin: string[], twitter: string[], instagram: string[],
 *            tokensUsed: number, model: string }
 *
 * Cost: ~$0.005-0.01 per generation (gpt-4o-mini at ~1500 token completion).
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { isFlagEnabled } from '@/lib/feature-flags';
import { getAvDb } from '@/lib/db/av';
import { parseOpenAIJson, OpenAIKeyMissingError, OpenAIApiError } from '@/lib/openai/client';
import { runLlm } from '@/lib/llm/router';
import { getSystemPrompt } from '@/lib/ai/prompt_registry';
import { logEvent } from '@/lib/events/log';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';

export const runtime = 'nodejs';
export const maxDuration = 60;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface LeadRow extends RowDataPacket {
  id: number;
  client_id: number | null;
  company: string;
  industry: string | null;
  contact_name: string | null;
  contact_title: string | null;
  website: string | null;
  audit_content: string | null;
  challenge: string | null;
}

interface AiSocialPayload {
  linkedin: string[];
  twitter: string[];
  instagram: string[];
}

export async function POST(req: NextRequest, { params }: { params: { audit_id: string } }) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/leads/[audit_id]/social-content',
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

  let payload: Record<string, unknown> = {};
  try {
    payload = await req.json();
  } catch {
    // empty body is fine — defaults take over
  }

  const variant = payload.variant === 'about_industry' ? 'about_industry' : 'for_prospect';
  const count = Math.min(5, Math.max(1, Number(payload.count) || 3));

  const db = getAvDb();
  const [rows] = await db.execute<LeadRow[]>(
    `SELECT id, client_id, company, industry, contact_name, contact_title, website, audit_content, challenge
     FROM leads WHERE audit_id = ? AND archived_at IS NULL LIMIT 1`,
    [params.audit_id]
  );
  if (rows.length === 0) {
    return NextResponse.json({ error: 'lead not found' }, { status: 404 });
  }
  const lead = rows[0];

  const systemPrompt =
    variant === 'about_industry'
      ? buildAboutIndustryPrompt(lead, count)
      : buildForProspectPrompt(lead, count);

  const startMs = Date.now();
  // (#80) Operator-editable system prompt: getSystemPrompt returns the override
  // from ai_prompt_overrides if set, else SOCIAL_CONTENT_GENERATOR_DEFAULT.
  const editableSystemPrompt = await getSystemPrompt('social_content_generator');
  try {
    // (#371) Migrated onto runLlm — content-hash cached, three-tier provider
    // fallback, per-microcent cost logging. cachePolicy for social_caption is
    // 'none' (creative output, never reuse) so re-runs always hit live.
    const completion = await runLlm({
      taskKind: 'social_caption',
      note: `social-content variant=${variant} count=${count} lead=${lead.id}`,
      clientId: lead.client_id ?? null,
      prompt: `SYSTEM:\n${editableSystemPrompt}\n\nUSER:\n${systemPrompt}`,
      cacheKeyExtras: [String(lead.id), variant, String(count)],
      temperature: 0.85,
      maxTokens: 1800,
      json: true
    });

    const parsed = parseOpenAIJson<AiSocialPayload>(completion.text);
    if (!parsed || !Array.isArray(parsed.linkedin)) {
      await logEvent({
        eventType: 'ai.social_content_generated',
        leadId: lead.id,
        userId: guard.actor.userId,
        source: 'openai',
        status: 'failure',
        payload: { company: lead.company, variant, count, raw_first_300: completion.text.slice(0, 300) },
        errorMessage: 'malformed JSON from openai',
        executionTimeMs: Date.now() - startMs
      });
      return NextResponse.json(
        {
          error: 'AI returned malformed JSON — try again',
          rawResponse: completion.text.slice(0, 500)
        },
        { status: 502 }
      );
    }

    await logEvent({
      eventType: 'ai.social_content_generated',
      leadId: lead.id,
      userId: guard.actor.userId,
      source: 'openai',
      status: 'success',
      payload: {
        company: lead.company,
        variant,
        count,
        linkedin_n: parsed.linkedin?.length ?? 0,
        twitter_n: parsed.twitter?.length ?? 0,
        instagram_n: parsed.instagram?.length ?? 0,
        tokens_used: (completion.inputTokens + completion.outputTokens),
        model: completion.model
      },
      executionTimeMs: Date.now() - startMs
    });

    // Persist every generated draft into lead_social_drafts so other surfaces
    // (Commercials tab "Use a recent social post" dropdown, future scheduled
    // publishing) can pull these EXACT posts without another LLM call.
    // Errors here are swallowed -- the operator still gets the response.
    void persistDrafts({
      leadId: lead.id,
      variant,
      model: completion.model,
      tokensTotal: (completion.inputTokens + completion.outputTokens),
      actorUserId: guard.actor.userId,
      drafts: [
        ...(parsed.linkedin ?? []).map((body) => ({ platform: 'linkedin' as const, body })),
        ...(parsed.twitter ?? []).map((body) => ({ platform: 'twitter' as const, body })),
        ...(parsed.instagram ?? []).map((body) => ({ platform: 'instagram' as const, body }))
      ]
    });

    return NextResponse.json({
      ok: true,
      variant,
      company: lead.company,
      industry: lead.industry,
      linkedin: parsed.linkedin ?? [],
      twitter: parsed.twitter ?? [],
      instagram: parsed.instagram ?? [],
      usage: {
        tokens: (completion.inputTokens + completion.outputTokens),
        model: completion.model
      }
    });
  } catch (err) {
    if (err instanceof OpenAIKeyMissingError) {
      await logEvent({
        eventType: 'api.openai_error',
        leadId: lead.id,
        userId: guard.actor.userId,
        source: 'openai',
        status: 'failure',
        payload: { route: 'social-content', variant },
        errorMessage: 'OPENAI_API_KEY missing'
      });
      return NextResponse.json(
        { error: 'OPENAI_API_KEY not configured in Netlify env vars' },
        { status: 503 }
      );
    }
    if (err instanceof OpenAIApiError) {
      await logEvent({
        eventType: err.status === 429 ? 'api.rate_limited' : 'api.openai_error',
        leadId: lead.id,
        userId: guard.actor.userId,
        source: 'openai',
        status: 'failure',
        payload: { route: 'social-content', status_code: err.status },
        errorMessage: err.body.slice(0, 500),
        executionTimeMs: Date.now() - startMs
      });
      return NextResponse.json(
        { error: 'openai api error', detail: err.body.slice(0, 500), status: err.status },
        { status: 502 }
      );
    }
    console.error('[av:social-content]', (err as Error).message);
    await logEvent({
      eventType: 'workflow.failed',
      leadId: lead.id,
      userId: guard.actor.userId,
      source: 'openai',
      status: 'failure',
      payload: { route: 'social-content' },
      errorMessage: (err as Error).message.slice(0, 500)
    });
    return NextResponse.json(
      { error: 'server error', errorClass: (err as Error).name },
      { status: 500 }
    );
  }
}

// System prompt now lives in lib/ai/prompt_registry.ts under the
// 'social_content_generator' PROMPT_DEF (operator-editable, #80). Live calls
// above read it via getSystemPrompt('social_content_generator').

function buildForProspectPrompt(lead: LeadRow, count: number): string {
  const industry = lead.industry ?? 'small business';
  const website = lead.website ?? 'their website';
  const auditExcerpt = lead.audit_content ? truncate(lead.audit_content, 1200) : null;

  return `Generate ${count} social posts per platform that ${lead.company} (a ${industry} business) could publish on their OWN channels to attract new customers.

Business context:
- Company: ${lead.company}
- Industry: ${industry}
- Website: ${website}
${lead.contact_name ? `- Primary contact: ${lead.contact_name}${lead.contact_title ? `, ${lead.contact_title}` : ''}` : ''}
${auditExcerpt ? `- Strategic audit summary: ${auditExcerpt}` : ''}

The posts should:
- Speak in ${lead.company}'s voice (first person plural — "we", "our team")
- Sell to THEIR ideal customers, not to other agencies
- Highlight something specific about their business or industry
- Drive engagement (questions, polls, hooks) — not just announcements
- Mix tones: 1 thought-leadership, 1 behind-the-scenes/story, 1 promotional with a CTA

Return JSON only, with exactly ${count} posts per array.`;
}

function buildAboutIndustryPrompt(lead: LeadRow, count: number): string {
  const industry = lead.industry ?? 'this industry';

  return `Generate ${count} social posts per platform that Atlantic & Vine could publish to engage prospects in the ${industry} industry, with ${lead.company} being a representative example of the audience.

Goal: warm up decision-makers in this vertical by showing we understand their world. Posts should:
- Reference common pain points specific to ${industry}
- Position Atlantic & Vine as the operator who gets it
- NOT mention ${lead.company} by name (this is industry-wide content, not a callout)
- End with a soft CTA (question, hook, or invitation to engage) — not a hard sell
- Mix: 1 problem-naming post, 1 trend/insight post, 1 contrarian or pattern-break post

Return JSON only, with exactly ${count} posts per array.`;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max).replace(/\s+\S*$/, '') + '…';
}

/**
 * Best-effort persistence of generated social drafts. Never throws --
 * the operator's response shouldn't fail just because we couldn't save.
 * Spreads the run's tokens proportionally across drafts for an admin-only
 * cost trail.
 */
async function persistDrafts(args: {
  leadId: number;
  variant: string;
  model: string;
  tokensTotal: number;
  actorUserId: number | null;
  drafts: { platform: 'linkedin' | 'twitter' | 'instagram'; body: string }[];
}): Promise<void> {
  if (args.drafts.length === 0) return;
  const tokensPer = Math.max(1, Math.round(args.tokensTotal / args.drafts.length));
  try {
    const db = getAvDb();
    for (const d of args.drafts) {
      if (!d.body || d.body.length > 8000) continue;
      try {
        await db.execute<ResultSetHeader>(
          `INSERT INTO lead_social_drafts
             (lead_id, platform, variant, body_text, char_count, status, model, tokens_used, created_by_user_id)
           VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
          [
            args.leadId,
            d.platform,
            args.variant,
            d.body,
            d.body.length,
            args.model,
            tokensPer,
            args.actorUserId
          ]
        );
      } catch (innerErr) {
        // If the table doesn't exist yet (schema 018 not applied), bail
        // quietly for the rest of this batch rather than spamming logs.
        console.error('[social-drafts:persist]', (innerErr as Error).message);
        return;
      }
    }
  } catch (err) {
    console.error('[social-drafts:persist]', (err as Error).message);
  }
}
