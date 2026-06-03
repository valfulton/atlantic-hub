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
import { parseOpenAIJson } from '@/lib/llm/parse';
import { runLlm } from '@/lib/llm/router';
import { getBriefForPrompt, getIntelConfig, getVoiceLockBlock } from '@/lib/client/brief_store';
import { getSystemPrompt } from '@/lib/ai/prompt_registry';
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

export interface LeadIntelRow extends RowDataPacket {
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

export interface ClientIntelligence {
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

  const systemPrompt = await getSystemPrompt('pr_opportunity_parse');
  const userPrompt = buildParseUserPrompt({
    rawText: args.rawText,
    sourceHint: args.sourceHint ?? null,
    candidates
  });

  let completion;
  try {
    // (#371) Migrated onto runLlm. cachePolicy 'time' 7d — same raw text
    // parses to the same structure for that window.
    completion = await runLlm({
      taskKind: 'pr_opportunity_parse',
      note: `pr-parse source=${args.sourceHint ?? 'manual'}`,
      clientId: null, // pre-match, no client known yet
      prompt: `SYSTEM:\n${systemPrompt}\n\nUSER:\n${userPrompt}`,
      cacheKeyExtras: [args.rawText.slice(0, 400), args.sourceHint ?? 'manual'],
      temperature: 0.3,
      maxTokens: PARSE_MAX_TOKENS,
      json: true
    });
  } catch (err) {
    const e = err as Error;
    const isApi =
      e.name === 'OpenAIKeyMissingError' || e.name === 'OpenAIApiError' ||
      e.name === 'OpenRouterTransientError' || e.name === 'GeminiTransientError' ||
      e.name === 'UnsupportedProviderError';
    if (isApi) {
      await logEvent({
        eventType: 'pr.opportunity.parse_failed',
        source: 'openai',
        status: 'failure',
        errorMessage: e.message
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
      tokens: (completion.inputTokens + completion.outputTokens)
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
  let intel = await loadClientIntelligence(tenantId, args.leadId);
  // Tolerate an archived/missing lead: degrade to a tenant-level pitch rather
  // than failing the whole orchestrate run. Batch social points at ideas whose
  // matched lead may have been archived (this was the `Lead not found` error).
  if (args.leadId && !intel.lead) {
    intel = await loadClientIntelligence(tenantId, null);
  }

  // Resolve voice. Priority: (1) an explicit mode the operator passed for this
  // pitch, (2) the brand's CONFIGURED default voice from its brief (val sets this
  // per client and can change it any time), (3) the safe fallback (advisory — never
  // write claims AS a prospect unless explicitly told to).
  const clientId = intel.lead?.client_id ?? null;
  const intelCfg = await getIntelConfig(tenantId, clientId);
  const mode: PitchMode = args.mode ?? intelCfg.defaultVoice ?? resolveDefaultMode(args.opportunity.source);

  // Ground on the brand's OWN creative brief (its identity), so a pitch for a
  // client / EBW / HH reads as that brand and not a generic Atlantic & Vine voice.
  const brand = await getBriefForPrompt({
    tenantId,
    clientId,
    fallbackName: intel.lead?.company ?? null
  });

  // (#88) Voice lock: surface the brand's voice + key_message + spokesperson +
  // authority topics as a top-of-prompt VOICE_LOCK block so the drafter
  // actually sounds like THIS client and not generic A&V. Null when no brief
  // is on file (older clients) — behavior unchanged in that case.
  const voiceLockBlock = await getVoiceLockBlock(tenantId, clientId);

  const started = Date.now();
  const systemPrompt = await getSystemPrompt(`pr_pitch_${mode}`);
  const userPrompt = buildPitchUserPrompt({
    opportunity: args.opportunity,
    intel,
    mode,
    brandBlock: brand.block,
    voiceLockBlock
  });

  let completion;
  try {
    // (#371) Migrated onto runLlm. cachePolicy 'none' — pitch is creative
    // output, never reuse. Per-client cost attribution via intel.lead.client_id.
    completion = await runLlm({
      taskKind: 'pr_draft_pitch',
      note: `pr-pitch opp=${args.opportunity.id} mode=${mode}`,
      clientId: intel.lead?.client_id ?? null,
      prompt: `SYSTEM:\n${systemPrompt}\n\nUSER:\n${userPrompt}`,
      cacheKeyExtras: [String(args.opportunity.id), mode],
      temperature: TEMPERATURE,
      maxTokens: DRAFT_MAX_TOKENS,
      json: true
    });
  } catch (err) {
    const e = err as Error;
    const isApi =
      e.name === 'OpenAIKeyMissingError' || e.name === 'OpenAIApiError' ||
      e.name === 'OpenRouterTransientError' || e.name === 'GeminiTransientError' ||
      e.name === 'UnsupportedProviderError';
    if (isApi) {
      await logEvent({
        eventType: 'pr.pitch.generate_failed',
        leadId: args.leadId,
        source: 'openai',
        status: 'failure',
        errorMessage: e.message,
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
      tokens: (completion.inputTokens + completion.outputTokens),
      grounded_on_intelligence: intel.grounded,
      derived_object_types: derivedObjects.map((o) => o.objectType)
    }
  });

  return {
    mode,
    bodyText: parsed.body_text.trim(),
    whyItMatters: (parsed.why_it_matters ?? args.opportunity.whyItMatters ?? '').trim().slice(0, 4000),
    model: completion.model,
    tokensUsed: (completion.inputTokens + completion.outputTokens),
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
  let intel = await loadClientIntelligence(tenantId, args.leadId);
  // Tolerate an archived/missing lead: degrade to tenant-level rather than fail.
  if (args.leadId && !intel.lead) {
    intel = await loadClientIntelligence(tenantId, null);
  }

  const releaseClientId = intel.lead?.client_id ?? null;
  const brand = await getBriefForPrompt({
    tenantId,
    clientId: releaseClientId,
    fallbackName: intel.lead?.company ?? null
  });
  // (#88) Same voice lock applies to press releases written for this client.
  const voiceLockBlock = await getVoiceLockBlock(tenantId, releaseClientId);

  const started = Date.now();
  const systemPrompt = await getSystemPrompt('pr_release');
  const userPrompt = buildReleaseUserPrompt({
    announcement: args.announcement,
    intel,
    brandBlock: brand.block,
    voiceLockBlock
  });

  let completion;
  try {
    // (#371) Migrated onto runLlm. cachePolicy 'none' — release is creative
    // output, never reuse.
    completion = await runLlm({
      taskKind: 'pr_draft_release',
      note: `pr-release lead=${args.leadId ?? 'none'}`,
      clientId: releaseClientId,
      prompt: `SYSTEM:\n${systemPrompt}\n\nUSER:\n${userPrompt}`,
      cacheKeyExtras: [String(args.leadId ?? 'none'), args.announcement.slice(0, 200)],
      temperature: TEMPERATURE,
      maxTokens: DRAFT_MAX_TOKENS,
      json: true
    });
  } catch (err) {
    const e = err as Error;
    const isApi =
      e.name === 'OpenAIKeyMissingError' || e.name === 'OpenAIApiError' ||
      e.name === 'OpenRouterTransientError' || e.name === 'GeminiTransientError' ||
      e.name === 'UnsupportedProviderError';
    if (isApi) {
      await logEvent({
        eventType: 'pr.release.generate_failed',
        leadId: args.leadId,
        source: 'openai',
        status: 'failure',
        errorMessage: e.message
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
      tokens: (completion.inputTokens + completion.outputTokens),
      grounded_on_intelligence: intel.grounded,
      derived_object_types: derivedObjects.map((o) => o.objectType)
    }
  });

  return {
    title: parsed.title.trim().slice(0, 300),
    bodyText: parsed.body_text.trim(),
    model: completion.model,
    tokensUsed: (completion.inputTokens + completion.outputTokens),
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

export async function loadClientIntelligence(
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
  let objectSummaries = await loadObjectSummaries(tenantId, leadId);

  // Fold in the owning CLIENT's extracted intake intelligence. Intake extraction
  // (lib/client/intake_extract.ts) writes canonical objects under tenant
  // `client:<id>`; a pitch for this client's lead should be grounded in what the
  // client told us at intake (authority topics, media hooks, proof points, etc.).
  // Constitution tenancy: client-scoped intelligence lives under `client:<id>`.
  if (lead?.client_id) {
    try {
      const clientSummaries = (await loadObjectSummaries(`client:${lead.client_id}`, null)).map((s) =>
        s.replace(/^\[tenant\]/, '[client intake]')
      );
      if (clientSummaries.length) objectSummaries = [...clientSummaries, ...objectSummaries];
    } catch {
      /* non-fatal: degrade to lead/tenant intelligence only */
    }
  }

  const hasAudit = !!(lead?.audit_content && lead.audit_content.length > 50);
  const hasPain = !!lead?.pain_point_profile;
  const grounded = hasAudit || hasPain || objectSummaries.length > 0;

  return { lead, objectSummaries, grounded };
}

/** Read accumulated intelligence_objects (lead-scoped first, then tenant-level). */
async function loadObjectSummaries(tenantId: string, leadId: number | null): Promise<string[]> {
  // (#188) Scope STRICTLY to this lead's own intelligence_objects. Previously
  // this also read tenant-wide rows (lead_id IS NULL), which let ambient noise
  // (a single SEO row about an unrelated business) seed drafter context with
  // off-topic material the model then riffed into the wrong client's guidance.
  // Matches the no-bleed rule lib/client/guidance.ts already enforces.
  // House/agency-wide objects should be authored against a specific lead now,
  // not the tenant.
  if (leadId == null) return [];
  const db = getAvDb();
  const [rows] = await db.execute<IntelObjRow[]>(
    `SELECT object_type, object_json, lead_id, confidence
       FROM intelligence_objects
      WHERE tenant_id = ?
        AND lead_id = ?
      ORDER BY updated_at DESC
      LIMIT 24`,
    [tenantId, leadId]
  );
  return rows.map((r) => {
    const val = compactJson(r.object_json);
    return `[client] ${r.object_type}: ${val}`;
  });
}

// ===========================================================================
// Internal: prompt construction
// ===========================================================================

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
 * Decide the default voice from the opportunity SOURCE.
 *
 * - A genuine media request (a journalist query, podcast call, community ask
 *   pulled from qwoted / featured / sourcebottle / help_a_b2b_writer / reddit /
 *   linkedin / podcast) wants a QUOTABLE expert response in the brand/client's
 *   voice -- exactly what the desk promises. -> client_voice.
 * - Internal "ideas from your data" are stored with source 'manual', and 'other'
 *   is the catch-all; both are OUTREACH angles to a prospect. -> advisory
 *   (Atlantic & Vine's voice, written TO the prospect).
 *
 * This is only the DEFAULT. It is overridden by (1) an explicit per-draft Voice
 * the operator picks, and (2) a brand's configured default voice on its brief.
 * Keep this in sync with defaultModeForSource() in app/admin/pr/PrDesk.tsx, which
 * mirrors it so the "edit this voice's prompt" link points at the right prompt.
 */
function resolveDefaultMode(source: PrSource): PitchMode {
  return source === 'manual' || source === 'other' ? 'advisory' : 'client_voice';
}

// The three PR pitch voices now live in the editable prompt registry
// (lib/ai/prompt_registry.ts) under keys pr_pitch_advisory / pr_pitch_client_voice
// / pr_pitch_congratulatory, read at call time via getSystemPrompt(`pr_pitch_${mode}`).

function buildPitchUserPrompt(args: { opportunity: PrOpportunity; intel: ClientIntelligence; mode: PitchMode; brandBlock?: string; voiceLockBlock?: string | null }): string {
  const { opportunity, intel, mode, brandBlock, voiceLockBlock } = args;
  const parts: string[] = [];
  if (brandBlock && brandBlock.trim()) { parts.push(brandBlock.trim()); parts.push(``); }
  // (#88) Voice lock sits BETWEEN the brand block and the opportunity facts so
  // the model attends to it right when picking voice/spokesperson/topic.
  if (voiceLockBlock && voiceLockBlock.trim()) { parts.push(voiceLockBlock.trim()); parts.push(``); }
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

function buildReleaseUserPrompt(args: { announcement: string; intel: ClientIntelligence; brandBlock?: string; voiceLockBlock?: string | null }): string {
  const parts: string[] = [];
  if (args.brandBlock && args.brandBlock.trim()) { parts.push(args.brandBlock.trim()); parts.push(``); }
  if (args.voiceLockBlock && args.voiceLockBlock.trim()) { parts.push(args.voiceLockBlock.trim()); parts.push(``); }
  parts.push(`ANNOUNCEMENT (the win/launch to announce):`);
  parts.push(args.announcement.trim().slice(0, 4000));
  parts.push(``);
  parts.push(buildIntelligenceBlock(args.intel));
  parts.push(``);
  parts.push(`Now produce the JSON object specified.`);
  return parts.join('\n');
}

export function buildIntelligenceBlock(intel: ClientIntelligence): string {
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
