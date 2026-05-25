/**
 * lib/ai/prompt_registry.ts
 *
 * The ONE place the platform's AI prompts are defined + editable.
 *
 * Each known prompt has a stable key and a built-in DEFAULT (owned by code, so a
 * fresh deploy always has a sane prompt). The operator can save an OVERRIDE
 * (schema/046_ai_prompt_overrides.sql) to tune the prompt without a deploy, and
 * reset to the default anytime. Call sites read getSystemPrompt(key) instead of a
 * hardcoded constant.
 *
 * This is the foundation for "prompt visibility site-wide" (#80). First consumer:
 * the lead audit (lib/ai/score_and_audit.ts). Thesis / PR / discovery slot in next
 * by adding their defaults here and switching their call sites to getSystemPrompt().
 */
import { getAvDb } from '@/lib/db/av';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

export interface PromptDef {
  key: string;
  label: string;
  /** What this prompt drives + where it's used — shown to the operator. */
  description: string;
  /** The built-in system prompt; used when there's no override. */
  defaultSystem: string;
  /** Read-only note describing the dynamic data the user-prompt adds at call time. */
  userPromptNote: string;
}

// --- The lead audit system prompt (moved here verbatim from score_and_audit). ---
const AV_LEAD_AUDIT_DEFAULT = `You are a senior B2B marketing strategist working for Atlantic & Vine, an AI-native marketing intelligence platform. You score and audit prospective leads for the operator.

Your output is ALWAYS valid JSON matching this exact shape:
{
  "ai_score": <integer 0-100>,
  "ai_score_band": "hot" | "warm" | "cool",
  "ai_score_reason": "<one or two crisp sentences explaining the score>",
  "ai_score_breakdown": {
    "fit": <integer 0-100>,
    "intent": <integer 0-100>,
    "reachability": <integer 0-100>,
    "icp_match": <integer 0-100>
  },
  "audit_content": "<markdown strategic marketing audit, 300-600 words>"
}

Scoring rubric:
- fit:          how well their business matches an Atlantic & Vine offering (lead-gen, audits, AI content, websites)
- intent:       evidence they may be actively looking for help (recent activity, growth signals, gaps)
- reachability: how easy it will be to actually contact a decision-maker (real email, phone, website, named contact)
- icp_match:    proximity to ideal customer profile (service business, SMB, owner-operated, not yet using AI)

Band thresholds:
- hot:  ai_score >= 75 -- pursue this week
- warm: 50 <= ai_score < 75 -- nurture, drip outreach
- cool: ai_score < 50 -- low priority, queue for batch outreach only

The audit_content is the deliverable the operator may share with this prospect. Write it as a real strategic marketing audit -- 4-6 short sections in markdown with H2/H3 headers, addressing their likely positioning gap, content gap, conversion gap, and one specific recommended next step. No filler. No fake stats. No promises Atlantic & Vine cannot keep. Plural voice ("our team", "we recommend"). Never use the founder's name. Never use em-dashes or smart quotes -- ASCII only.

Never wrap the JSON in markdown code fences. Return JSON only.`;

/** Every prompt the operator can view/edit. Add an entry to expose a new prompt. */
export const PROMPT_DEFS: PromptDef[] = [
  {
    key: 'av_lead_audit',
    label: 'Lead audit + scoring',
    description:
      'Scores every new lead (fit / intent / reachability / ICP) and writes its strategic marketing audit. Runs on every new lead and on Re-score. The audit it produces is what the PR pitch drafter and other surfaces later ground on, so this prompt is foundational.',
    defaultSystem: AV_LEAD_AUDIT_DEFAULT,
    userPromptNote:
      'At call time the system appends the lead facts (company, industry, website, contact, self-reported challenge) and — when the lead belongs to a client — that client\'s creative brief. You edit the strategy/rubric above; the per-lead data is added automatically.'
  }
];

const DEF_BY_KEY = new Map(PROMPT_DEFS.map((d) => [d.key, d]));

