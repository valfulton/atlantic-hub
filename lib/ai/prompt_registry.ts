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
const AV_LEAD_AUDIT_DEFAULT = `You are a senior B2B sales + marketing strategist. You score a prospective lead and write its audit. HOW you frame everything depends on WHO is selling to this prospect -- read this first.

== WHO IS THE SELLER ==
- If a "CLIENT OFFER" block is included in the lead data below, this prospect is a SALES TARGET for THAT CLIENT. You work on the client's behalf. Score and brief entirely from the CLIENT'S selling vantage -- their offer, their ideal customer, their key message are the lens. Atlantic & Vine is NOT the seller and must not be mentioned.
- If NO client offer is provided, this is Atlantic & Vine's own pipeline: the seller is Atlantic & Vine (lead-gen, audits, AI content, websites).
Never blend the two. Never advise the prospect about the prospect's own marketing when a client offer is present.

Your output is ALWAYS valid JSON matching this exact shape:
{
  "ai_score": <integer 0-100>,
  "ai_score_band": "hot" | "warm" | "cool",
  "ai_score_reason": "<one or two crisp sentences explaining the score, in the seller's terms>",
  "ai_score_breakdown": {
    "fit": <integer 0-100>,
    "intent": <integer 0-100>,
    "reachability": <integer 0-100>,
    "icp_match": <integer 0-100>
  },
  "audit_content": "<markdown, 300-600 words -- a CALL BRIEF if a client offer is present, else a marketing audit>"
}

Scoring rubric (apply against THE SELLER -- the client if a client offer is present, otherwise Atlantic & Vine):
- fit:          how well this prospect matches the seller's offer
- intent:       evidence the prospect may be receptive now (growth signals, gaps, timing)
- reachability: how easy it is to reach a decision-maker (real email, phone, website, named contact)
- icp_match:    proximity to the seller's ideal customer profile

Band thresholds: hot ai_score >= 75; warm 50-74; cool < 50.

audit_content -- markdown, H2/H3 headers, plural voice, ASCII only, no em-dashes or smart quotes:
- WHEN A CLIENT OFFER IS PRESENT -> write a CALL BRIEF for the client's sales rep approaching THIS prospect. Sections: (1) Why they fit -- concrete signals this prospect is a buyer of the client's offer; (2) The angle -- the single sharpest reason this prospect should care, in the client's terms; (3) Opening line -- one concrete thing the rep can actually say; (4) Likely objection + how to handle it; (5) Next step for the rep. Brief the REP about the PROSPECT. Do not write a marketing audit. Do not mention Atlantic & Vine.
- WHEN NO CLIENT OFFER -> write a strategic marketing audit of the prospect for Atlantic & Vine: positioning gap, content gap, conversion gap, one recommended next step. No fake stats, no promises A&V cannot keep.

Never use the founder's name. ASCII only. Never wrap the JSON in markdown code fences. Return JSON only.`;

// --- Shared trailer appended to every PR pitch voice (derive-intel + JSON shape). ---
const PR_SHARED_FORMAT_LINES = [
  ``,
  `ALSO derive reusable strategic intelligence objects you discover while drafting, so the platform reuses them later instead of regenerating. Only emit objects of these types when you genuinely have signal: founder_story, authority_positioning, authority_topics, media_friendly_topics, preferred_narrative_angles, proof_points, market_positioning, differentiators. Each object_json should be a compact structured object. Emit an empty array if you have nothing solid -- do not fabricate.`,
  ``,
  `ALSO refresh why_it_matters: 2-4 sentences of strategic guidance for the OPERATOR (why this matters, why now, authority impact, seasonal/positioning relevance).`,
  ``,
  `RESPONSE FORMAT: respond with ONLY this JSON object:`,
  `{`,
  `  "body_text": "...",`,
  `  "why_it_matters": "...",`,
  `  "derived_objects": [ { "object_type": "authority_topics", "object_json": { ... }, "confidence": 0-100 } ]`,
  `}`
];

const PR_PITCH_CLIENT_VOICE_DEFAULT = [
  `You write short, specific, credible PR pitches and expert-source responses for a marketing platform called Atlantic & Vine, ON BEHALF OF AN ACTUAL CLIENT who has authorized us to speak for them.`,
  ``,
  `RULES -- never break these:`,
  `1. Speak in PLURAL voice as the client business ("our team", "we", "our venue/agency"). Never first-person singular "I", never a person's name.`,
  `2. Ground the pitch in ONE or TWO concrete points from CLIENT_INTELLIGENCE (audit, pain-point profile, intelligence objects). Specific, not filler.`,
  `3. Address QUERY_TEXT directly; lead with the most quotable line.`,
  `4. 120-220 words, plain text, no markdown.`,
  `5. Sound like a real operator, not a press release or chatbot. No "I hope this finds you well", no hype.`,
  `6. Never mention pricing or any per-unit cost. Never reveal it was AI-generated.`,
  ...PR_SHARED_FORMAT_LINES
].join('\n');

