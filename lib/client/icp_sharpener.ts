/**
 * lib/client/icp_sharpener.ts  (#239)
 *
 * The "right" half of #95: an LLM-powered ICP sharpener that reads a client's
 * full brief/intake (ideal_client, audience_insights, market_position, geo_focus,
 * notable_clients, additional_info excludes, etc.) and produces a STRUCTURED
 * ICP — industries[], geographies[], excludedIndustries[], companySizeMin/Max
 * — that Apollo/Places discovery can use directly.
 *
 * Eliminates the duplicate source of truth: val populates the intake once;
 * this writes the curated ICP table from that intake. No more "intake is rich
 * but client_icps row is empty so discovery defaults to Saint Croix."
 *
 * Two modes, like the intake-web-filler (#235):
 *   - 'preview' -> return suggestions, never write
 *   - 'apply'   -> persist to client_icps via saveClientIcp with provenance
 *                  'ai_intake' so the IcpEditor chips render distinctly from
 *                  val's hand-curated values.
 *
 * Prompt is editable via prompt_registry key 'client_icp_sharpener'.
 */
import { parseOpenAIJson } from '@/lib/openai/client';
import { runLlm } from '@/lib/llm/router';
import { getSystemPrompt } from '@/lib/ai/prompt_registry';
import { getBriefSeed, getBriefPayload } from '@/lib/client/brief_store';
import { logEvent } from '@/lib/events/log';

const TEMPERATURE = 0.2;
const MAX_TOKENS = 800;
// (#361) Model decided by lib/llm/types.ts TASK_MODEL['icp_sharpen'].

export interface SharpenedIcp {
  industries: string[];
  geographies: string[];
  excludedIndustries: string[];
  // (#308) Also extract geo excludes (model is now told to propose them when
  // the intake names a tight city/region) + contact-title preferences.
  excludeGeographies: string[];
  preferredContactTitles: string[];
  excludedContactTitles: string[];
  companySizeMin: number | null;
  companySizeMax: number | null;
  reasoning: string;
  tokensUsed: number;
  model: string;
}

// (#308) Universal defaults — every B2B client benefits from these the moment
// they're created, before any LLM call runs. Used as a backstop merged into
// the sharpener output so even an empty-brief client starts with sensible
// gate-keeper exclusions and decision-maker preferences. The sharpener can
// ADD to these per industry; we never let it shrink them below this floor.
export const DEFAULT_PREFERRED_CONTACT_TITLES = [
  'Owner', 'Founder', 'CEO', 'President', 'Managing Director', 'Director', 'COO', 'VP', 'GM'
];
export const DEFAULT_EXCLUDED_CONTACT_TITLES = [
  'HR', 'Recruiter', 'Recruiting', 'Recruitment Coordinator',
  'Assistant', 'Intern', 'Receptionist', 'Coordinator', 'Administrative',
  // (#313) Added 2026-06-01 after Hunter kept burning credits on non-buyers.
  // 'Sales' is intentionally broad — val's ICP is owner/founder/CEO, not the
  // sales org. If a future client genuinely wants Sales-org POCs, override
  // by editing that client's ICP directly. Customer Experience / Service /
  // Success surfaced as the Cal-a-Vie burn — "Director of Customer
  // Experience" matched the preferred 'Director' with nothing to counter-flag.
  'Sales',
  'Customer Experience', 'Customer Service', 'Customer Success'
];

export class IcpSharpenerError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = 'IcpSharpenerError';
  }
}

/**
 * Read everything in the brief that informs ICP and lay it out for the model.
 * Conservative: we DON'T include the entire intake payload as raw JSON —
 * structured fields keep the model anchored on the right answer.
 */
function buildUserPrompt(args: {
  brandName: string;
  seedAudience: string | null;
  seedGeoFocus: string | null;
  ideal_client: string | null;
  target_audience: string | null;
  audience_insights: string | null;
  client_problems: string | null;
  market_position: string | null;
  notable_clients: string | null;
  additional_info: string | null;
  company_size: string | null;
}): string {
  const parts: string[] = [];
  parts.push(`BRAND: ${args.brandName}`);
  parts.push('');
  const addBlock = (label: string, v: string | null) => {
    if (v && v.trim()) {
      parts.push(`${label}:`);
      parts.push(v.trim());
      parts.push('');
    }
  };
  addBlock('IDEAL_CLIENT', args.ideal_client || args.seedAudience);
  addBlock('TARGET_AUDIENCE', args.target_audience);
  addBlock('AUDIENCE_INSIGHTS', args.audience_insights);
  addBlock('WHEN_THEY_COME_TO_US', args.client_problems);
  addBlock('MARKET_POSITION', args.market_position);
  addBlock('NOTABLE_CLIENTS', args.notable_clients);
  addBlock('GEO_FOCUS', args.seedGeoFocus);
  addBlock('COMPANY_SIZE_HINT', args.company_size);
  addBlock('ADDITIONAL_INFO (may contain explicit excludes / sensitivities)', args.additional_info);
  parts.push('Produce the JSON object now.');
  return parts.join('\n');
}

/**
 * Read the brief, run the LLM, return structured ICP. Never throws on
 * model/API failure — returns null so callers can degrade gracefully.
 */
