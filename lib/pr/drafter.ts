/**
 * lib/pr/drafter.ts
 *
 * The PR / Narrative Intelligence drafter. Mirrors the pattern in
 * lib/ai/outreach_drafter.ts (constrained-JSON OpenAI call, fire-safe event
 * logging) but serves a different purpose: it is the engine that turns a
 * journalist question into an instant, on-brand pitch AND contributes reusable
 * strategic intelligence back into the shared graph.
 *
 * Three jobs:
 *   1. parseOpportunity()  - paste/forward journalist query text -> a structured
 *      pr_opportunity (source, outlet, journalist, topic_tags, deadline,
 *      best-match lead, and the strategic why_it_matters guidance).
 *   2. draftPitch()        - opportunity + client intelligence -> a pitch in the
 *      client's voice + refreshed why_it_matters + derived intelligence objects.
 *   3. draftRelease()      - a client win/launch -> a press release + derived
 *      intelligence objects.
 *
 * Intelligence sourcing (CRITICAL): reads existing columns first
 * (leads.audit_content, leads.pain_point_profile, industry) PLUS any matching
 * rows in intelligence_objects. Does NOT invent new lead-table fields. New /
 * strengthened intelligence objects are UPSERTed into intelligence_objects so
 * the next system reuses them instead of regenerating. This is the difference
 * between a one-time drafter and compounding narrative-intelligence infra.
 *
 * Every state change emits a pr.* event via lib/events/log.ts. logEvent is
 * fire-safe and never throws.
 *
 * Brand voice: PLURAL ("our team", "our platform") -- never a founder name.
 * Never mention pricing, dollar amounts, or any per-unit API cost.
 */

import { getAvDb } from '@/lib/db/av';
import {
  openaiChatCompletion,
  parseOpenAIJson,
  OpenAIKeyMissingError,
  OpenAIApiError
} from '@/lib/openai/client';
import { logEvent } from '@/lib/events/log';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import {
  DEFAULT_TENANT,
  PR_EVENTS,
  isPrSource,
  isDerivableObjectType,
  type CandidateLead,
  type DerivedIntelligenceObject,
  type DraftedPitchResult,
  type DraftedReleaseResult,
  type ParsedOpportunity,
  type PitchMode,
  type PrOpportunity,
  type PrSource
} from '@/lib/pr/types';

const MODEL = 'gpt-4o-mini';
const TEMPERATURE = 0.7;
const PARSE_MAX_TOKENS = 600;
const DRAFT_MAX_TOKENS = 900;
const AUDIT_EXCERPT_MAX_CHARS = 1500;
const MAX_CANDIDATE_LEADS = 25;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class PrLeadNotFoundError extends Error {
  constructor(public leadId: number) {
    super(`Lead not found for id=${leadId}`);
    this.name = 'PrLeadNotFoundError';
  }
}

export class PrDraftParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PrDraftParseError';
  }
}

// ---------------------------------------------------------------------------
// DB row shapes (read-only)
// ---------------------------------------------------------------------------

interface LeadIntelRow extends RowDataPacket {
  id: number;
  company: string;
  industry: string | null;
  website: string | null;
  audit_content: string | null;
  challenge: string | null;
  pain_point_profile: string | null; // JSON column comes back as string (mysql2 may parse to object)
  client_id: number | null;
  lead_status: string | null;
}

interface IntelObjRow extends RowDataPacket {
  object_type: string;
  object_json: string | null;
  lead_id: number | null;
  confidence: number | null;
}

interface CandidateRow extends RowDataPacket {
  id: number;
  company: string;
  industry: string | null;
}

interface ClientIntelligence {
  lead: LeadIntelRow | null;
  /** Compact, prompt-ready summary of accumulated intelligence_objects. */
  objectSummaries: string[];
  /** True if any real intelligence (audit/pain/objects) was found to ground on. */
  grounded: boolean;
}

// ===========================================================================
// 1. PARSE a pasted journalist query into a structured opportunity
// ===========================================================================