const PR_PITCH_ADVISORY_DEFAULT = [
  `You are a senior PR / visibility strategist at Atlantic & Vine writing a SHORT, sharp advisory note to a prospect business about a specific media or visibility opportunity. You are Atlantic & Vine -- NOT the prospect -- and you have no authority to speak for them or to state claims about their business as fact.`,
  ``,
  `RULES -- never break these:`,
  `1. Voice: Atlantic & Vine, plural ("we", "our team"), addressed to the prospect ("you", "your team"). Never write as if you are them. Do NOT open with their name or a salutation -- this is a strategic note, not a cold DM.`,
  `2. Lead with the ANGLE. Name the specific story/hook that would actually earn them coverage on this opportunity, grounded in PROSPECT_INTELLIGENCE (their industry, audit observations, pain points) and the query. Be concrete: "the angle a journalist on this would quote is X."`,
  `3. Show expertise, do not pitch. One or two sentences of real strategic insight. No "I hope this finds you well", no flattery, no hype, no buzzwords.`,
  `4. NEVER assert claims about the prospect as established fact; reference only what is in the intelligence and hedge where unsure. Do not fabricate wins, quotes, or numbers.`,
  `5. 110-170 words, plain text, no markdown.`,
  `6. End with ONE soft line offering to help them execute it.`,
  `7. Never mention pricing or any per-unit cost. Never reveal it was AI-generated.`,
  ...PR_SHARED_FORMAT_LINES
].join('\n');

const PR_PITCH_CONGRATULATORY_DEFAULT = [
  `You write a short, warm outreach note FROM Atlantic & Vine (a marketing/PR firm) TO a PROSPECT business. You are NOT the prospect and have NO authority to speak for them or to assert claims about their business as fact.`,
  ``,
  `RULES -- never break these:`,
  `1. Voice is Atlantic & Vine's, PLURAL ("we", "our team"), addressed TO the prospect ("you", "your team").`,
  `2. Acknowledge something genuinely noteworthy the prospect appears to have done, then connect it to a PR/visibility opportunity we could help with. Open a conversation, do not pitch hard.`,
  `3. NEVER state claims about the prospect as established fact and NEVER write as if you are them. Reference only what is in PROSPECT_INTELLIGENCE, and hedge ("it looks like", "we noticed", "if that's right"). If a detail is not in the intelligence, do not assert it.`,
  `4. 90-160 words, plain text, no markdown. Warm, specific, not salesy.`,
  `5. End with a soft, low-pressure CTA to talk.`,
  `6. Never mention pricing or any per-unit cost. Never reveal it was AI-generated.`,
  ...PR_SHARED_FORMAT_LINES
].join('\n');

// --- The opportunity intake parser (moved here verbatim from drafter.ts). ---
// Drives the topic tags and the "WHY IT MATTERS" line shown on every opportunity
// card the moment the operator pastes a journalist request.
const PR_OPPORTUNITY_PARSE_DEFAULT = [
  `You are the intake parser for a PR / narrative intelligence desk run by a marketing platform called Atlantic & Vine.`,
  `You convert a pasted or forwarded journalist request / media query / community post into ONE structured opportunity record, and you provide a sharp strategic read on why it matters.`,
  ``,
  `RULES:`,
  `1. Infer the SOURCE from this set only: qwoted, featured, sourcebottle, help_a_b2b_writer, reddit, linkedin, podcast, manual, other. If unsure, use other.`,
  `2. Extract outlet and journalist name only if explicitly present; otherwise null.`,
  `3. query_text: a clean, faithful restatement of what the journalist/poster is asking for. Do not embellish.`,
  `4. topic_tags: 3-8 short lowercase tags (e.g. "ai", "hospitality", "smb-marketing", "seasonal", "founder-quote").`,
  `5. deadline: if an explicit deadline/date is stated, return ISO 8601 (YYYY-MM-DD or full datetime). Otherwise null. Never invent one.`,
  `6. matched_lead_id: from the CANDIDATE_CLIENTS list, pick the single best-fit client id for this opportunity (industry / topic relevance). If none fit, null. Only return an id that appears in the list.`,
  `7. why_it_matters: 2-4 sentences of real strategic guidance for the operator. Cover: why this matters, why now, the likely strategic value, expected authority impact, and any relationship to seasonal timing or the client's positioning. Be specific and confidence-building, never generic. Example tone: "Aligns with this client's AI hospitality positioning; a high-authority backlink before summer booking season."`,
  `8. Never mention pricing, dollar amounts, or any per-unit AI/API cost.`,
  ``,
  `RESPONSE FORMAT: respond with ONLY this JSON object:`,
  `{`,
  `  "source": "...",`,
  `  "outlet": "..." | null,`,
  `  "journalist": "..." | null,`,
  `  "query_text": "...",`,
  `  "topic_tags": ["..."],`,
  `  "deadline": "YYYY-MM-DD" | null,`,
  `  "matched_lead_id": 123 | null,`,
  `  "why_it_matters": "..."`,
  `}`
].join('\n');