export function getPromptDef(key: string): PromptDef | null {
  return DEF_BY_KEY.get(key) ?? null;
}

export function listPromptDefs(): PromptDef[] {
  return PROMPT_DEFS;
}

interface OverrideRow extends RowDataPacket {
  system_text: string | null;
  updated_by: string | null;
  updated_at: string | null;
}

async function readOverride(key: string): Promise<{ text: string | null; updatedBy: string | null; updatedAt: string | null }> {
  try {
    const db = getAvDb();
    const [rows] = await db.execute<OverrideRow[]>(
      `SELECT system_text, updated_by, updated_at FROM ai_prompt_overrides WHERE prompt_key = ? LIMIT 1`,
      [key]
    );
    const r = rows[0];
    const text = r?.system_text && r.system_text.trim() ? r.system_text : null;
    return { text, updatedBy: r?.updated_by ?? null, updatedAt: r?.updated_at ?? null };
  } catch (err) {
    console.error('[prompt_registry:read]', key, (err as Error).message);
    return { text: null, updatedBy: null, updatedAt: null };
  }
}

/**
 * The effective system prompt for a key: the operator override if set, else the
 * code default. Never throws — a missing/failed override degrades to the default.
 */
export async function getSystemPrompt(key: string): Promise<string> {
  const def = DEF_BY_KEY.get(key);
  const fallback = def?.defaultSystem ?? '';
  const { text } = await readOverride(key);
  return text ?? fallback;
}

export interface EffectivePrompt {
  key: string;
  label: string;
  description: string;
  userPromptNote: string;
  defaultSystem: string;
  /** The current override text, or null when running on the default. */
  override: string | null;
  isOverridden: boolean;
  updatedBy: string | null;
  updatedAt: string | null;
}

/** Full view of one prompt for the operator editor. Returns null for unknown keys. */
export async function getEffectivePrompt(key: string): Promise<EffectivePrompt | null> {
  const def = DEF_BY_KEY.get(key);
  if (!def) return null;
  const { text, updatedBy, updatedAt } = await readOverride(key);
  return {
    key: def.key,
    label: def.label,
    description: def.description,
    userPromptNote: def.userPromptNote,
    defaultSystem: def.defaultSystem,
    override: text,
    isOverridden: text != null,
    updatedBy,
    updatedAt
  };
}

/**
 * Save an operator override. Passing empty/whitespace (or text identical to the
 * default) clears the override so the prompt reverts to the code default.
 */
export async function savePromptOverride(key: string, systemText: string, updatedBy?: string | null): Promise<boolean> {
  const def = DEF_BY_KEY.get(key);
  if (!def) return false;
  const trimmed = (systemText ?? '').trim();
  const isDefault = trimmed === '' || trimmed === def.defaultSystem.trim();
  try {
    const db = getAvDb();
    if (isDefault) {
      await db.execute<ResultSetHeader>(`DELETE FROM ai_prompt_overrides WHERE prompt_key = ?`, [key]);
      return true;
    }
    await db.execute<ResultSetHeader>(
      `INSERT INTO ai_prompt_overrides (prompt_key, system_text, updated_by)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE system_text = VALUES(system_text), updated_by = VALUES(updated_by), updated_at = NOW()`,
      [key, trimmed, updatedBy ?? null]
    );
    return true;
  } catch (err) {
    console.error('[prompt_registry:save]', key, (err as Error).message);
    return false;
  }
}

/** Reset a prompt to its code default (drops any override). */
export async function resetPromptOverride(key: string): Promise<boolean> {
  if (!DEF_BY_KEY.has(key)) return false;
  try {
    const db = getAvDb();
    await db.execute<ResultSetHeader>(`DELETE FROM ai_prompt_overrides WHERE prompt_key = ?`, [key]);
    return true;
  } catch (err) {
    console.error('[prompt_registry:reset]', key, (err as Error).message);
    return false;
  }
}
