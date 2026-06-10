/**
 * lib/av/smart_fill.ts  (#582, val 2026-06-10)
 *
 * "Paste anything, get a brief." The on-ramp val needs for clients she
 * doesn't already have deep history with. Takes a free-form paragraph —
 * campaign launch announcement, founder bio, hotel positioning doc, book
 * pitch, anything — and returns a brief_payload partial covering the 10
 * anchor questions that drive the cockpit and the press kit generator.
 *
 * The 4 surfaces that should share this lib:
 *   1. /admin/av/clients/new                    (operator create-client)
 *   2. /admin/av/clients/[id]/intake            (operator intake editor)
 *   3. /client/intake                           (client-facing intake)
 *   4. atlanticandvine.netlify.app audit        (marketing-site audit)
 *
 * All four POST to one shared API route; that route calls this lib; this lib
 * calls runLlm with task kind 'intake_web_fill' (cheap model, 7-day cache).
 *
 * Per val's QC rule (memory: feedback_prompt_visibility), the prompt is
 * defined in this file (visible) — not hidden inside the LLM provider — so val
 * can see exactly what's being sent before her credits get spent.
 */
import { runLlm } from '@/lib/llm/router';
import {
  isEngagementKind,
  type EngagementKind
} from '@/lib/client/engagement_kind';

/** The 10 anchor fields smart-fill produces. ALL optional — model returns only
 *  what the paragraph supports. Field names match brief_payload keys so the
 *  result can be merged into creative_briefs.brief_payload as-is. */
export interface SmartFillResult {
  /** Inferred engagement kind. UI uses this to pre-select a kind on save. */
  engagement_kind?: EngagementKind;
  /** Brand / company name. */
  company?: string;
  /** Primary contact's display name. */
  contact_name?: string;
  /** Owner / principal name (often same as contact_name, sometimes different). */
  owner_name?: string;
  /** One-line key message — the through-line everything else reinforces. */
  key_message?: string;
  /** Supporting proof points — credentials, milestones, data. */
  message_support?: string;
  /** Who must hear this and in what register. */
  audience_insights?: string;
  /** Why THIS brand vs the competition — the only-you fact. */
  differentiators?: string;
  /** Press window / event date / urgency cue. */
  timeline?: string;
  /** District / territory / market. Defense+political+local hospitality care here. */
  district?: string;
  /** Industry one-liner. */
  industry?: string;
  /** Do-not-say list (red lines). Legal / political / brand-sensitive. */
  red_lines?: string;
  /** Website URL if explicitly mentioned in the paragraph. */
  website_url?: string;
  /** Echo of the model's confidence + per-field provenance for the UI diff view. */
  _confidence?: 'high' | 'medium' | 'low';
  _notes?: string;
}

/** Build the prompt. Lives in this file (not the provider) so val can edit it
 *  in one place when the prompt registry surface arrives. */
function buildPrompt(paragraph: string, hintKind?: EngagementKind | null): string {
  const kindHint = hintKind
    ? `The operator already knows this is a "${hintKind}" engagement — keep that and don't second-guess.`
    : `Infer engagement_kind from the paragraph. The options are: lead_gen (default authority/marketing client), defense_pr (legal defense + media), political_campaign (running for office), luxury_hospitality (hotel/yacht/luxury travel), book_pr (book launch).`;

  return [
    `You are filling a creative brief for an agency from a single paragraph of source material.`,
    `Return ONLY the JSON object — no markdown, no preamble.`,
    `Every field is OPTIONAL. Only include a field if the paragraph explicitly supports it.`,
    `Do NOT invent facts. If the paragraph doesn't name a key message, omit key_message.`,
    `Do NOT write meta strings like "[insert X]" or "TBD" — just leave the field out.`,
    ``,
    kindHint,
    ``,
    `Fields:`,
    `- engagement_kind: one of lead_gen | defense_pr | political_campaign | luxury_hospitality | book_pr`,
    `- company: brand or company name`,
    `- contact_name: primary contact display name`,
    `- owner_name: principal/owner name (often same as contact_name)`,
    `- key_message: one-line through-line (≤ 25 words)`,
    `- message_support: supporting proof points (1–3 sentences)`,
    `- audience_insights: who must hear this and how (1–3 sentences)`,
    `- differentiators: only-you fact (1–2 sentences)`,
    `- timeline: press window / event date / urgency`,
    `- district: district / territory / market`,
    `- industry: one-liner industry`,
    `- red_lines: do-not-say (legal / brand-sensitive)`,
    `- website_url: explicit URL only`,
    `- _confidence: high | medium | low — your overall confidence`,
    `- _notes: short note if the paragraph is ambiguous or the model is uncertain`,
    ``,
    `SOURCE PARAGRAPH:`,
    paragraph.trim(),
    ``,
    `Return the JSON object now.`
  ].join('\n');
}