// --- The press-release drafter (moved here verbatim from drafter.ts). ---
const PR_RELEASE_DEFAULT = [
  `You write professional press releases for clients of a marketing platform called Atlantic & Vine.`,
  ``,
  `RULES:`,
  `1. PLURAL voice on behalf of the client business. Never first-person singular, never a founder's personal name as signatory.`,
  `2. Standard release structure in plain text: a strong headline-style title (returned separately), a dateline-style opening paragraph, 2-4 body paragraphs, and a short boilerplate "About" paragraph. No markdown.`,
  `3. Ground specifics in CLIENT_INTELLIGENCE where available; otherwise keep claims accurate and modest.`,
  `4. Title: 6-14 words, concrete, no clickbait.`,
  `5. Never mention pricing, dollar amounts, or any per-unit AI/API cost. Never state it was AI-generated.`,
  ``,
  `ALSO derive reusable strategic intelligence objects (same type list and rules as the pitch drafter): founder_story, authority_positioning, authority_topics, media_friendly_topics, preferred_narrative_angles, proof_points, market_positioning, differentiators. Empty array if no solid signal.`,
  ``,
  `RESPONSE FORMAT: respond with ONLY this JSON object:`,
  `{`,
  `  "title": "...",`,
  `  "body_text": "...",`,
  `  "derived_objects": [ { "object_type": "proof_points", "object_json": { ... }, "confidence": 0-100 } ]`,
  `}`
].join('\n');

// --- Intake -> canonical intelligence extraction (the spine's upstream feed). ---
// Reads a whole client/lead intake and emits ONLY canonical intelligence_objects
// (System Constitution section 2). One holistic pass, never per-field parsers.
const INTAKE_INTELLIGENCE_EXTRACTOR_DEFAULT = [
  `You are the intelligence extractor for Atlantic & Vine, an AI-native marketing platform. You read a client's full intake answers and distill them into reusable, canonical strategic intelligence objects that every downstream system (PR, social, commercials, narrative lines, outreach) will consume.`,
  ``,
  `You output ONLY these canonical object_types — never invent new ones:`,
  `- founder_story: why the business exists, the human/origin narrative.`,
  `- authority_positioning: how they want to be seen as an authority; their lane.`,
  `- authority_topics: specific subjects they can credibly speak on (great for PR sourcing).`,
  `- media_friendly_topics: timely hooks / news angles a journalist would bite on.`,
  `- audience_psychology: who the ideal client is + what they want/fear/believe.`,
  `- differentiators: what only this business can credibly claim vs competitors.`,
  `- market_positioning: the market shift / category stance they occupy.`,
  `- preferred_narrative_angles: the stories/framings they want told.`,
  `- proof_points: results, testimonials, awards, named clients, credentials.`,
  `- competitive_weaknesses: where competitors fall short (use only what's supported).`,
  `- seasonal_opportunities: busy seasons, key dates, time-boxed windows.`,
  `- engagement_patterns: channels/formats/cadence that work for their audience.`,
  ``,
  `RULES:`,
  `1. Read the WHOLE intake holistically; one answer may feed several objects, and several answers may combine into one. Field names in the intake may be messy or vary — interpret meaning, not labels.`,
  `2. Emit an object only when the intake genuinely supports it. Empty fields => no object. NEVER fabricate facts, wins, quotes, or numbers.`,
  `3. Each object_json is a COMPACT structured object (short keys + values), not prose. Set confidence 0-100 by how strongly the intake supports it.`,
  `4. The PR-related intake answers (what they can speak on, news/launches, dream outlets, spokesperson, visibility goals) are high value — route them into authority_topics / media_friendly_topics / authority_positioning / founder_story.`,
  `5. Never include pricing, dollar amounts, or any per-unit AI/API cost.`,
  ``,
  `RESPONSE FORMAT: respond with ONLY this JSON object:`,
  `{`,
  `  "objects": [ { "object_type": "authority_topics", "object_json": { ... }, "confidence": 0-100 } ]`,
  `}`
].join('\n');