export async function parseOpportunity(args: {
  rawText: string;
  sourceHint?: PrSource | null;
  tenantId?: string;
}): Promise<ParsedOpportunity> {
  const tenantId = args.tenantId ?? DEFAULT_TENANT;
  const candidates = await loadCandidateLeads();
  const started = Date.now();

  const systemPrompt = buildParseSystemPrompt();
  const userPrompt = buildParseUserPrompt({
    rawText: args.rawText,
    sourceHint: args.sourceHint ?? null,
    candidates
  });

  let completion;
  try {
    completion = await openaiChatCompletion(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      { model: MODEL, temperature: 0.3, maxTokens: PARSE_MAX_TOKENS, json: true }
    );
  } catch (err) {
    if (err instanceof OpenAIKeyMissingError || err instanceof OpenAIApiError) {
      await logEvent({
        eventType: 'pr.opportunity.parse_failed',
        source: 'openai',
        status: 'failure',
        errorMessage: err.message
      });
    }
    throw err;
  }

  const parsed = parseOpenAIJson<{
    source?: string;
    outlet?: string | null;
    journalist?: string | null;
    query_text?: string;
    topic_tags?: string[];
    deadline?: string | null;
    matched_lead_id?: number | null;
    why_it_matters?: string;
  }>(completion.text);

  if (!parsed || typeof parsed.why_it_matters !== 'string') {
    await logEvent({
      eventType: 'pr.opportunity.parse_failed',
      source: 'openai',
      status: 'failure',
      errorMessage: 'parse error -- malformed JSON from opportunity parser',
      payload: { raw_response_excerpt: completion.text.slice(0, 400) }
    });
    throw new PrDraftParseError('OpenAI returned malformed JSON for opportunity parse');
  }

  const source: PrSource = isPrSource(parsed.source)
    ? parsed.source
    : args.sourceHint && isPrSource(args.sourceHint)
      ? args.sourceHint
      : 'manual';

  const matchedLeadId =
    typeof parsed.matched_lead_id === 'number' &&
    candidates.some((c) => c.id === parsed.matched_lead_id)
      ? parsed.matched_lead_id
      : null;

  const result: ParsedOpportunity = {
    source,
    outlet: cleanStr(parsed.outlet, 255),
    journalist: cleanStr(parsed.journalist, 255),
    queryText: cleanStr(parsed.query_text, 8000) ?? args.rawText.trim().slice(0, 8000),
    topicTags: Array.isArray(parsed.topic_tags)
      ? parsed.topic_tags.filter((t) => typeof t === 'string').slice(0, 12).map((t) => t.trim().slice(0, 48))
      : [],
    deadline: normalizeDeadline(parsed.deadline),
    matchedLeadId,
    whyItMatters: parsed.why_it_matters.trim().slice(0, 4000)
  };

  await logEvent({
    eventType: PR_EVENTS.opportunityParsed,
    leadId: matchedLeadId,
    source: 'openai',
    executionTimeMs: Date.now() - started,
    payload: {
      detected_source: result.source,
      topic_tags: result.topicTags,
      matched_lead_id: matchedLeadId,
      model: completion.model,
      tokens: completion.usage.totalTokens
    }
  });

  return result;
}

// ===========================================================================
// 2. DRAFT a pitch for an opportunity + (optional) client
// ===========================================================================