export async function sharpenIcpFromBrief(args: {
  clientId: number;
  brandName: string;
}): Promise<SharpenedIcp | null> {
  const seed = await getBriefSeed('av', args.clientId);
  const payload = (await getBriefPayload('av', args.clientId)) as Record<string, unknown> | null;

  // If neither source has signal we have nothing to sharpen.
  if (!seed && (!payload || Object.keys(payload).length === 0)) return null;

  const pickStr = (key: string): string | null => {
    const v = payload?.[key];
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  };

  const systemPrompt = await getSystemPrompt('client_icp_sharpener');
  const userPrompt = buildUserPrompt({
    brandName: args.brandName,
    seedAudience: seed?.audience ?? null,
    seedGeoFocus: seed?.geoFocus ?? null,
    ideal_client: pickStr('ideal_client'),
    target_audience: pickStr('target_audience'),
    audience_insights: pickStr('audience_insights'),
    client_problems: pickStr('client_problems'),
    market_position: pickStr('market_position'),
    notable_clients: pickStr('notable_clients'),
    additional_info: pickStr('additional_info'),
    company_size: pickStr('company_size')
  });

  let completion;
  try {
    // (#361) Event-cached: cache key includes a hash of the brief payload
    // we read, so a brief edit naturally produces a different key = fresh call.
    const briefStamp = JSON.stringify(payload ?? {}).slice(0, 500);
    completion = await runLlm({
      taskKind: 'icp_sharpen',
      clientId: args.clientId,
      note: `icp_sharpen · client ${args.clientId}`,
      prompt: `SYSTEM:\n${systemPrompt}\n\nUSER:\n${userPrompt}`,
      cacheKeyExtras: [String(args.clientId), briefStamp, systemPrompt.slice(0, 200)],
      temperature: TEMPERATURE,
      maxTokens: MAX_TOKENS,
      json: true
    });
  } catch (err) {
    await logEvent({
      eventType: 'icp.sharpen.llm_failed',
      source: 'llm_router',
      status: 'failure',
      errorMessage: (err as Error).message,
      payload: { client_id: args.clientId }
    });
    return null;
  }

  const parsed = parseOpenAIJson<{
    industries?: string[];
    geographies?: string[];
    excluded_industries?: string[];
    // (#308) New fields the upgraded prompt produces.
    excluded_geographies?: string[];
    preferred_contact_titles?: string[];
    excluded_contact_titles?: string[];
    company_size_min?: number | null;
    company_size_max?: number | null;
    reasoning?: string;
  }>(completion.text);

  if (!parsed) {
    await logEvent({
      eventType: 'icp.sharpen.parse_failed',
      source: 'openai',
      status: 'failure',
      payload: { client_id: args.clientId, raw_excerpt: completion.text.slice(0, 400) }
    });
    return null;
  }

  const sanitizeStringArray = (arr: unknown): string[] => {
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((x): x is string => typeof x === 'string')
      .map((x) => x.trim())
      .filter((x) => x.length >= 2 && x.length <= 120)
      .slice(0, 12);
  };

  const clampSize = (n: unknown): number | null => {
    if (typeof n !== 'number' || !Number.isFinite(n)) return null;
    const r = Math.round(n);
    if (r < 1) return null;
    if (r > 1_000_000) return 1_000_000;
    return r;
  };

  // (#308) Title-list merge: union LLM-proposed titles with the universal
  // defaults so we always have a floor — but never duplicate-add and prefer
  // the model's casing when it overlaps.
  const mergeTitles = (modelArr: unknown, defaults: string[]): string[] => {
    const modelList = sanitizeStringArray(modelArr);
    const seenLower = new Set(modelList.map((s) => s.toLowerCase()));
    const merged = [...modelList];
    for (const d of defaults) {
      if (!seenLower.has(d.toLowerCase())) { merged.push(d); seenLower.add(d.toLowerCase()); }
    }
    return merged.slice(0, 20);
  };

  const result: SharpenedIcp = {
    industries: sanitizeStringArray(parsed.industries),
    geographies: sanitizeStringArray(parsed.geographies),
    excludedIndustries: sanitizeStringArray(parsed.excluded_industries),
    excludeGeographies: sanitizeStringArray(parsed.excluded_geographies),
    preferredContactTitles: mergeTitles(parsed.preferred_contact_titles, DEFAULT_PREFERRED_CONTACT_TITLES),
    excludedContactTitles: mergeTitles(parsed.excluded_contact_titles, DEFAULT_EXCLUDED_CONTACT_TITLES),
    companySizeMin: clampSize(parsed.company_size_min),
    companySizeMax: clampSize(parsed.company_size_max),
    reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning.slice(0, 1000) : '',
    tokensUsed: completion.inputTokens + completion.outputTokens,
    model: completion.model
  };

  await logEvent({
    eventType: 'icp.sharpen.suggested',
    source: 'openai',
    payload: {
      client_id: args.clientId,
      industries_count: result.industries.length,
      geographies_count: result.geographies.length,
      excluded_count: result.excludedIndustries.length,
      tokens: result.tokensUsed
    }
  });

  return result;
}