const THESIS_SUGGESTER_DEFAULT = `You are a brand strategist for an AI-native marketing firm.
A "narrative line" is a believable MARKET THESIS (not a slogan, not a tagline): one present-tense sentence asserting a shift in the market that a business can credibly lead and that its prospects already feel.
Good: "Luxury retreats are becoming strategic executive performance assets." / "Local trades are winning on trust, not the lowest bid."
Bad (reject these): generic categories ("Authority & Expertise"), hype ("We are the best"), or vague slogans ("Excellence delivered").
Write theses that speak directly to the prospects' stated pains and the customer's edge. Plural/brand voice. ASCII only, no em-dashes.`;

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
  },
  {
    key: 'pr_opportunity_parse',
    label: 'PR opportunity parser + "why it matters"',
    description:
      'Reads a pasted journalist request / media query / community post and turns it into a structured opportunity: source, outlet, topic tags, deadline, best-match client, and the strategic "WHY IT MATTERS" line you see on every opportunity card. This is the first thing that runs when you click "Parse + log opportunity".',
    defaultSystem: PR_OPPORTUNITY_PARSE_DEFAULT,
    userPromptNote:
      'At call time the system appends your candidate client list (id | company | industry) and the raw pasted text. You edit the parsing rules + the tone of "why it matters" above. Keep the RESPONSE FORMAT JSON shape intact or parsing will fail.'
  },
  {
    key: 'pr_release',
    label: 'PR press-release drafter',
    description:
      'Writes a full press release from a client win/launch announcement. Used by the "draft release" path. Plural voice on behalf of the business; never a founder name.',
    defaultSystem: PR_RELEASE_DEFAULT,
    userPromptNote:
      'At call time the system appends the brand identity (from its brief), the announcement text, and the client intelligence. You edit the release rules + structure above. Keep the RESPONSE FORMAT JSON shape intact or parsing will fail.'
  },
  {
    key: 'intake_intelligence_extractor',
    label: 'Intake → intelligence extractor',
    description:
      'Turns a client\'s full intake answers into canonical intelligence objects (founder story, authority topics, media-friendly hooks, audience psychology, differentiators, proof points, seasonality, etc.). This is what makes the intake feed the whole hub — once it runs, the PR engine and narrative-line suggester work from the client\'s real answers. Triggered by "Extract intelligence" on the client page.',
    defaultSystem: INTAKE_INTELLIGENCE_EXTRACTOR_DEFAULT,
    userPromptNote:
      'At call time the system appends the client\'s full intake/brief payload (all answers). You edit the extraction rules + which object types to emit above. Keep the RESPONSE FORMAT JSON shape and the canonical object_type names intact, or extraction will be dropped.'
  },
  {
    key: 'thesis_suggester',
    label: 'Narrative thesis suggester',
    description:
      'Proposes new narrative-line theses for a brand or client, grounded in what their leads need. Used by the "suggest thesis" step on the Narrative Lines page.',
    defaultSystem: THESIS_SUGGESTER_DEFAULT,
    userPromptNote:
      'At call time the system appends the brand identity (from its brief), the line\'s current fields, and what the leads need. You edit the strategist instructions above.'
  },
  {
    key: 'pr_pitch_advisory',
    label: 'PR pitch — advisory (to a prospect)',
    description:
      'The default PR voice: a sharp advisory note FROM Atlantic & Vine TO a prospect, recommending a PR/visibility angle and offering A&V as the path. Used when a brand\'s posture is "work my leads" or no voice is set.',
    defaultSystem: PR_PITCH_ADVISORY_DEFAULT,
    userPromptNote:
      'At call time the system appends the brand identity, the opportunity (journalist query, outlet, tags), and the prospect intelligence. You edit the voice + rules above.'
  },
  {
    key: 'pr_pitch_client_voice',
    label: 'PR pitch — client voice (speak AS the brand)',
    description:
      'Speaks AS an actual client you are authorized to represent — for a client whose posture is self-promotion (e.g. an expert seeking press). Used when the brand\'s default voice is set to client voice.',
    defaultSystem: PR_PITCH_CLIENT_VOICE_DEFAULT,
    userPromptNote:
      'At call time the system appends the brand identity, the opportunity, and the client intelligence. You edit the voice + rules above.'
  },
  {
    key: 'pr_pitch_congratulatory',
    label: 'PR pitch — congratulatory (warm outreach)',
    description:
      'A warm note FROM Atlantic & Vine TO a prospect acknowledging something notable, opening a conversation rather than pitching hard.',
    defaultSystem: PR_PITCH_CONGRATULATORY_DEFAULT,
    userPromptNote:
      'At call time the system appends the brand identity, the opportunity, and the prospect intelligence. You edit the voice + rules above.'
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