/**
 * Run smart-fill on a paragraph. Returns the parsed partial brief_payload
 * (every field optional). Errors are caught and returned as an empty object
 * with _notes describing what went wrong, so the UI can surface the error
 * without throwing.
 */
export interface SmartFillInput {
  paragraph: string;
  /** Optional engagement kind hint (when the operator picked it on the form). */
  hintKind?: EngagementKind | null;
  /** For per-client cost reporting. */
  clientId?: number | null;
  /** Tenant. Default 'av'. */
  tenantId?: string;
}

export interface SmartFillOutput {
  fields: SmartFillResult;
  /** The prompt sent to the LLM. Surfaced in the UI per val's QC rule so she
   *  can review before/after — no hidden prompts. */
  prompt: string;
  /** Live model response text (for the prompt-walker debug view). */
  rawResponse: string;
  /** Cost stamp the UI shows ("Smart-fill cost: $0.002"). */
  costMicrocents: number;
}

export async function smartFillFromParagraph(input: SmartFillInput): Promise<SmartFillOutput> {
  const paragraph = (input.paragraph ?? '').trim();
  if (!paragraph || paragraph.length < 30) {
    return {
      fields: { _notes: 'Paragraph too short — paste at least a few sentences.' },
      prompt: '',
      rawResponse: '',
      costMicrocents: 0
    };
  }
  if (paragraph.length > 8000) {
    return {
      fields: { _notes: 'Paragraph too long — trim to ~2000 words or paste in sections.' },
      prompt: '',
      rawResponse: '',
      costMicrocents: 0
    };
  }
  const prompt = buildPrompt(paragraph, input.hintKind);
  try {
    const res = await runLlm({
      taskKind: 'intake_web_fill',
      clientId: input.clientId ?? null,
      tenantId: input.tenantId ?? 'av',
      prompt,
      temperature: 0.2,
      maxTokens: 700,
      json: true,
      note: `smart_fill · paragraph (${paragraph.length} chars)`
    });
    const fields = parseSmartFillResponse(res.text);
    return {
      fields,
      prompt,
      rawResponse: res.text,
      costMicrocents: res.costMicrocents
    };
  } catch (err) {
    return {
      fields: { _notes: `Smart-fill failed: ${(err as Error).message}` },
      prompt,
      rawResponse: '',
      costMicrocents: 0
    };
  }
}

/** Parse the model's JSON output. Tolerates code-fenced JSON, trailing prose,
 *  and stringly-typed booleans. Returns {} on any parse failure (UI shows
 *  empty result + lets val paste again). */
function parseSmartFillResponse(text: string): SmartFillResult {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return {};
  // Try direct parse first.
  let obj: unknown;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    // Fall back to extracting the first {...} block.
    const m = trimmed.match(/\{[\s\S]*\}/);
    if (!m) return { _notes: 'Model did not return JSON.' };
    try {
      obj = JSON.parse(m[0]);
    } catch {
      return { _notes: 'Model returned malformed JSON.' };
    }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
  const raw = obj as Record<string, unknown>;
  const out: SmartFillResult = {};
  const str = (k: string): string | undefined => {
    const v = raw[k];
    return typeof v === 'string' && v.trim() ? v.trim() : undefined;
  };
  // engagement_kind needs validation against our enum.
  const ek = raw['engagement_kind'];
  if (isEngagementKind(ek)) out.engagement_kind = ek;
  const STRING_KEYS: (keyof SmartFillResult)[] = [
    'company', 'contact_name', 'owner_name', 'key_message', 'message_support',
    'audience_insights', 'differentiators', 'timeline', 'district', 'industry',
    'red_lines', 'website_url'
  ];
  for (const k of STRING_KEYS) {
    const v = str(k);
    if (v) (out as Record<string, unknown>)[k] = v;
  }
  const conf = raw['_confidence'];
  if (conf === 'high' || conf === 'medium' || conf === 'low') out._confidence = conf;
  const notes = str('_notes');
  if (notes) out._notes = notes;
  return out;
}