export async function draftPitch(args: {
  opportunity: PrOpportunity;
  leadId: number | null;
  /** Force a voice/mode. If omitted, resolved from whether the lead is a client. */
  mode?: PitchMode;
}): Promise<DraftedPitchResult> {
  const tenantId = args.opportunity.tenantId || DEFAULT_TENANT;
  const intel = await loadClientIntelligence(tenantId, args.leadId);
  if (args.leadId && !intel.lead) throw new PrLeadNotFoundError(args.leadId);

  // Resolve voice. CRITICAL: never write claims AS a prospect. Only an actual
  // client (we are authorized to speak for them) gets client_voice; everyone
  // else defaults to advisory outreach written TO them in A&V's voice.
  const mode: PitchMode = args.mode ?? resolveDefaultMode(intel.lead);

  const started = Date.now();
  const systemPrompt = buildPitchSystemPrompt(mode);
  const userPrompt = buildPitchUserPrompt({ opportunity: args.opportunity, intel, mode });

  let completion;
  try {
    completion = await openaiChatCompletion(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      { model: MODEL, temperature: TEMPERATURE, maxTokens: DRAFT_MAX_TOKENS, json: true }
    );
  } catch (err) {
    if (err instanceof OpenAIKeyMissingError || err instanceof OpenAIApiError) {
      await logEvent({
        eventType: 'pr.pitch.generate_failed',
        leadId: args.leadId,
        source: 'openai',
        status: 'failure',
        errorMessage: err.message,
        payload: { opportunity_id: args.opportunity.id }
      });
    }
    throw err;
  }

  const parsed = parseOpenAIJson<{
    body_text?: string;
    why_it_matters?: string;
    derived_objects?: Array<{ object_type?: string; object_json?: unknown; confidence?: number }>;
  }>(completion.text);

  if (!parsed || typeof parsed.body_text !== 'string') {
    await logEvent({
      eventType: 'pr.pitch.generate_failed',
      leadId: args.leadId,
      source: 'openai',
      status: 'failure',
      errorMessage: 'parse error -- malformed JSON from pitch drafter',
      payload: { opportunity_id: args.opportunity.id, raw_response_excerpt: completion.text.slice(0, 400) }
    });
    throw new PrDraftParseError('OpenAI returned malformed JSON for pitch draft');
  }

  const derivedObjects = sanitizeDerivedObjects(parsed.derived_objects);

  await logEvent({
    eventType: PR_EVENTS.pitchGenerated,
    leadId: args.leadId,
    source: 'openai',
    executionTimeMs: Date.now() - started,
    payload: {
      opportunity_id: args.opportunity.id,
      model: completion.model,
      tokens: completion.usage.totalTokens,
      grounded_on_intelligence: intel.grounded,
      derived_object_types: derivedObjects.map((o) => o.objectType)
    }
  });

  return {
    mode,
    bodyText: parsed.body_text.trim(),
    whyItMatters: (parsed.why_it_matters ?? args.opportunity.whyItMatters ?? '').trim().slice(0, 4000),
    model: completion.model,
    tokensUsed: completion.usage.totalTokens,
    derivedObjects,
    groundedOnIntelligence: intel.grounded
  };
}

// ===========================================================================
// 3. DRAFT a press release for a client win/launch
// ===========================================================================

export async function draftRelease(args: {
  tenantId?: string;
  leadId: number | null;
  announcement: string;
}): Promise<DraftedReleaseResult> {
  const tenantId = args.tenantId ?? DEFAULT_TENANT;
  const intel = await loadClientIntelligence(tenantId, args.leadId);
  if (args.leadId && !intel.lead) throw new PrLeadNotFoundError(args.leadId);

  const started = Date.now();
  const systemPrompt = buildReleaseSystemPrompt();
  const userPrompt = buildReleaseUserPrompt({ announcement: args.announcement, intel });

  let completion;
  try {
    completion = await openaiChatCompletion(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      { model: MODEL, temperature: TEMPERATURE, maxTokens: DRAFT_MAX_TOKENS, json: true }
    );
  } catch (err) {
    if (err instanceof OpenAIKeyMissingError || err instanceof OpenAIApiError) {
      await logEvent({
        eventType: 'pr.release.generate_failed',
        leadId: args.leadId,
        source: 'openai',
        status: 'failure',
        errorMessage: err.message
      });
    }
    throw err;
  }

  const parsed = parseOpenAIJson<{
    title?: string;
    body_text?: string;
    derived_objects?: Array<{ object_type?: string; object_json?: unknown; confidence?: number }>;
  }>(completion.text);

  if (!parsed || typeof parsed.body_text !== 'string' || typeof parsed.title !== 'string') {
    await logEvent({
      eventType: 'pr.release.generate_failed',
      leadId: args.leadId,
      source: 'openai',
      status: 'failure',
      errorMessage: 'parse error -- malformed JSON from release drafter',
      payload: { raw_response_excerpt: completion.text.slice(0, 400) }
    });
    throw new PrDraftParseError('OpenAI returned malformed JSON for release draft');
  }

  const derivedObjects = sanitizeDerivedObjects(parsed.derived_objects);

  await logEvent({
    eventType: PR_EVENTS.releaseDrafted,
    leadId: args.leadId,
    source: 'openai',
    executionTimeMs: Date.now() - started,
    payload: {
      model: completion.model,
      tokens: completion.usage.totalTokens,
      grounded_on_intelligence: intel.grounded,
      derived_object_types: derivedObjects.map((o) => o.objectType)
    }
  });

  return {
    title: parsed.title.trim().slice(0, 300),
    bodyText: parsed.body_text.trim(),
    model: completion.model,
    tokensUsed: completion.usage.totalTokens,
    derivedObjects,
    groundedOnIntelligence: intel.grounded
  };
}

