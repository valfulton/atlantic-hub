/**
 * lib/pr/types.ts
 *
 * Shared types for the PR / Narrative Intelligence Engine (schema 025).
 *
 * PR is NOT a standalone press-release tool. It is an intelligence-distribution
 * layer on top of the shared operational intelligence graph: "create
 * intelligence once, distribute everywhere." See
 * docs/CLAUDE_KICKOFF_PR_ENGINE.md and docs/OPERATIONAL_INTELLIGENCE_MANIFESTO.md.
 *
 * Tables (schema/025_pr_engine.sql):
 *   pr_opportunities, pr_pitches, press_releases, press_distribution_log,
 *   intelligence_objects.
 *
 * Tenancy: AV pipeline leads live under tenant 'av'. tenant_id is carried on
 * every row so the future narrative graph can span tenants without a rewrite.
 */

export const DEFAULT_TENANT = 'av';

// ---------------------------------------------------------------------------
// Source channels (mirror the source ENUM in schema 025 + the PR-source
// appendix in the kickoff doc). v1 ingestion for all of these is paste/forward
// -> AI parse -> instant draft; none have an open inbound API.
// ---------------------------------------------------------------------------

export const PR_SOURCES = [
  'qwoted',
  'featured',
  'sourcebottle',
  'help_a_b2b_writer',
  'reddit',
  'linkedin',
  'podcast',
  'manual',
  'other'
] as const;
export type PrSource = (typeof PR_SOURCES)[number];

export function isPrSource(v: unknown): v is PrSource {
  return typeof v === 'string' && (PR_SOURCES as readonly string[]).includes(v);
}

/** Human labels for the UI source picker. */
export const PR_SOURCE_LABELS: Record<PrSource, string> = {
  qwoted: 'Qwoted',
  featured: 'Featured.com',
  sourcebottle: 'SourceBottle',
  help_a_b2b_writer: 'Help a B2B Writer',
  reddit: 'Reddit',
  linkedin: 'LinkedIn',
  podcast: 'Podcast',
  manual: 'Manual',
  other: 'Other'
};

export type PrOpportunityStatus = 'new' | 'drafted' | 'submitted' | 'won' | 'passed';
export type PrPitchStatus = 'draft' | 'approved' | 'sent' | 'declined';
export type PressReleaseStatus = 'draft' | 'approved' | 'published';
export type DistributionOutcome = 'queued' | 'submitted' | 'live' | 'failed';

// ---------------------------------------------------------------------------
// Row shapes (camelCase mirrors of the DB rows)
// ---------------------------------------------------------------------------

