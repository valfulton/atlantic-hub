/**
 * lib/pr/artifacts.ts
 *
 * The content-artifact drafter (schema 029). It produces the broader owned
 * content types the pitch+release pair does not cover -- blog articles, SEO
 * articles, own-brand posts, and per-client deliverables.
 *
 * THE POINT IS THE INTELLIGENCE LOOP, not the table. This drafter mirrors
 * lib/pr/drafter.ts and follows the master pattern in docs/SYSTEM_CONSTITUTION.md
 * (section 5):
 *   1. READ shared intelligence (intelligence_objects + leads.pain_point_profile
 *      + audit_content + industry) -- reuses loadClientIntelligence from the PR
 *      drafter so there is ONE intelligence loader, not two.
 *   2. GENERATE the artifact grounded in that intelligence.
 *   3. EMIT a content.* event into system_events via lib/events/log.ts.
 *   4. PERSIST reusable intelligence back into intelligence_objects (strengthen,
 *      don't replace) via the existing upsertIntelligenceObjects.
 *   (5/6 -- canonical state update + the operator "why this matters" surface --
 *      live in the routes / desk that call this.)
 *
 * SEO keyword clusters are stored in content_artifacts.meta_json (per schema
 * 029), NOT as a new intelligence_objects type -- the locked taxonomy is never
 * extended. Only the existing DRAFTER_DERIVABLE_TYPES are written back.
 *
 * VOICE (carried from the lead-never-client fix):
 *   - blog_article / seo_article for a LEAD/prospect -> advisory (A&V's voice,
 *     written for/about them; never assert claims AS them).
 *   - own_brand_post -> client_voice (the brand publishes on its OWN channel).
 *   - client_deliverable -> client_voice only when the lead is an actual client
 *     (client_id set, or lead_status converted/case_study); else advisory.
 *   - blog/seo with no lead at all -> client_voice (pure own-brand content).
 *
 * Brand voice in client_voice mode: PLURAL ("our team", "we") -- never a founder
 * name. Never mention pricing, dollar amounts, or any per-unit API cost, and
 * never reveal the content was AI-generated (artifacts get published).
 */

import {
  openaiChatCompletion,
  parseOpenAIJson,
  OpenAIKeyMissingError,
  OpenAIApiError
} from '@/lib/openai/client';
import { logEvent } from '@/lib/events/log';
import {
  loadClientIntelligence,
  buildIntelligenceBlock,
  PrDraftParseError,
  type ClientIntelligence,
  type LeadIntelRow
} from '@/lib/pr/drafter';
import {
  DEFAULT_TENANT,
  CONTENT_EVENTS,
  isDerivableObjectType,
  type ArtifactType,
  type ArtifactMeta,
  type DerivedIntelligenceObject,
  type DraftedArtifactResult,
  type PitchMode
} from '@/lib/pr/types';

const MODEL = 'gpt-4o-mini';
const TEMPERATURE = 0.7;
const ARTICLE_MAX_TOKENS = 2000; // blog / seo / client deliverable: long-form
const POST_MAX_TOKENS = 700; // own-brand social post: short

// ---------------------------------------------------------------------------
// Voice resolution
// ---------------------------------------------------------------------------

/** A lead is an actual client only if it is linked to a client account or has
 *  reached a client lifecycle stage. Otherwise it is a prospect (advisory). */
function leadIsClient(lead: LeadIntelRow | null): boolean {
  if (!lead) return false;
  if (lead.client_id != null) return true;
  return lead.lead_status === 'converted' || lead.lead_status === 'case_study';
}

/**
 * Resolve the voice for an artifact. `override` (operator's explicit choice)
 * always wins. CRITICAL: we never auto-write claims AS a prospect.
 */
export function resolveArtifactVoice(
  artifactType: ArtifactType,
  lead: LeadIntelRow | null,
  override?: PitchMode
): PitchMode {
  if (override) return override;
  if (artifactType === 'own_brand_post') return 'client_voice';
  const isClient = leadIsClient(lead);
  if (artifactType === 'client_deliverable') return isClient ? 'client_voice' : 'advisory';
  // blog_article / seo_article
  if (lead == null) return 'client_voice'; // pure own-brand content (no prospect attached)
  return isClient ? 'client_voice' : 'advisory';
}

// ---------------------------------------------------------------------------
// Draft an artifact
// ---------------------------------------------------------------------------

