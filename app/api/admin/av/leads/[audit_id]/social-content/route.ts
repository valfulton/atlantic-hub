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
import {
  openaiChatCompletion,
  parseOpenAIJson,
  OpenAIKeyMissingError,
  OpenAIApiError
} from '@/lib/openai/client';
import type { RowDataPacket } from 'mysql2';

export const runtime = 'nodejs';
export const maxDuration = 60;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface LeadRow extends RowDataPacket {
  id: number;
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
    `SELECT id, company, industry, contact_name, contact_title, website, audit_content, challenge
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

  try {
    const completion = await openaiChatCompletion(
      [
        { role: 'system', content: SYSTEM_INSTRUCTIONS },
        { role: 'user', content: systemPrompt }
      ],
      { json: true, temperature: 0.85, maxTokens: 1800 }
    );

    const parsed = parseOpenAIJson<AiSocialPayload>(completion.text);
    if (!parsed || !Array.isArray(parsed.linkedin)) {
      return NextResponse.json(
        {
          error: 'AI returned malformed JSON — try again',
          rawResponse: completion.text.slice(0, 500)
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      ok: true,
      variant,
      company: lead.company,
      industry: lead.industry,
      linkedin: parsed.linkedin ?? [],
      twitter: parsed.twitter ?? [],
      instagram: parsed.instagram ?? [],
      usage: {
        tokens: completion.usage.totalTokens,
        model: completion.model
      }
    });
  } catch (err) {
    if (err instanceof OpenAIKeyMissingError) {
      return NextResponse.json(
        { error: 'OPENAI_API_KEY not configured in Netlify env vars' },
        { status: 503 }
      );
    }
    if (err instanceof OpenAIApiError) {
      return NextResponse.json(
        { error: 'openai api error', detail: err.body.slice(0, 500), status: err.status },
        { status: 502 }
      );
    }
    console.error('[av:social-content]', (err as Error).message);
    return NextResponse.json(
      { error: 'server error', errorClass: (err as Error).name },
      { status: 500 }
    );
  }
}

const SYSTEM_INSTRUCTIONS = `You are a senior B2B social media copywriter for Atlantic & Vine, an AI-native marketing intelligence platform.

Your output is ALWAYS valid JSON matching this exact shape:
{
  "linkedin": [string, string, ...],
  "twitter": [string, string, ...],
  "instagram": [string, string, ...]
}

Each platform's posts must be tuned to platform conventions:
- LinkedIn: 3-5 sentences, professional but human, hook in line 1, no hashtag stuffing (1-3 max at end), no emojis except sparingly
- Twitter/X: under 280 chars each, punchy, conversational, one idea per post, 0-2 hashtags max
- Instagram: 2-4 sentences + line break + 5-10 relevant hashtags. Slightly warmer tone, can use 1-2 emojis if it fits

Never use placeholder text like "[Insert thing here]". Generate real, ready-to-publish posts.
Never wrap output in markdown code fences. Return JSON only.`;

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