export interface PrOpportunity {
  id: number;
  tenantId: string;
  source: PrSource;
  outlet: string | null;
  journalist: string | null;
  queryText: string | null;
  topicTags: string[] | null;
  whyItMatters: string | null;
  deadline: string | null;
  matchedLeadId: number | null;
  status: PrOpportunityStatus;
  createdByUserId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface PrPitch {
  id: number;
  opportunityId: number;
  tenantId: string;
  leadId: number | null;
  bodyText: string | null;
  model: string | null;
  status: PrPitchStatus;
  createdAt: string;
  updatedAt: string;
}

export interface PressRelease {
  id: number;
  tenantId: string;
  leadId: number | null;
  title: string | null;
  bodyText: string | null;
  status: PressReleaseStatus;
  createdByUserId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface DistributionLogRow {
  id: number;
  releaseId: number | null;
  pitchId: number | null;
  tenantId: string | null;
  channel: string;
  outcome: DistributionOutcome;
  url: string | null;
  detail: string | null;
  attemptedAt: string;
}

// ---------------------------------------------------------------------------
// Intelligence objects -- the compounding-intelligence store. These are the
// reusable strategic context layers referenced across outreach, PR, social,
// commercials, proposals, sales prep, authority positioning, etc.
// ---------------------------------------------------------------------------

export const INTELLIGENCE_OBJECT_TYPES = [
  'founder_story',
  'authority_positioning',
  'pain_point_profile',
  'audience_psychology',
  'seasonal_opportunities',
  'competitive_weaknesses',
  'market_positioning',
  'differentiators',
  'preferred_narrative_angles',
  'proof_points',
  'engagement_patterns',
  'authority_topics',
  'media_friendly_topics'
] as const;
export type IntelligenceObjectType = (typeof INTELLIGENCE_OBJECT_TYPES)[number];

/**
 * The object_types the PR drafter is allowed to derive + persist while
 * drafting. (pain_point_profile is READ from the leads table, never written
 * here -- see schema 025 comment.)
 */
export const DRAFTER_DERIVABLE_TYPES: IntelligenceObjectType[] = [
  'founder_story',
  'authority_positioning',
  'authority_topics',
  'media_friendly_topics',
  'preferred_narrative_angles',
  'proof_points',
  'market_positioning',
  'differentiators'
];

export function isDerivableObjectType(v: unknown): v is IntelligenceObjectType {
  return typeof v === 'string' && (DRAFTER_DERIVABLE_TYPES as string[]).includes(v);
}

export interface IntelligenceObject {
  id: number;
  tenantId: string;
  leadId: number | null;
  objectType: IntelligenceObjectType | string;
  objectJson: unknown;
  source: string | null;
  confidence: number | null;
  createdAt: string;
  updatedAt: string;
}

/** A derived intelligence object the drafter wants persisted. */
export interface DerivedIntelligenceObject {
  objectType: IntelligenceObjectType;
  /** Arbitrary structured payload; stored as JSON. */
  objectJson: unknown;
  /** 0-100 model confidence, optional. */
  confidence?: number | null;
}

// ---------------------------------------------------------------------------
// Drafter I/O
// ---------------------------------------------------------------------------

/** Parsed shape returned by the AI when turning pasted query text into a row. */
export interface ParsedOpportunity {
  source: PrSource;
  outlet: string | null;
  journalist: string | null;
  queryText: string;
  topicTags: string[];
  /** ISO 8601 or null; best-effort extraction of an explicit deadline. */
  deadline: string | null;
  /** Best client match from the candidate list, or null if none fit. */
  matchedLeadId: number | null;
  /** Strategic-guidance string (see STRATEGIC GUIDANCE REQUIREMENT). */
  whyItMatters: string;
}

/** Compact lead descriptor passed to the parser so it can pick a best match. */
export interface CandidateLead {
  id: number;
  company: string;
  industry: string | null;
}

export interface DraftedPitchResult {
  bodyText: string;
  /** Refreshed/strengthened strategic guidance for this opportunity + client. */
  whyItMatters: string;
  model: string;
  tokensUsed: number;
  /** Reusable intelligence objects derived while drafting (to upsert). */
  derivedObjects: DerivedIntelligenceObject[];
  /** True if the client's audit_content / pain_point_profile grounded the draft. */
  groundedOnIntelligence: boolean;
}

export interface DraftedReleaseResult {
  title: string;
  bodyText: string;
  model: string;
  tokensUsed: number;
  derivedObjects: DerivedIntelligenceObject[];
  groundedOnIntelligence: boolean;
}

// ---------------------------------------------------------------------------
// Distribution channels (v1: most are "guided" -- the operator completes the
// submit; only owned newsroom + email/API channels can fire automatically).
// Be honest in the UI about which are automated vs guided.
// ---------------------------------------------------------------------------

export type ChannelMode = 'automated' | 'guided';

export interface DistributionChannelDef {
  key: string;
  label: string;
  mode: ChannelMode;
  note: string;
}

export const DISTRIBUTION_CHANNELS: DistributionChannelDef[] = [
  { key: 'newsroom', label: 'Client newsroom / blog', mode: 'guided', note: 'Owned page with article schema. The one channel that can be automated once the client site exposes a publish endpoint; guided for v1.' },
  { key: 'email', label: 'Direct email to journalist', mode: 'guided', note: 'Operator sends from their own mailbox; logged here for the record.' },
  { key: 'linkedin', label: 'LinkedIn', mode: 'guided', note: 'Authority comment / post. Operator posts; logged here.' },
  { key: 'x', label: 'X', mode: 'guided', note: 'Operator posts; logged here.' },
  { key: 'prlog', label: 'PRLog (free)', mode: 'guided', note: 'Free release site. Operator submits; logged here.' },
  { key: 'openpr', label: 'openPR (free)', mode: 'guided', note: 'Free release site. Operator submits; logged here.' },
  { key: 'einpresswire', label: 'EIN Presswire (paid)', mode: 'guided', note: 'Paid wire, cost-passthrough. Operator submits; logged here.' }
];

export function channelMode(key: string): ChannelMode {
  return DISTRIBUTION_CHANNELS.find((c) => c.key === key)?.mode ?? 'guided';
}

// ---------------------------------------------------------------------------
// PR.* event types (emitted via lib/events/log.ts into system_events).
// ---------------------------------------------------------------------------

export const PR_EVENTS = {
  opportunityCreated: 'pr.opportunity.created',
  opportunityParsed: 'pr.opportunity.parsed',
  pitchGenerated: 'pr.pitch.generated',
  pitchApproved: 'pr.pitch.approved',
  pitchSent: 'pr.pitch.sent',
  coverageEarned: 'pr.coverage.earned',
  releaseDrafted: 'pr.release.drafted',
  releaseApproved: 'pr.release.approved',
  releasePublished: 'pr.release.published',
  distributionQueued: 'pr.distribution.queued',
  distributionFailed: 'pr.distribution.failed',
  authoritySignalDetected: 'pr.authority.signal_detected',
  topicTrending: 'pr.topic.trending'
} as const;

// ---------------------------------------------------------------------------
// Normalized timeline item -- the campaign-orchestration spine. v1 maps
// social_outbox into this shape; PR pitches/releases, outreach, commercials and
// seasonal initiatives map into the SAME shape later (additive, not a rewrite).
// ---------------------------------------------------------------------------

export type TimelineItemType =
  | 'social'
  | 'pr_pitch'
  | 'pr_release'
  | 'outreach'
  | 'commercial'
  | 'launch';

export type TimelineItemStatus =
  | 'draft'
  | 'scheduled'
  | 'publishing'
  | 'published'
  | 'failed'
  | 'canceled';

export interface TimelineItem {
  /** Stable id within its source, e.g. "social:123". */
  id: string;
  /** ISO datetime the item is anchored to (scheduled_for, or published_at). */
  when: string;
  type: TimelineItemType;
  status: TimelineItemStatus;
  tenant: string;
  leadId: number | null;
  title: string;
  link: string | null;
}