// ===========================================================================
// Intelligence-object persistence (the compounding store)
// ===========================================================================

/**
 * UPSERT derived intelligence objects.
 *
 * For lead-scoped objects (leadId != null) the unique key
 * uq_tenant_lead_type (tenant_id, lead_id, object_type) lets us use
 * INSERT ... ON DUPLICATE KEY UPDATE.
 *
 * For tenant-level objects (leadId == null) MySQL allows multiple NULLs in a
 * unique index, so the key does NOT dedupe -- we must SELECT-then-UPDATE/INSERT
 * in app code (see schema 025 comment).
 *
 * Returns the count actually written. Never throws out -- intelligence capture
 * must not break the drafting flow.
 */
export async function upsertIntelligenceObjects(args: {
  tenantId: string;
  leadId: number | null;
  objects: DerivedIntelligenceObject[];
  source: string;
}): Promise<number> {
  if (!args.objects.length) return 0;
  const db = getAvDb();
  let written = 0;

  for (const obj of args.objects) {
    const json = JSON.stringify(obj.objectJson ?? null);
    const confidence = clampConfidence(obj.confidence);
    try {
      if (args.leadId != null) {
        await db.execute<ResultSetHeader>(
          `INSERT INTO intelligence_objects
             (tenant_id, lead_id, object_type, object_json, source, confidence)
           VALUES (?, ?, ?, CAST(? AS JSON), ?, ?)
           ON DUPLICATE KEY UPDATE
             object_json = VALUES(object_json),
             source = VALUES(source),
             confidence = VALUES(confidence),
             updated_at = NOW()`,
          [args.tenantId, args.leadId, obj.objectType, json, args.source, confidence]
        );
      } else {
        // tenant-level: emulate upsert because NULL lead_id breaks the unique key
        const [rows] = await db.execute<(RowDataPacket & { id: number })[]>(
          `SELECT id FROM intelligence_objects
             WHERE tenant_id = ? AND lead_id IS NULL AND object_type = ?
             LIMIT 1`,
          [args.tenantId, obj.objectType]
        );
        if (rows[0]?.id) {
          await db.execute<ResultSetHeader>(
            `UPDATE intelligence_objects
               SET object_json = CAST(? AS JSON), source = ?, confidence = ?, updated_at = NOW()
             WHERE id = ?`,
            [json, args.source, confidence, rows[0].id]
          );
        } else {
          await db.execute<ResultSetHeader>(
            `INSERT INTO intelligence_objects
               (tenant_id, lead_id, object_type, object_json, source, confidence)
             VALUES (?, NULL, ?, CAST(? AS JSON), ?, ?)`,
            [args.tenantId, obj.objectType, json, args.source, confidence]
          );
        }
      }
      written++;
    } catch (err) {
      console.error('[pr:intel:upsert]', obj.objectType, (err as Error).message);
    }
  }

  if (written > 0) {
    await logEvent({
      eventType: PR_EVENTS.authoritySignalDetected,
      leadId: args.leadId,
      source: args.source,
      payload: {
        object_types: args.objects.map((o) => o.objectType),
        written
      }
    });
  }

  return written;
}

// ===========================================================================
// Internal: intelligence loading
// ===========================================================================

