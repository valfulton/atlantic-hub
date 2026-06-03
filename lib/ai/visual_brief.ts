/**
 * lib/ai/visual_brief.ts
 *
 * Per-lead VISUAL BRIEF generator. The audit_content was written for sales
 * strategy (problem framing, ICP, segmentation). It is the wrong source
 * for visual commercial generation. This module runs a SECOND OpenAI pass
 * that converts the audit + company context into a structured creative
 * direction the Grok discoverer can consume to make on-brand commercials.
 *
 * Public entry points:
 *   generateVisualBriefForLead(leadId, opts) -> persists a new active brief
 *   getActiveBriefForLead(leadId)            -> latest active brief or null
 *
 * Lifecycle:
 *   - Each generation supersedes the previous active brief for the same lead.
 *   - The brief is consumed by lib/grok/discoverer.ts BEFORE the prompt
 *     builder; if no brief exists, the discoverer falls back to the legacy
 *     audit-driven prompt (backward compat).
 *
 * NOTE on internal vs client surfaces:
 *   The visual brief is INTERNAL infrastructure. Cost / token usage MAY
 *   be exposed in admin surfaces. NEVER show brief raw output, model name,
 *   or cost on client-facing surfaces. See docs/CLIENT_FACING_GUARDRAILS.md.
 */

import { getAvDb } from '@/lib/db/av';
import { parseOpenAIJson } from '@/lib/openai/client';
import { runLlm } from '@/lib/llm/router';
import { getSystemPrompt } from '@/lib/ai/prompt_registry';
import { logEvent } from '@/lib/events/log';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';

export interface VisualBrief {
  heroShot: string;
  brandMood: string;
  palette: string[];
  motifs: string[];
  donts: string[];
  customerPersona: string;
  videoPacing: string;
  textOverlayHook: string;
}

export interface VisualBriefRecord extends VisualBrief {
  id: number;
  leadId: number;
  rawResponse: object | null;
  sourceAuditId: string | null;
  model: string;
  tokensUsed: number | null;
  costUsd: number | null;
  status: 'active' | 'superseded' | 'failed';
  errorMessage: string | null;
  createdAt: string;
  supersededAt: string | null;
}

interface LeadContextRow extends RowDataPacket {
  id: number;
  audit_id: string;
  company: string;
  industry: string | null;
  contact_title: string | null;
  website: string | null;
  audit_content: string | null;
  challenge: string | null;
}

interface BriefRow extends RowDataPacket {
  id: number;
  lead_id: number;
  hero_shot: string | null;
  brand_mood: string | null;
  palette_json: string | null;
  motifs_json: string | null;
  donts_json: string | null;
  customer_persona: string | null;
  video_pacing: string | null;
  text_overlay_hook: string | null;
  raw_response_json: string | null;
  source_audit_id: string | null;
  model: string;
  tokens_used: number | null;
  cost_usd: string | number | null;
  status: 'active' | 'superseded' | 'failed';
  error_message: string | null;
  created_at: string;
  superseded_at: string | null;
  created_by_user_id: number | null;
}

// System prompt now lives in lib/ai/prompt_registry.ts under the
// 'visual_brief' PROMPT_DEF (operator-editable, #80). Live calls below read
// it via getSystemPrompt('visual_brief').

function buildUserPrompt(lead: LeadContextRow, narrativeContext?: string | null): string {
  const industry = lead.industry ? lead.industry.replace(/_/g, ' ') : 'small business';
  const audit = lead.audit_content ? truncate(lead.audit_content, 3000) : '';

  const sections: string[] = [
    `Company: ${lead.company}`,
    `Industry: ${industry}`
  ];
  if (lead.website) sections.push(`Website: ${lead.website}`);
  if (lead.contact_title) sections.push(`Primary contact title: ${lead.contact_title}`);
  if (lead.challenge) sections.push(`Stated challenge: ${lead.challenge}`);
  if (audit) sections.push(`Strategic audit (use as raw material for tone, audience, and pain points):\n${audit}`);
  // The active narrative line steers the visual direction (emotional driver +
  // authority angle become the mood + framing). This is how a commercial lands
  // on-thesis — e.g. "Your team doesn't need another ballroom."
  if (narrativeContext && narrativeContext.trim()) {
    sections.push(`${narrativeContext.trim()}\n(Let this narrative line drive the mood, hero moment, and emotional framing of the brief.)`);
  }

  return `${sections.join('\n\n')}\n\nReturn ONLY the JSON visual brief.`;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max).replace(/\s+\S*$/, '') + '...';
}