export async function draftArtifact(args: {
  artifactType: ArtifactType;
  tenantId?: string;
  leadId: number | null;
  /** Optional operator-supplied topic/angle. Keeps "no typing" optional. */
  topic?: string | null;
  /** Optional narrative-line context (from buildNarrativeContext().promptBlock).
   *  When present, the piece MUST advance this market thesis. This is how a
   *  narrative line steers generation across channels. */
  narrativeContext?: string | null;
  /** Force a voice; otherwise resolved from artifact type + lead-vs-client. */
  voiceMode?: PitchMode;
}): Promise<DraftedArtifactResult> {
  const tenantId = args.tenantId ?? DEFAULT_TENANT;
  let intel = await loadClientIntelligence(tenantId, args.leadId);
  // If a leadId was supplied but the lead is gone (archived / cleaned up), DON'T
  // fail the whole draft. Batch drafting points at ideas whose matched lead may
  // have been archived; a missing lead must not kill the post. Degrade to a
  // tenant-level piece grounded on whatever cluster / own-brand intelligence we
  // have, and record that the artifact should be stored with no lead_id.
  let effectiveLeadId = args.leadId;
  if (args.leadId && !intel.lead) {
    effectiveLeadId = null;
    intel = await loadClientIntelligence(tenantId, null);
  }

  const voiceMode = resolveArtifactVoice(args.artifactType, intel.lead, args.voiceMode);
  const started = Date.now();
  const isPost = args.artifactType === 'own_brand_post';

  const systemPrompt = buildArtifactSystemPrompt(args.artifactType, voiceMode);
  const userPrompt = buildArtifactUserPrompt({
    artifactType: args.artifactType,
    intel,
    tenantId,
    topic: args.topic ?? null,
    narrativeContext: args.narrativeContext ?? null
  });

  let completion;
  try {
    completion = await openaiChatCompletion(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      { model: MODEL, temperature: TEMPERATURE, maxTokens: isPost ? POST_MAX_TOKENS : ARTICLE_MAX_TOKENS, json: true }
    );
  } catch (err) {
    if (err instanceof OpenAIKeyMissingError || err instanceof OpenAIApiError) {
      await logEvent({
        eventType: CONTENT_EVENTS.artifactDraftFailed,
        leadId: effectiveLeadId,
        source: 'openai',
        status: 'failure',
        errorMessage: err.message,
        payload: { artifact_type: args.artifactType }
      });
    }
    throw err;
  }

  const parsed = parseOpenAIJson<{
    title?: string;
    body_text?: string;
    meta?: Record<string, unknown>;
    derived_objects?: Array<{ object_type?: string; object_json?: unknown; confidence?: number }>;
  }>(completion.text);

  if (!parsed || typeof parsed.body_text !== 'string') {
    await logEvent({
      eventType: CONTENT_EVENTS.artifactDraftFailed,
      leadId: effectiveLeadId,
      source: 'openai',
      status: 'failure',
      errorMessage: 'parse error -- malformed JSON from artifact drafter',
      payload: { artifact_type: args.artifactType, raw_response_excerpt: completion.text.slice(0, 400) }
    });
    throw new PrDraftParseError('OpenAI returned malformed JSON for artifact draft');
  }

  const derivedObjects = sanitizeDerivedObjects(parsed.derived_objects);
  const metaJson = sanitizeMeta(parsed.meta);

  await logEvent({
    eventType: CONTENT_EVENTS.artifactDrafted,
    leadId: args.leadId,
    source: 'pr_artifacts',
    executionTimeMs: Date.now() - started,
    payload: {
      artifact_type: args.artifactType,
      voice_mode: voiceMode,
      model: completion.model,
      tokens: completion.usage.totalTokens,
      grounded_on_intelligence: intel.grounded,
      derived_object_types: derivedObjects.map((o) => o.objectType),
      keyword_cluster_size: Array.isArray(metaJson.keyword_cluster) ? metaJson.keyword_cluster.length : 0
    }
  });

  return {
    artifactType: args.artifactType,
    voiceMode,
    title: (parsed.title ?? '').trim().slice(0, 300),
    bodyText: parsed.body_text.trim(),
    metaJson,
    model: completion.model,
    tokensUsed: completion.usage.totalTokens,
    derivedObjects,
    groundedOnIntelligence: intel.grounded,
    effectiveLeadId
  };
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

const SHARED_RULES = [
  `Never mention pricing, dollar amounts, or any per-unit AI/API cost. Never reveal the content was AI-generated.`,
  `Ground specifics in the supplied intelligence; do not fabricate wins, quotes, numbers, or credentials.`
];

const DERIVE_BLOCK = [
  ``,
  `ALSO derive reusable strategic intelligence objects you discover while writing, so the platform reuses them later instead of regenerating. Only emit objects of these types when you genuinely have signal: founder_story, authority_positioning, authority_topics, media_friendly_topics, preferred_narrative_angles, proof_points, market_positioning, differentiators. Each object_json is a compact structured object. Emit an empty array if you have nothing solid -- do not fabricate.`
];

function voiceLine(voiceMode: PitchMode): string {
  if (voiceMode === 'client_voice') {
    return `VOICE: client_voice -- write in the business's own PLURAL voice ("we", "our team"). You are authorized to publish on its behalf. Never use first-person singular or a person's name.`;
  }
  if (voiceMode === 'congratulatory') {
    return `VOICE: congratulatory -- write FROM Atlantic & Vine (a marketing/PR firm) TO the prospect ("you", "your team"), acknowledging something noteworthy. You are NOT them; never assert claims as them; hedge ("it looks like", "we noticed").`;
  }
  return `VOICE: advisory -- write FROM Atlantic & Vine (a marketing/PR firm) addressing the topic for/about the prospect. You are NOT them and have NO authority to speak as them; never assert claims about them as established fact; hedge where unsure.`;
}

function buildArtifactSystemPrompt(artifactType: ArtifactType, voiceMode: PitchMode): string {
  const base: string[] = [];

  if (artifactType === 'blog_article') {
    base.push(
      `You write long-form owned blog content for a marketing platform called Atlantic & Vine.`,
      voiceLine(voiceMode),
      ``,
      `RULES:`,
      `1. 600-900 words. Plain text with short, plain-language section headings (a single line per heading, no markdown symbols). A strong opening, 3-5 body sections, a brief closing takeaway.`,
      `2. Useful and specific -- it should read like it was written by someone who knows the industry, not generic filler.`,
      `3. Title: 6-14 words, concrete, search-friendly, no clickbait.`,
      ...SHARED_RULES.map((r, i) => `${i + 4}. ${r}`),
      ``,
      `meta: return an object with slug (kebab-case), meta_description (<=160 chars), and suggested_headings (the section headings you used, as an array).`,
      ...DERIVE_BLOCK,
      ``,
      formatBlock(['title', 'body_text', 'meta', 'derived_objects'])
    );
    return base.join('\n');
  }

  if (artifactType === 'seo_article') {
    base.push(
      `You write SEO-optimized long-form articles for a marketing platform called Atlantic & Vine, designed to rank and to earn organic visibility.`,
      voiceLine(voiceMode),
      ``,
      `RULES:`,
      `1. Pick ONE primary target search query the piece should rank for, derived from the intelligence (industry + pain points + authority topics). Build a small keyword cluster of 5-10 related terms around it.`,
      `2. 700-1000 words. Plain text with descriptive section headings (one line each, no markdown symbols) that naturally include cluster terms. Open by answering the searcher's intent quickly.`,
      `3. Title: 6-14 words, includes the primary query naturally, no clickbait.`,
      `4. Write for humans first; weave keywords in naturally, never stuff them.`,
      ...SHARED_RULES.map((r, i) => `${i + 5}. ${r}`),
      ``,
      `meta: return an object with target_query (the primary query), keyword_cluster (array of related terms), slug (kebab-case), meta_description (<=160 chars), and suggested_headings (array). This is article-schema friendly.`,
      ...DERIVE_BLOCK,
      ``,
      formatBlock(['title', 'body_text', 'meta', 'derived_objects'])
    );
    return base.join('\n');
  }

  if (artifactType === 'own_brand_post') {
    base.push(
      `You write a short social post that one of Atlantic & Vine's OWN brands publishes on its OWN channel (LinkedIn / X / Instagram).`,
      voiceLine(voiceMode),
      ``,
      `RULES:`,
      `1. 80-160 words. A scroll-stopping first line, one concrete idea or insight, and a soft, non-salesy CTA.`,
      `2. Sound like a real operator with a point of view, not a press release or a chatbot. No "I hope this finds you well", no hype.`,
      `3. Title: a 3-8 word internal label for this post (not shown to the audience).`,
      ...SHARED_RULES.map((r, i) => `${i + 4}. ${r}`),
      ``,
      `meta: return an object with hashtags (3-6 relevant, lowercase, no spaces, array) and suggested_channel ("linkedin" | "x" | "instagram" | "any").`,
      ...DERIVE_BLOCK,
      ``,
      formatBlock(['title', 'body_text', 'meta', 'derived_objects'])
    );
    return base.join('\n');
  }

  // client_deliverable
  base.push(
    `You produce a polished content deliverable for a marketing platform called Atlantic & Vine. When in client_voice this is finished content the client can publish; in advisory voice it is an expert recommendation/brief written for a prospect.`,
    voiceLine(voiceMode),
    ``,
    `RULES:`,
    `1. 400-700 words. Plain text with clear section headings (one line each, no markdown symbols). Lead with the most valuable point.`,
    `2. Concrete and immediately usable. If advisory, frame it as "here is the content/angle we'd produce for you and why".`,
    `3. Title: 6-12 words describing the deliverable.`,
    ...SHARED_RULES.map((r, i) => `${i + 4}. ${r}`),
    ``,
    `meta: return an object with meta_description (<=160 chars) and suggested_headings (array).`,
    ...DERIVE_BLOCK,
    ``,
    formatBlock(['title', 'body_text', 'meta', 'derived_objects'])
  );
  return base.join('\n');
}

function formatBlock(fields: string[]): string {
  const lines = ['RESPONSE FORMAT: respond with ONLY this JSON object:', '{'];
  const sample: Record<string, string> = {
    title: '  "title": "...",',
    body_text: '  "body_text": "...",',
    meta: '  "meta": { ... },',
    derived_objects: '  "derived_objects": [ { "object_type": "authority_topics", "object_json": { ... }, "confidence": 0-100 } ]'
  };
  fields.forEach((f, i) => {
    let line = sample[f];
    // strip trailing comma on the last field
    if (i === fields.length - 1) line = line.replace(/,\s*$/, '');
    lines.push(line);
  });
  lines.push('}');
  return lines.join('\n');
}

function buildArtifactUserPrompt(args: {
  artifactType: ArtifactType;
  intel: ClientIntelligence;
  tenantId: string;
  topic: string | null;
  narrativeContext?: string | null;
}): string {
  const parts: string[] = [];
  parts.push(`ARTIFACT_TYPE: ${args.artifactType}`);
  if (args.artifactType === 'own_brand_post') {
    parts.push(`OWN_BRAND_TENANT: ${args.tenantId} (this content is published by this brand on its own channel)`);
  }
  // Narrative line comes FIRST and is binding: the piece must advance the thesis.
  if (args.narrativeContext && args.narrativeContext.trim()) {
    parts.push(args.narrativeContext.trim());
    parts.push(`(The narrative line above is binding. Advance this thesis; do not drift off it.)`);
  }
  if (args.topic && args.topic.trim()) {
    parts.push(`OPERATOR_TOPIC (optional steer -- prioritize this angle if present): ${args.topic.trim().slice(0, 600)}`);
  }
  parts.push(``);
  parts.push(buildIntelligenceBlock(args.intel));
  parts.push(``);
  parts.push(`Now produce the JSON object specified.`);
  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Small helpers (mirror lib/pr/drafter.ts)
// ---------------------------------------------------------------------------

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

/** Keep meta_json tidy: only the known SEO/post fields, clamped + de-junked. */
function sanitizeMeta(raw: Record<string, unknown> | undefined): ArtifactMeta {
  const meta: ArtifactMeta = {};
  if (!raw || typeof raw !== 'object') return meta;
  const str = (v: unknown, max: number): string | undefined => {
    if (typeof v !== 'string') return undefined;
    const t = v.trim();
    return t ? t.slice(0, max) : undefined;
  };
  const strArr = (v: unknown, maxItems: number, maxLen: number): string[] | undefined => {
    if (!Array.isArray(v)) return undefined;
    const arr = v
      .filter((x) => typeof x === 'string')
      .map((x) => (x as string).trim().slice(0, maxLen))
      .filter(Boolean)
      .slice(0, maxItems);
    return arr.length ? arr : undefined;
  };
  const slug = str(raw.slug, 120);
  if (slug) meta.slug = slug.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120);
  const md = str(raw.meta_description, 200);
  if (md) meta.meta_description = md;
  const tq = str(raw.target_query, 200);
  if (tq) meta.target_query = tq;
  const kc = strArr(raw.keyword_cluster, 20, 80);
  if (kc) meta.keyword_cluster = kc;
  const sh = strArr(raw.suggested_headings, 12, 160);
  if (sh) meta.suggested_headings = sh;
  const tags = strArr(raw.hashtags, 8, 48);
  if (tags) meta.hashtags = tags.map((t) => t.replace(/^#/, ''));
  const ch = str(raw.suggested_channel, 32);
  if (ch) meta.suggested_channel = ch.toLowerCase();
  return meta;
}

function clampConfidence(c: number | null | undefined): number | null {
  if (typeof c !== 'number' || !Number.isFinite(c)) return null;
  return Math.max(0, Math.min(100, Math.round(c)));
}