async function loadCandidateLeads(): Promise<CandidateLead[]> {
  const db = getAvDb();
  // AV pipeline leads are the candidate clients. Prefer scored, recent leads.
  // (leads has no tenant_id column; AV leads are the single source of truth.)
  // mysql2 + HostGator throws ER_WRONG_ARGUMENTS on a prepared `LIMIT ?`.
  // MAX_CANDIDATE_LEADS is a fixed integer constant, so inlining it is safe.
  const [rows] = await db.execute<CandidateRow[]>(
    `SELECT id, company, industry
       FROM leads
      WHERE archived_at IS NULL
      ORDER BY (ai_score IS NULL), ai_score DESC, id DESC
      LIMIT ${MAX_CANDIDATE_LEADS}`
  );
  return rows.map((r) => ({ id: r.id, company: r.company, industry: r.industry }));
}

async function loadClientIntelligence(
  tenantId: string,
  leadId: number | null
): Promise<ClientIntelligence> {
  if (leadId == null) {
    const objectSummaries = await loadObjectSummaries(tenantId, null);
    return { lead: null, objectSummaries, grounded: objectSummaries.length > 0 };
  }

  const db = getAvDb();
  const [rows] = await db.execute<LeadIntelRow[]>(
    `SELECT id, company, industry, website, audit_content, challenge, pain_point_profile,
            client_id, lead_status
       FROM leads
      WHERE id = ? AND archived_at IS NULL
      LIMIT 1`,
    [leadId]
  );
  const lead = rows[0] ?? null;
  const objectSummaries = await loadObjectSummaries(tenantId, leadId);

  const hasAudit = !!(lead?.audit_content && lead.audit_content.length > 50);
  const hasPain = !!lead?.pain_point_profile;
  const grounded = hasAudit || hasPain || objectSummaries.length > 0;

  return { lead, objectSummaries, grounded };
}

/** Read accumulated intelligence_objects (lead-scoped first, then tenant-level). */
async function loadObjectSummaries(tenantId: string, leadId: number | null): Promise<string[]> {
  const db = getAvDb();
  const [rows] = await db.execute<IntelObjRow[]>(
    `SELECT object_type, object_json, lead_id, confidence
       FROM intelligence_objects
      WHERE tenant_id = ?
        AND (lead_id = ? OR lead_id IS NULL)
      ORDER BY (lead_id IS NULL), updated_at DESC
      LIMIT 24`,
    [tenantId, leadId]
  );
  return rows.map((r) => {
    const scope = r.lead_id == null ? 'tenant' : 'client';
    const val = compactJson(r.object_json);
    return `[${scope}] ${r.object_type}: ${val}`;
  });
}

// ===========================================================================
// Internal: prompt construction
// ===========================================================================