function safeParseJsonArray(s: string | null): string[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function safeParseJsonObject(s: string | null): object | null {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function rowToRecord(row: BriefRow): VisualBriefRecord {
  return {
    id: row.id,
    leadId: row.lead_id,
    heroShot: row.hero_shot ?? '',
    brandMood: row.brand_mood ?? '',
    palette: safeParseJsonArray(row.palette_json),
    motifs: safeParseJsonArray(row.motifs_json),
    donts: safeParseJsonArray(row.donts_json),
    customerPersona: row.customer_persona ?? '',
    videoPacing: row.video_pacing ?? '',
    textOverlayHook: row.text_overlay_hook ?? '',
    rawResponse: safeParseJsonObject(row.raw_response_json),
    sourceAuditId: row.source_audit_id,
    model: row.model,
    tokensUsed: row.tokens_used,
    costUsd: row.cost_usd == null ? null : Number(row.cost_usd),
    status: row.status,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    supersededAt: row.superseded_at
  };
}

// ---------------------------------------------------------------------
// Public read: latest active brief for a lead, or null.
// ---------------------------------------------------------------------
export async function getActiveBriefForLead(leadId: number): Promise<VisualBriefRecord | null> {
  const db = getAvDb();
  const [rows] = await db.execute<BriefRow[]>(
    `SELECT id, lead_id, hero_shot, brand_mood, palette_json, motifs_json, donts_json,
            customer_persona, video_pacing, text_overlay_hook, raw_response_json,
            source_audit_id, model, tokens_used, cost_usd, status, error_message,
            created_at, superseded_at, created_by_user_id
     FROM lead_visual_briefs
     WHERE lead_id = ? AND status = 'active'
     ORDER BY created_at DESC
     LIMIT 1`,
    [leadId]
  );
  const row = rows[0];
  return row ? rowToRecord(row) : null;
}

// ---------------------------------------------------------------------
// Public write: generate a new brief for this lead and persist it.
// Supersedes any prior active brief.
// ---------------------------------------------------------------------
export async function generateVisualBriefForLead(
  leadId: number,
  opts: { actorUserId?: number | null; force?: boolean; narrativeContext?: string | null } = {}
): Promise<VisualBriefRecord> {
  const db = getAvDb();
  const actorUserId = opts.actorUserId ?? null;

  // (#371) Also fetch client_id for per-client cost attribution.
  const [leadRows] = await db.execute<(LeadContextRow & { client_id: number | null })[]>(
    `SELECT id, client_id, audit_id, company, industry, contact_title, website, audit_content, challenge
     FROM leads WHERE id = ? AND archived_at IS NULL LIMIT 1`,
    [leadId]
  );
  const lead = leadRows[0];
  if (!lead) throw new Error(`lead ${leadId} not found or archived`);

  // If a brief already exists and force=false, just return it.
  if (!opts.force) {
    const existing = await getActiveBriefForLead(leadId);
    if (existing) return existing;
  }

  const startMs = Date.now();
  // (#80) Operator-editable system prompt: getSystemPrompt returns the override
  // from ai_prompt_overrides if set, else VISUAL_BRIEF_DEFAULT.
  const systemPrompt = await getSystemPrompt('visual_brief');
  try {
    // (#371) Migrated onto runLlm. cachePolicy 'none' (creative output, never
    // reuse). Per-client cost attribution via clientId thread.
    const completion = await runLlm({
      taskKind: 'visual_brief',
      note: `visual-brief lead=${leadId}`,
      clientId: lead.client_id,
      prompt: `SYSTEM:\n${systemPrompt}\n\nUSER:\n${buildUserPrompt(lead, opts.narrativeContext)}`,
      cacheKeyExtras: [String(leadId)],
      temperature: 0.6,
      maxTokens: 1200,
      json: true
    });

    const parsed = parseOpenAIJson<VisualBrief>(completion.text);
    if (!parsed || !parsed.heroShot) {
      throw new Error('Model returned malformed visual brief JSON');
    }

    // Supersede any previous active briefs in a single statement.
    await db.execute<ResultSetHeader>(
      `UPDATE lead_visual_briefs
       SET status='superseded', superseded_at=NOW()
       WHERE lead_id = ? AND status = 'active'`,
      [lead.id]
    );

    const tokens = completion.inputTokens + completion.outputTokens;
    // (#371) Use the router-computed microcent cost directly — converted to
    // $USD for backwards compat with existing column. No more local guess at
    // per-million-token pricing; the router owns this.
    const costUsd = Math.round((completion.costMicrocents / 100_000) * 10000) / 10000;

    const [ins] = await db.execute<ResultSetHeader>(
      `INSERT INTO lead_visual_briefs
         (lead_id, hero_shot, brand_mood, palette_json, motifs_json, donts_json,
          customer_persona, video_pacing, text_overlay_hook, raw_response_json,
          source_audit_id, model, tokens_used, cost_usd, status, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
      [
        lead.id,
        parsed.heroShot,
        parsed.brandMood ?? '',
        JSON.stringify(parsed.palette ?? []),
        JSON.stringify(parsed.motifs ?? []),
        JSON.stringify(parsed.donts ?? []),
        parsed.customerPersona ?? '',
        parsed.videoPacing ?? '',
        parsed.textOverlayHook ?? '',
        JSON.stringify(parsed),
        lead.audit_id ?? null,
        completion.model,
        tokens,
        costUsd,
        actorUserId
      ]
    );

    await logEvent({
      eventType: 'ai.visual_brief_generated',
      leadId: lead.id,
      userId: actorUserId,
      source: 'openai',
      status: 'success',
      payload: { brief_id: ins.insertId, model: completion.model, tokens },
      executionTimeMs: Date.now() - startMs
    });

    return {
      id: ins.insertId,
      leadId: lead.id,
      heroShot: parsed.heroShot,
      brandMood: parsed.brandMood ?? '',
      palette: parsed.palette ?? [],
      motifs: parsed.motifs ?? [],
      donts: parsed.donts ?? [],
      customerPersona: parsed.customerPersona ?? '',
      videoPacing: parsed.videoPacing ?? '',
      textOverlayHook: parsed.textOverlayHook ?? '',
      rawResponse: parsed as unknown as object,
      sourceAuditId: lead.audit_id ?? null,
      model: completion.model,
      tokensUsed: tokens,
      costUsd,
      status: 'active',
      errorMessage: null,
      createdAt: new Date().toISOString(),
      supersededAt: null
    };
  } catch (err) {
    const errMessage = (err as Error).message;
    // Persist a failed row so we can see in admin what went wrong.
    try {
      await db.execute<ResultSetHeader>(
        `INSERT INTO lead_visual_briefs
           (lead_id, model, status, error_message, source_audit_id, created_by_user_id)
         VALUES (?, ?, 'failed', ?, ?, ?)`,
        [lead.id, 'gpt-4o-mini', errMessage.slice(0, 500), lead.audit_id ?? null, actorUserId]
      );
    } catch {
      // swallow
    }

    const errName = (err as Error).name;
    const isApiError =
      errName === 'OpenAIKeyMissingError' ||
      errName === 'OpenAIApiError' ||
      errName === 'OpenRouterTransientError' ||
      errName === 'GeminiTransientError' ||
      errName === 'UnsupportedProviderError';
    await logEvent({
      eventType: isApiError ? 'api.openai_error' : 'workflow.failed',
      leadId: lead.id,
      userId: actorUserId,
      source: 'openai',
      status: 'failure',
      payload: { route: 'visual_brief.generate' },
      errorMessage: errMessage.slice(0, 500),
      executionTimeMs: Date.now() - startMs
    });

    throw err;
  }
}

// ---------------------------------------------------------------------
// Helper for the Grok discoverer: build a concise prompt fragment from
// an active visual brief. Returns null if no active brief exists.
// ---------------------------------------------------------------------
export function visualBriefToPromptFragment(brief: VisualBriefRecord | null): string | null {
  if (!brief) return null;
  const parts: string[] = [];
  if (brief.heroShot) parts.push(brief.heroShot);
  if (brief.brandMood) parts.push(`Mood: ${brief.brandMood}.`);
  if (brief.palette.length) parts.push(`Palette: ${brief.palette.join(', ')}.`);
  if (brief.motifs.length) parts.push(`Recurring motifs: ${brief.motifs.join(', ')}.`);
  if (brief.customerPersona) parts.push(`Target viewer: ${brief.customerPersona}.`);
  if (brief.donts.length) parts.push(`Avoid: ${brief.donts.join('; ')}.`);
  if (brief.videoPacing) parts.push(`Pacing: ${brief.videoPacing}.`);
  return parts.join(' ');
}