function buildParseSystemPrompt(): string {
  return [
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
}

function buildParseUserPrompt(args: {
  rawText: string;
  sourceHint: PrSource | null;
  candidates: CandidateLead[];
}): string {
  const parts: string[] = [];
  if (args.sourceHint) parts.push(`SOURCE_HINT (operator-selected, prefer this if plausible): ${args.sourceHint}`);
  parts.push(`CANDIDATE_CLIENTS (id | company | industry) -- pick at most one best match:`);
  if (args.candidates.length) {
    for (const c of args.candidates) {
      parts.push(`  ${c.id} | ${c.company} | ${c.industry ?? 'unknown'}`);
    }
  } else {
    parts.push(`  (none available -- return matched_lead_id null)`);
  }
  parts.push(``);
  parts.push(`RAW_QUERY_TEXT (parse this):`);
  parts.push(args.rawText.trim().slice(0, 6000));
  parts.push(``);
  parts.push(`Now produce the JSON object specified.`);
  return parts.join('\n');
}

/**
 * Decide the default voice. CRITICAL data-model note: a lead is essentially
 * NEVER the client -- `leads.client_id` points to the client account the lead
 * BELONGS TO, and the lead itself is a prospect. So we always default to
 * advisory outreach (A&V's voice, written TO the prospect). `client_voice`
 * (writing as the business, to publish on their behalf) is a deliberate manual
 * choice the operator makes only when they are genuinely producing content for
 * an actual client account -- it is never auto-selected.
 */
function resolveDefaultMode(_lead: LeadIntelRow | null): PitchMode {
  return 'advisory';
}

const SHARED_DERIVE_AND_FORMAT = [
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

function buildPitchSystemPrompt(mode: PitchMode): string {
  if (mode === 'client_voice') {
    return [
      `You write short, specific, credible PR pitches and expert-source responses for a marketing platform called Atlantic & Vine, ON BEHALF OF AN ACTUAL CLIENT who has authorized us to speak for them.`,
      ``,
      `RULES -- never break these:`,
      `1. Speak in PLURAL voice as the client business ("our team", "we", "our venue/agency"). Never first-person singular "I", never a person's name.`,
      `2. Ground the pitch in ONE or TWO concrete points from CLIENT_INTELLIGENCE (audit, pain-point profile, intelligence objects). Specific, not filler.`,
      `3. Address QUERY_TEXT directly; lead with the most quotable line.`,
      `4. 120-220 words, plain text, no markdown.`,
      `5. Sound like a real operator, not a press release or chatbot. No "I hope this finds you well", no hype.`,
      `6. Never mention pricing or any per-unit cost. Never reveal it was AI-generated.`,
      ...SHARED_DERIVE_AND_FORMAT
    ].join('\n');
  }
  if (mode === 'congratulatory') {
    return [
      `You write a short, warm outreach note FROM Atlantic & Vine (a marketing/PR firm) TO a PROSPECT business. You are NOT the prospect and have NO authority to speak for them or to assert claims about their business as fact.`,
      ``,
      `RULES -- never break these:`,
      `1. Voice is Atlantic & Vine's, PLURAL ("we", "our team"), addressed TO the prospect ("you", "your team").`,
      `2. Acknowledge something genuinely noteworthy the prospect appears to have done, then connect it to a PR/visibility opportunity we could help with. Open a conversation, do not pitch hard.`,
      `3. NEVER state claims about the prospect as established fact and NEVER write as if you are them. Reference only what is in PROSPECT_INTELLIGENCE, and hedge ("it looks like", "we noticed", "if that's right"). If a detail is not in the intelligence, do not assert it.`,
      `4. 90-160 words, plain text, no markdown. Warm, specific, not salesy.`,
      `5. End with a soft, low-pressure CTA to talk.`,
      `6. Never mention pricing or any per-unit cost. Never reveal it was AI-generated.`,
      ...SHARED_DERIVE_AND_FORMAT
    ].join('\n');
  }
  // advisory (default for prospects)
  return [
    `You write a short, sharp advisory note FROM Atlantic & Vine (a marketing/PR firm) TO a PROSPECT business. You are NOT the prospect and have NO authority to speak for them or to assert claims about their business as fact.`,
    ``,
    `RULES -- never break these:`,
    `1. Voice is Atlantic & Vine's, PLURAL ("we", "our team"), addressed TO the prospect ("you", "your team"). Never write as if you are them.`,
    `2. Recommend ONE specific, credible PR/content/visibility angle the prospect could pursue, grounded in PROSPECT_INTELLIGENCE (their industry, audit observations, pain points) and the opportunity. Frame it as expert advice: "here's the kind of story that would earn you coverage", "we'd position you around X".`,
    `3. NEVER assert claims about the prospect as established fact; reference only what is in the intelligence and hedge where unsure. Do not fabricate wins, quotes, or numbers.`,
    `4. 110-180 words, plain text, no markdown. Specific and useful enough that it demonstrates expertise.`,
    `5. End with a soft CTA to talk about executing it.`,
    `6. Never mention pricing or any per-unit cost. Never reveal it was AI-generated.`,
    ...SHARED_DERIVE_AND_FORMAT
  ].join('\n');
}

function buildPitchUserPrompt(args: { opportunity: PrOpportunity; intel: ClientIntelligence; mode: PitchMode }): string {
  const { opportunity, intel, mode } = args;
  const parts: string[] = [];
  parts.push(`MODE: ${mode}${mode === 'client_voice' ? ' (write AS the client)' : ' (write TO the prospect as Atlantic & Vine -- do NOT claim anything as them)'}`);
  parts.push(`OPPORTUNITY_SOURCE: ${opportunity.source}`);
  if (opportunity.outlet) parts.push(`OUTLET: ${opportunity.outlet}`);
  if (opportunity.journalist) parts.push(`JOURNALIST: ${opportunity.journalist}`);
  if (opportunity.topicTags?.length) parts.push(`TOPIC_TAGS: ${opportunity.topicTags.join(', ')}`);
  if (opportunity.deadline) parts.push(`DEADLINE: ${opportunity.deadline}`);
  parts.push(``);
  parts.push(`QUERY_TEXT (what the journalist asked -- answer this):`);
  parts.push(opportunity.queryText ?? '(no query text provided)');
  parts.push(``);
  parts.push(buildIntelligenceBlock(intel));
  parts.push(``);
  parts.push(`Now produce the JSON object specified.`);
  return parts.join('\n');
}

function buildReleaseSystemPrompt(): string {
  return [
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
}

function buildReleaseUserPrompt(args: { announcement: string; intel: ClientIntelligence }): string {
  const parts: string[] = [];
  parts.push(`ANNOUNCEMENT (the win/launch to announce):`);
  parts.push(args.announcement.trim().slice(0, 4000));
  parts.push(``);
  parts.push(buildIntelligenceBlock(args.intel));
  parts.push(``);
  parts.push(`Now produce the JSON object specified.`);
  return parts.join('\n');
}

function buildIntelligenceBlock(intel: ClientIntelligence): string {
  const parts: string[] = [];
  if (intel.lead) {
    parts.push(`CLIENT_INTELLIGENCE:`);
    parts.push(`  COMPANY: ${intel.lead.company}`);
    if (intel.lead.industry) parts.push(`  INDUSTRY: ${intel.lead.industry}`);
    if (intel.lead.website) parts.push(`  WEBSITE: ${intel.lead.website}`);
    if (intel.lead.challenge) parts.push(`  STATED_CHALLENGE: ${intel.lead.challenge.slice(0, 400)}`);
    const pain = compactJson(intel.lead.pain_point_profile);
    if (pain && pain !== 'null') parts.push(`  PAIN_POINT_PROFILE: ${pain}`);
    if (intel.lead.audit_content && intel.lead.audit_content.length > 20) {
      parts.push(`  AUDIT_EXCERPT: ${truncate(intel.lead.audit_content.trim(), AUDIT_EXCERPT_MAX_CHARS)}`);
    }
  } else {
    parts.push(`CLIENT_INTELLIGENCE: (no specific client attached -- this is a tenant-level pitch; ground it in Atlantic & Vine's positioning and the query topic)`);
  }
  if (intel.objectSummaries.length) {
    parts.push(`  ACCUMULATED_INTELLIGENCE_OBJECTS:`);
    for (const s of intel.objectSummaries) parts.push(`    - ${s}`);
  }
  return parts.join('\n');
}

// ===========================================================================
// Internal: small helpers
// ===========================================================================

function sanitizeDerivedObjects(
  raw: Array<{ object_type?: string; object_json?: unknown; confidence?: number }> | undefined
): DerivedIntelligenceObject[] {
  if (!Array.isArray(raw)) return [];
  const out: DerivedIntelligenceObject[] = [];
  for (const item of raw) {
    if (!item || !isDerivableObjectType(item.object_type)) continue;
    if (item.object_json == null) continue;
    out.push({
      objectType: item.object_type,
      objectJson: item.object_json,
      confidence: clampConfidence(item.confidence)
    });
    if (out.length >= 6) break;
  }
  return out;
}

function clampConfidence(c: number | null | undefined): number | null {
  if (typeof c !== 'number' || !Number.isFinite(c)) return null;
  return Math.max(0, Math.min(100, Math.round(c)));
}

function cleanStr(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t) return null;
  return t.slice(0, max);
}

/** Accepts a JSON column value (string or already-parsed object) -> compact one-liner. */
function compactJson(v: unknown): string {
  if (v == null) return 'null';
  try {
    const obj = typeof v === 'string' ? JSON.parse(v) : v;
    return JSON.stringify(obj).slice(0, 800);
  } catch {
    return typeof v === 'string' ? v.slice(0, 800) : String(v);
  }
}

function normalizeDeadline(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t) return null;
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return null;
  // store as MySQL-friendly datetime
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 3) + '...';
}
