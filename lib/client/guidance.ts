/**
 * lib/client/guidance.ts
 *
 * The CLIENT GUIDANCE COMPOSER -- the worked example of the System Constitution
 * (docs/SYSTEM_CONSTITUTION.md) and the platform's monetization surface. See
 * docs/CLAUDE_KICKOFF_CLIENT_INTELLIGENCE.md.
 *
 * WHAT THIS IS: a deterministic, fully-explainable sweep that turns the
 * intelligence the hub ALREADY HOLDS about a client's business into a small,
 * ranked set of "what matters most right now, and why" guidance items. It is
 * NOT a new prediction / recommendation / scoring engine -- it SURFACES existing
 * intelligence. No external API, no per-call LLM cost (mirrors the deterministic
 * philosophy of lib/pr/discovery.ts).
 *
 * INTELLIGENCE LOOP (constitution section 5):
 *   1. READ shared intelligence the hub holds for this client:
 *        - their primary lead/account record (the same client_id-or-email join
 *          /api/client/me uses) + pain_point_profile + ai_combined_score +
 *          score_history (momentum = trend of `combined` over the history)
 *        - their intelligence_objects under tenant 'av' (authority_topics,
 *          media_friendly_topics, seasonal_opportunities, preferred_narrative_
 *          angles, proof_points, ...), written by the PR engine / discovery
 *        - pr_opportunities matched to their lead WITH a deadline (decay = days
 *          left)
 *        - recent system_events for their lead (engagement direction / formats)
 *   2. COMPOSE a ranked set (cap by tier, max 5) of guidance items, each with a
 *        plain-language headline, why_it_matters, why_now/timing (decay where a
 *        deadline exists) and an honest value_frame (see VALUE FRAMING below).
 *   3. EMIT `client.guidance.composed` into system_events (lib/events/log.ts).
 *   4. PERSIST the ranked set as a `next_best_moves` intelligence object and the
 *        rising/decaying summary as a `momentum_signals` object, STRENGTHENING
 *        the existing row per the upsert rule. These two object_types are in the
 *        LOCKED taxonomy (constitution section 2 + 6).
 *   5. STATE: unchanged here -- guidance surfaces intelligence, it does not move
 *        a lifecycle (constitution section 3).
 *   6. SURFACE: the dashboard renders the items (app/client/dashboard).
 *
 * TENANCY: existing intelligence about an AV business lives under tenant 'av'
 * keyed by the lead id (that is where the PR engine wrote it), so we READ from
 * 'av'. We PERSIST the composed client-facing guidance under the client's own
 * tenant `client:<clientUserId>` so client guidance stays namespaced away from
 * the operator graph. Both obey the constitution's canonical store + taxonomy.
 *
 * VALUE FRAMING (B2 -- honest, never fabricated, never inference cost):
 *   - Prefer a relative / priority frame grounded in the client's own data
 *     ("aligns with your strongest conversion topic", "highest-engagement format
 *     for your audience").
 *   - Where a defensible quantity exists from their account (days until a real
 *     deadline, their tier's monthly volume), surface it as an opportunity frame.
 *   - If there is no honest number, frame priority + momentum. NEVER manufacture
 *     a dollar figure. NEVER show per-unit AI / inference cost (CLIENT_FACING_
 *     GUARDRAILS.md). Confidence comes from clarity, not fake precision.
 *
 * REALITY/HORIZON: this moves "guided next-step layer on the client side" from
 * EARLY toward REAL. It does NOT build predictive orchestration (that is Horizon
 * -- constitution section 9).
 */

import { getAvDb } from '@/lib/db/av';
import { logEvent } from '@/lib/events/log';
import type { RowDataPacket } from 'mysql2';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The operator graph these AV businesses' intelligence is stored under. */
const SOURCE_TENANT = 'av';

/** How long a persisted guidance set is considered fresh. */
export const GUIDANCE_TTL_MS = 24 * 60 * 60 * 1000; // 24h (B4 staleness window)

/** LOCKED intelligence_objects types this composer persists (constitution s.6). */
const OBJECT_NEXT_BEST_MOVES = 'next_best_moves';
const OBJECT_MOMENTUM_SIGNALS = 'momentum_signals';

/** Event emitted on every successful compose (namespace client.* is approved). */
export const CLIENT_GUIDANCE_EVENT = 'client.guidance.composed';

/** How many items a tier may see. Higher tier = more depth, never a price. */
const TIER_ITEM_CAP: Record<string, number> = {
  audit_only: 2,
  sprint: 3,
  momentum: 4,
  scale: 5
};
const HARD_ITEM_CAP = 5;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type GuidanceKind =
  | 'deadline_window'   // a real PR opportunity / seasonal window with a deadline
  | 'momentum'          // score trend rising / re-engage
  | 'authority'         // strongest authority / conversion topic
  | 'focus'             // the move that addresses their biggest gap (pain)
  | 'format';           // the content format earning the most engagement

export type MomentumDirection = 'rising' | 'steady' | 'cooling' | 'unknown';

export interface GuidanceItem {
  /** Stable-ish key for React + dedupe within a set. */
  key: string;
  rank: number;
  kind: GuidanceKind;
  /** Plain-language, calm, confidence-building. */
  headline: string;
  whyItMatters: string;
  /** Timing / why-now line; includes decay where a deadline exists. */
  whyNow: string;
  /** Honest value frame -- priority/momentum/opportunity, NEVER a fabricated $ or AI cost. */
  valueFrame: string;
  /** Days until a real deadline, when this item carries one. */
  decayDays?: number;
  topic?: string;
}

export interface MomentumSignal {
  direction: MomentumDirection;
  /** Most recent combined readiness score (0-100), when known. */
  current: number | null;
  /** Earliest combined score in the window we compared against. */
  previous: number | null;
  delta: number | null;
  /** A short, calm explanation suitable for the client. */
  summary: string;
}

export interface ClientGuidance {
  tenantId: string;
  leadId: number | null;
  items: GuidanceItem[];
  momentum: MomentumSignal;
  composedAt: string; // ISO
  /** True when this came from cache (not recomposed on this request). */
  fromCache: boolean;
  /** True when we had real intelligence to ground on (vs an empty/early state). */
  grounded: boolean;
}

/** The minimal client identity the composer needs (from client_users). */
export interface ClientIdentity {
  clientUserId: number;
  clientId: number | null;
  email: string;
  tier: string;
  displayName?: string | null;
}

// ---------------------------------------------------------------------------
// DB row shapes (read-only)
// ---------------------------------------------------------------------------

interface PrimaryLeadRow extends RowDataPacket {
  id: number;
  company: string | null;
  industry: string | null;
  audit_content: string | null;
  pain_point_profile: string | object | null;
  ai_score: number | null;
  ai_score_band: string | null;
  ai_combined_score: number | null;
  score_history: string | object | null;
  lead_status: string | null;
}

interface IntelObjRow extends RowDataPacket {
  object_type: string;
  object_json: string | object | null;
  confidence: number | null;
  updated_at: Date | null;
}

interface PrOppRow extends RowDataPacket {
  id: number;
  outlet: string | null;
  query_text: string | null;
  topic_tags: string | object | null;
  why_it_matters: string | null;
  deadline: Date | null;
  status: string | null;
}

interface EventRow extends RowDataPacket {
  event_type: string;
  c: number;
}

interface CachedObjRow extends RowDataPacket {
  object_json: string | object | null;
  updated_at: Date | null;
}

// ===========================================================================
// PUBLIC API
// ===========================================================================

/**
 * Read cached guidance for a client and recompose if it is missing or stale
 * (older than GUIDANCE_TTL_MS). This is what the dashboard calls on load (B4):
 * fast on a warm cache, self-healing when cold. `force` recomposes regardless.
 */
export async function getOrComposeClientGuidance(args: {
  client: ClientIdentity;
  force?: boolean;
}): Promise<ClientGuidance> {
  const tenantId = clientTenant(args.client.clientUserId);

  if (!args.force) {
    const cached = await readCachedGuidance(tenantId);
    if (cached && !isStale(cached.composedAt)) {
      return { ...cached, fromCache: true };
    }
  }

  return composeClientGuidance({ client: args.client });
}

/**
 * Run the full Intelligence Loop for one client and persist + emit. Always
 * returns a guidance object (an empty-but-honest "early" state when the hub has
 * nothing solid yet). Never throws out -- guidance must never break the portal.
 */
export async function composeClientGuidance(args: {
  client: ClientIdentity;
}): Promise<ClientGuidance> {
  const { client } = args;
  const tenantId = clientTenant(client.clientUserId);
  const started = Date.now();
  const composedAt = new Date().toISOString();

  try {
    // ---- 1. READ ----
    const lead = await loadPrimaryLead(client);
    const leadId = lead?.id ?? null;

    const [objects, opps, formatStat] = await Promise.all([
      leadId != null ? loadIntelObjects(leadId) : Promise.resolve([] as IntelObjRow[]),
      leadId != null ? loadDeadlineOpportunities(leadId) : Promise.resolve([] as PrOppRow[]),
      leadId != null ? loadTopEngagementFormat(leadId) : Promise.resolve(null)
    ]);

    const momentum = deriveMomentum(lead);

    // ---- 2. COMPOSE ----
    const cap = Math.min(TIER_ITEM_CAP[client.tier] ?? 3, HARD_ITEM_CAP);
    const items = composeItems({ lead, objects, opps, momentum, formatStat }).slice(0, cap);
    const grounded =
      items.length > 0 || momentum.direction !== 'unknown' || objects.length > 0;

    const guidance: ClientGuidance = {
      tenantId,
      leadId,
      items,
      momentum,
      composedAt,
      fromCache: false,
      grounded
    };

    // ---- 3. EMIT ----
    await logEvent({
      eventType: CLIENT_GUIDANCE_EVENT,
      leadId,
      source: 'client_guidance',
      executionTimeMs: Date.now() - started,
      payload: {
        tenant_id: tenantId,
        client_user_id: client.clientUserId,
        item_count: items.length,
        item_kinds: items.map((i) => i.kind),
        momentum: momentum.direction,
        grounded
      }
    });

    // ---- 4. PERSIST (strengthen, do not append duplicates) ----
    await persistGuidance(tenantId, leadId, guidance);

    // ---- 5. STATE: unchanged (guidance surfaces, it does not move a lifecycle) ----
    // ---- 6. SURFACE: the dashboard renders `items` ----

    return guidance;
  } catch (err) {
    console.error('[client:guidance:compose]', (err as Error).message);
    // Fail soft: return an honest empty state so the portal still renders.
    return {
      tenantId,
      leadId: null,
      items: [],
      momentum: { direction: 'unknown', current: null, previous: null, delta: null, summary: '' },
      composedAt,
      fromCache: false,
      grounded: false
    };
  }
}

// ===========================================================================
// READ helpers
// ===========================================================================

/**
 * The client's primary "self" lead/account record -- the lead row that
 * represents THIS CLIENT'S OWN BUSINESS (e.g. Skip's own EHP account record),
 * NOT one of their pipeline prospects.
 *
 * (#177 fix) Previously the ORDER BY preferred any lead with client_id matching
 * the client (i.e. their pipeline prospects), so Skip's dashboard treated Carrier
 * HVAC's pain profile AS IF IT WERE SKIP'S OWN PAIN. That's the headline-of-a-
 * prospect-rendered-as-the-client bug. Now: strictly prefer the email match
 * (Skip-as-prospect-of-A&V's original lead row if it exists) and explicitly
 * EXCLUDE any lead owned by the client (their pipeline prospects).
 *
 * If no self-record exists -- which is common for clients who came in directly
 * via intake without ever being an AV-pipeline lead -- returns null and the
 * composer routes to a brief-derived path instead of inventing a pain from
 * someone else's data.
 */
async function loadPrimaryLead(client: ClientIdentity): Promise<PrimaryLeadRow | null> {
  const db = getAvDb();
  const [rows] = await db.execute<PrimaryLeadRow[]>(
    `SELECT id, company, industry, audit_content, pain_point_profile,
            ai_score, ai_score_band, ai_combined_score, score_history, lead_status
       FROM leads
      WHERE archived_at IS NULL
        AND email = ?
        AND (client_id IS NULL OR client_id <> ?)
      ORDER BY (audit_content IS NOT NULL) DESC,
               COALESCE(audit_generated, created_at) DESC
      LIMIT 1`,
    [client.email, client.clientId ?? 0]
  );
  return rows[0] ?? null;
}

/**
 * Accumulated intelligence_objects for THIS business only — strictly lead-scoped.
 *
 * NO-BLEED: we deliberately do NOT pull tenant-level (lead_id IS NULL) 'av'
 * objects here. Those are house/agency-wide intelligence (and, in practice,
 * leftover test artifacts like a debt-collection authority topic); reading them
 * into one client's guidance leaked unrelated themes into every client's "what
 * matters most" panel regardless of who they were. A client's guidance must
 * ground only on their own lead's intelligence.
 */
async function loadIntelObjects(leadId: number): Promise<IntelObjRow[]> {
  const db = getAvDb();
  const [rows] = await db.execute<IntelObjRow[]>(
    `SELECT object_type, object_json, confidence, updated_at
       FROM intelligence_objects
      WHERE tenant_id = ?
        AND lead_id = ?
      ORDER BY confidence DESC, updated_at DESC
      LIMIT 40`,
    [SOURCE_TENANT, leadId]
  );
  return rows;
}

/**
 * PR opportunities matched to this business that still have a live deadline.
 * Decay = days remaining. Excludes won/passed and anything already expired.
 */
async function loadDeadlineOpportunities(leadId: number): Promise<PrOppRow[]> {
  const db = getAvDb();
  const [rows] = await db.execute<PrOppRow[]>(
    `SELECT id, outlet, query_text, topic_tags, why_it_matters, deadline, status
       FROM pr_opportunities
      WHERE tenant_id = ?
        AND matched_lead_id = ?
        AND deadline IS NOT NULL
        AND deadline > NOW()
        AND status NOT IN ('won','passed')
      ORDER BY deadline ASC
      LIMIT 5`,
    [SOURCE_TENANT, leadId]
  );
  return rows;
}

/**
 * The content format / channel earning the most engagement for this business,
 * inferred deterministically from recent successful system_events. Returns the
 * dominant event_type bucket or null. No model call.
 */
async function loadTopEngagementFormat(
  leadId: number
): Promise<{ label: string; count: number } | null> {
  const db = getAvDb();
  const [rows] = await db.execute<EventRow[]>(
    `SELECT event_type, COUNT(*) AS c
       FROM system_events
      WHERE lead_id = ?
        AND status = 'success'
        AND event_type IN (
          'social.published',
          'pr.pitch.generated',
          'pr.release.drafted'
        )
        -- (#177 fix) Removed 'ai.audit_generated' and 'ai.social_content_generated'
        -- from this set. Those events fire on INTERNAL work (regenerating an
        -- audit; drafting social content). They are not audience engagement, and
        -- counting them as such made the dashboard say "Your strategic audit is
        -- the format earning the most engagement" any time we re-scored a lead.
      GROUP BY event_type
      ORDER BY c DESC
      LIMIT 1`,
    [leadId]
  );
  const top = rows[0];
  if (!top || top.c <= 0) return null;
  return { label: formatLabelFor(top.event_type), count: Number(top.c) };
}

// ===========================================================================
// COMPOSE -- deterministic ranking
// ===========================================================================

function composeItems(args: {
  lead: PrimaryLeadRow | null;
  objects: IntelObjRow[];
  opps: PrOppRow[];
  momentum: MomentumSignal;
  formatStat: { label: string; count: number } | null;
}): GuidanceItem[] {
  const { lead, objects, opps, momentum, formatStat } = args;
  const out: GuidanceItem[] = [];

  // --- Signal A: live deadline windows (most time-sensitive -> ranked first) ---
  for (const opp of opps) {
    const decay = daysUntil(opp.deadline);
    if (decay == null) continue;
    const topic = primaryTopic(opp.topic_tags) ?? bestTopicLabel(objects) ?? 'your positioning';
    out.push({
      key: `opp:${opp.id}`,
      rank: 0,
      kind: 'deadline_window',
      headline: opp.outlet
        ? `A media opportunity with ${opp.outlet} aligns with ${topic}.`
        : `A narrative window aligns with ${topic}.`,
      whyItMatters:
        `This opportunity maps directly to ${topic}, one of the themes we are already building` +
        ` authority for on your behalf. Acting while the window is open compounds that positioning.`,
      whyNow: decayLine(decay),
      valueFrame:
        `Time-sensitive and aligned with your strongest positioning -- the kind of placement that` +
        ` builds lasting authority, not a one-off.`,
      decayDays: decay,
      topic
    });
  }

  // --- Signal B: seasonal windows from intelligence_objects (carry a date) ---
  const seasonal = objects.find((o) => o.object_type === 'seasonal_opportunities');
  if (seasonal) {
    const s = asObj(seasonal.object_json);
    const decay = daysUntil(extractDateish(s));
    const label = pickString(s, ['theme', 'window', 'title', 'name']) ?? 'a seasonal window';
    if (decay != null) {
      out.push({
        key: 'seasonal',
        rank: 0,
        kind: 'deadline_window',
        headline: `Your seasonal window around ${label} is open now.`,
        whyItMatters:
          `Seasonal timing is one of the highest-leverage moves for your audience -- the right` +
          ` message in the right window outperforms the same message off-season.`,
        whyNow: decayLine(decay),
        valueFrame: `A timing advantage you have right now that fades as the window closes.`,
        decayDays: decay,
        topic: label
      });
    } else {
      out.push({
        key: 'seasonal',
        rank: 50,
        kind: 'focus',
        headline: `${capitalize(label)} is a seasonal opening for your audience.`,
        whyItMatters:
          `We have flagged ${label} as a window that tends to move your market. Leaning into it` +
          ` while it is relevant concentrates your effort where it pays back most.`,
        whyNow: `This is timely now -- worth prioritizing over evergreen work this cycle.`,
        valueFrame: `Aligns your effort with when your audience is most receptive.`,
        topic: label
      });
    }
  }

  // --- Signal C: momentum from score_history ---
  if (momentum.direction === 'rising') {
    out.push({
      key: 'momentum-rising',
      rank: 10,
      kind: 'momentum',
      headline: `Your momentum is building.`,
      whyItMatters: momentum.summary,
      whyNow:
        `Momentum compounds when you keep the cadence -- this is the moment to stay consistent,` +
        ` not to pause.`,
      valueFrame: `You are trending in the right direction; consistency now protects that gain.`
    });
  } else if (momentum.direction === 'cooling') {
    out.push({
      key: 'momentum-cooling',
      rank: 25,
      kind: 'momentum',
      headline: `Let's re-engage your audience.`,
      whyItMatters: momentum.summary,
      whyNow: `A small, deliberate push now is far easier than rebuilding from a longer quiet spell.`,
      valueFrame: `Re-engaging early keeps the relationship warm and avoids a harder restart later.`
    });
  }

  // --- Signal D: strongest authority / conversion topic ---
  const authority = strongestAuthorityTopic(objects);
  if (authority) {
    out.push({
      key: 'authority',
      rank: 30,
      kind: 'authority',
      headline: `Your authority positioning around ${authority} is gaining traction.`,
      whyItMatters:
        `Of all the themes we track for you, ${authority} is your strongest -- it is where your` +
        ` audience and your credibility line up best.`,
      whyNow: `Leading with ${authority} in your next push plays to your single biggest strength.`,
      valueFrame: `Aligns with your strongest conversion topic -- your highest-probability angle.`,
      topic: authority
    });
  }

  // --- Signal E: focus on the biggest gap (pain_point_profile) ---
  // (#177 fix) Only use pain_point_profile as a focus headline when the lead
  // is the client's OWN self-record (lead.client_id IS NULL after the
  // loadPrimaryLead change). Pipeline-prospect pain is about THEM, not us.
  const pain = topPain(lead?.pain_point_profile);
  if (pain && lead && (lead as PrimaryLeadRow & { client_id?: number | null }).client_id == null) {
    out.push({
      key: 'focus-pain',
      rank: 40,
      kind: 'focus',
      headline: `The fastest win right now: ${pain}.`,
      whyItMatters:
        `This is the gap most likely to be holding back results for a business like yours. Closing` +
        ` it tends to unblock everything downstream of it.`,
      whyNow: `Addressing it first means the rest of your effort lands on firmer ground.`,
      valueFrame: `Targets your biggest constraint -- where effort returns the most right now.`,
      topic: pain
    });
  }

  // --- Signal F: best-performing format ---
  if (formatStat) {
    out.push({
      key: 'format',
      rank: 60,
      kind: 'format',
      headline: `${formatStat.label} is the format earning the most engagement for you.`,
      whyItMatters:
        `Your own results point here -- this format is doing more work per post than the others` +
        ` we have tried for you.`,
      whyNow: `Doubling down on what is already working is the lowest-risk way to grow from here.`,
      valueFrame: `Highest-engagement format for your audience -- proven by your own numbers.`,
      topic: formatStat.label
    });
  } else {
    // (#177 fix) No real engagement signal yet -- DON'T fabricate one. Surface
    // a concrete next-step suggestion instead. This is the "what can I do
    // right now to feed the system signal" card that turns a blank dashboard
    // into a usable one for a brand-new client.
    out.push({
      key: 'next-step',
      rank: 70,
      kind: 'format',
      headline: `We're still collecting engagement signal for you.`,
      whyItMatters:
        `As content lands and conversations happen, the platform learns which formats and angles` +
        ` move your audience -- and surfaces what is working back to you here.`,
      whyNow:
        `In the meantime, the highest-leverage moves you can make today: (1) review your most` +
        ` recent lead audits and pick three to reach out to, (2) approve any pending content` +
        ` so we can publish to your channels, (3) open the call scripts on your hot leads and` +
        ` use them on your next call.`,
      valueFrame: `Action now creates the signal we use to coach you later -- and converts at the same time.`
    });
  }

  // Rank: deadline windows first (soonest decay wins), then by rank weight.
  out.sort((a, b) => {
    const ad = a.decayDays ?? Number.POSITIVE_INFINITY;
    const bd = b.decayDays ?? Number.POSITIVE_INFINITY;
    if (a.kind === 'deadline_window' && b.kind === 'deadline_window') return ad - bd;
    if (a.kind === 'deadline_window') return -1;
    if (b.kind === 'deadline_window') return 1;
    return a.rank - b.rank;
  });

  return out.map((item, i) => ({ ...item, rank: i + 1 }));
}

// ===========================================================================
// MOMENTUM derivation (from score_history)
// ===========================================================================

interface ScoreHistoryEntry {
  at?: string;
  combined?: number;
  engagement?: number;
}

function deriveMomentum(lead: PrimaryLeadRow | null): MomentumSignal {
  if (!lead) {
    return { direction: 'unknown', current: null, previous: null, delta: null, summary: '' };
  }
  const history = parseScoreHistory(lead.score_history)
    .filter((h) => typeof h.combined === 'number')
    .slice(-8); // recent window

  const current =
    typeof lead.ai_combined_score === 'number'
      ? lead.ai_combined_score
      : history.length
        ? (history[history.length - 1].combined as number)
        : typeof lead.ai_score === 'number'
          ? lead.ai_score
          : null;

  if (history.length < 2) {
    // Not enough trend signal yet -- treat as steady if we at least have a score.
    return {
      direction: current == null ? 'unknown' : 'steady',
      current,
      previous: null,
      delta: null,
      summary:
        current == null
          ? ''
          : `Your readiness score is at ${Math.round(current)}. As we keep working, you'll see how it moves over time.`
    };
  }

  const previous = history[0].combined as number;
  const latest = history[history.length - 1].combined as number;
  const delta = Math.round(latest - previous);

  let direction: MomentumDirection = 'steady';
  if (delta >= 3) direction = 'rising';
  else if (delta <= -3) direction = 'cooling';

  let summary: string;
  if (direction === 'rising') {
    summary = `Your readiness score has climbed from ${Math.round(previous)} to ${Math.round(latest)} over your recent activity -- a clear upward trend.`;
  } else if (direction === 'cooling') {
    summary = `Your readiness score has eased from ${Math.round(previous)} to ${Math.round(latest)} recently. A bit of fresh activity will turn it back up.`;
  } else {
    summary = `Your readiness score is holding steady around ${Math.round(latest)}.`;
  }

  return { direction, current: current ?? latest, previous, delta, summary };
}

// ===========================================================================
// PERSIST -- next_best_moves + momentum_signals intelligence_objects
// ===========================================================================

/**
 * UPSERT the two client-guidance objects under the client's tenant. Both are
 * keyed by (tenant_id, lead_id, object_type). When leadId is non-null the unique
 * key uq_tenant_lead_type lets us use INSERT ... ON DUPLICATE KEY UPDATE; when
 * leadId is null MySQL allows multiple NULLs in the unique key, so we
 * SELECT-then-UPDATE/INSERT (constitution section 2 rule). Never throws out.
 */
async function persistGuidance(
  tenantId: string,
  leadId: number | null,
  guidance: ClientGuidance
): Promise<void> {
  const nextBestMoves = {
    composed_at: guidance.composedAt,
    items: guidance.items,
    grounded: guidance.grounded
  };
  const momentumSignals = {
    composed_at: guidance.composedAt,
    ...guidance.momentum
  };
  await upsertGuidanceObject(tenantId, leadId, OBJECT_NEXT_BEST_MOVES, nextBestMoves);
  await upsertGuidanceObject(tenantId, leadId, OBJECT_MOMENTUM_SIGNALS, momentumSignals);
}

async function upsertGuidanceObject(
  tenantId: string,
  leadId: number | null,
  objectType: string,
  payload: unknown
): Promise<void> {
  const db = getAvDb();
  const json = JSON.stringify(payload ?? null);
  try {
    if (leadId != null) {
      await db.execute(
        `INSERT INTO intelligence_objects
           (tenant_id, lead_id, object_type, object_json, source, confidence)
         VALUES (?, ?, ?, CAST(? AS JSON), 'client_guidance', NULL)
         ON DUPLICATE KEY UPDATE
           object_json = VALUES(object_json),
           source = VALUES(source),
           updated_at = NOW()`,
        [tenantId, leadId, objectType, json]
      );
    } else {
      const [rows] = await db.execute<(RowDataPacket & { id: number })[]>(
        `SELECT id FROM intelligence_objects
           WHERE tenant_id = ? AND lead_id IS NULL AND object_type = ?
           LIMIT 1`,
        [tenantId, objectType]
      );
      if (rows[0]?.id) {
        await db.execute(
          `UPDATE intelligence_objects
             SET object_json = CAST(? AS JSON), source = 'client_guidance', updated_at = NOW()
           WHERE id = ?`,
          [json, rows[0].id]
        );
      } else {
        await db.execute(
          `INSERT INTO intelligence_objects
             (tenant_id, lead_id, object_type, object_json, source, confidence)
           VALUES (?, NULL, ?, CAST(? AS JSON), 'client_guidance', NULL)`,
          [tenantId, objectType, json]
        );
      }
    }
  } catch (err) {
    console.error('[client:guidance:persist]', objectType, (err as Error).message);
  }
}

// ===========================================================================
// CACHE read (the warm path the dashboard hits most)
// ===========================================================================

async function readCachedGuidance(tenantId: string): Promise<ClientGuidance | null> {
  const db = getAvDb();
  try {
    const [rows] = await db.execute<CachedObjRow[]>(
      `SELECT object_json, updated_at
         FROM intelligence_objects
        WHERE tenant_id = ? AND object_type = ?
        ORDER BY updated_at DESC
        LIMIT 1`,
      [tenantId, OBJECT_NEXT_BEST_MOVES]
    );
    const row = rows[0];
    if (!row) return null;
    const moves = asObj(row.object_json);
    if (!moves) return null;

    const [mRows] = await db.execute<CachedObjRow[]>(
      `SELECT object_json
         FROM intelligence_objects
        WHERE tenant_id = ? AND object_type = ?
        ORDER BY updated_at DESC
        LIMIT 1`,
      [tenantId, OBJECT_MOMENTUM_SIGNALS]
    );
    const momentumObj = asObj(mRows[0]?.object_json) ?? {};

    const items = Array.isArray((moves as Record<string, unknown>).items)
      ? ((moves as Record<string, unknown>).items as GuidanceItem[])
      : [];
    const composedAt =
      (moves as Record<string, unknown>).composed_at as string ||
      row.updated_at?.toISOString() ||
      new Date().toISOString();

    const momentum: MomentumSignal = {
      direction: ((momentumObj as Record<string, unknown>).direction as MomentumDirection) ?? 'unknown',
      current: numOrNull((momentumObj as Record<string, unknown>).current),
      previous: numOrNull((momentumObj as Record<string, unknown>).previous),
      delta: numOrNull((momentumObj as Record<string, unknown>).delta),
      summary: ((momentumObj as Record<string, unknown>).summary as string) ?? ''
    };

    return {
      tenantId,
      leadId: null, // not needed by the surface; recompose fills it
      items,
      momentum,
      composedAt,
      fromCache: true,
      grounded: Boolean((moves as Record<string, unknown>).grounded) || items.length > 0
    };
  } catch (err) {
    console.error('[client:guidance:cache]', (err as Error).message);
    return null;
  }
}

// ===========================================================================
// Small deterministic helpers
// ===========================================================================

export function clientTenant(clientUserId: number): string {
  return `client:${clientUserId}`;
}

function isStale(composedAtIso: string): boolean {
  const t = Date.parse(composedAtIso);
  if (Number.isNaN(t)) return true;
  return Date.now() - t > GUIDANCE_TTL_MS;
}

function daysUntil(deadline: Date | string | null | undefined): number | null {
  if (!deadline) return null;
  const t = typeof deadline === 'string' ? Date.parse(deadline) : deadline.getTime();
  if (Number.isNaN(t)) return null;
  const ms = t - Date.now();
  if (ms < 0) return null;
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

function decayLine(days: number): string {
  if (days <= 0) return `This window closes today.`;
  if (days === 1) return `This window closes tomorrow.`;
  return `This window closes in ${days} days.`;
}

function parseScoreHistory(v: string | object | null): ScoreHistoryEntry[] {
  if (v == null) return [];
  try {
    const arr = typeof v === 'string' ? JSON.parse(v) : v;
    if (!Array.isArray(arr)) return [];
    return arr.filter((x) => x && typeof x === 'object') as ScoreHistoryEntry[];
  } catch {
    return [];
  }
}

function asObj(v: string | object | null | undefined): Record<string, unknown> | null {
  if (v == null) return null;
  try {
    const o = typeof v === 'string' ? JSON.parse(v) : v;
    return o && typeof o === 'object' ? (o as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Pull a primary topic string from a topic_tags JSON column (array or string). */
function primaryTopic(v: string | object | null): string | null {
  if (v == null) return null;
  try {
    const arr = typeof v === 'string' ? JSON.parse(v) : v;
    if (Array.isArray(arr) && arr.length) {
      const first = arr.find((t) => typeof t === 'string' && t.trim().length > 1);
      return first ? humanize(String(first)) : null;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** The strongest authority-style topic from intelligence_objects, if any. */
function strongestAuthorityTopic(objects: IntelObjRow[]): string | null {
  const candidates = objects.filter((o) =>
    ['authority_topics', 'authority_positioning', 'preferred_narrative_angles', 'media_friendly_topics'].includes(
      o.object_type
    )
  );
  for (const o of candidates) {
    const obj = asObj(o.object_json);
    const label =
      pickString(obj, ['topic', 'theme', 'positioning', 'angle', 'title', 'name', 'label']) ??
      firstArrayString(obj, ['topics', 'themes', 'angles', 'tags']);
    if (label) return humanize(label);
  }
  return null;
}

function bestTopicLabel(objects: IntelObjRow[]): string | null {
  return strongestAuthorityTopic(objects);
}

function topPain(v: string | object | null | undefined): string | null {
  const obj = asObj(v ?? null);
  if (!obj) return null;
  const label =
    pickString(obj, ['primary_pain', 'top_pain', 'headline', 'summary']) ??
    firstArrayString(obj, ['pains', 'pain_points', 'gaps']);
  if (!label) return null;
  return lowerFirst(label.trim().replace(/\.$/, ''));
}

function pickString(obj: Record<string, unknown> | null, keys: string[]): string | null {
  if (!obj) return null;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim().length > 1) return v.trim();
  }
  return null;
}

function firstArrayString(obj: Record<string, unknown> | null, keys: string[]): string | null {
  if (!obj) return null;
  for (const k of keys) {
    const v = obj[k];
    if (Array.isArray(v)) {
      const s = v.find((x) => typeof x === 'string' && x.trim().length > 1);
      if (s) return String(s).trim();
    }
  }
  return null;
}

function extractDateish(obj: Record<string, unknown> | null): string | null {
  if (!obj) return null;
  for (const k of ['deadline', 'ends_at', 'end_date', 'window_end', 'date', 'until']) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

function formatLabelFor(eventType: string): string {
  switch (eventType) {
    case 'social.published':
      return 'Social posts';
    case 'ai.social_content_generated':
      return 'Social content';
    case 'pr.pitch.generated':
      return 'PR / media pitches';
    case 'pr.release.drafted':
      return 'Press releases';
    case 'ai.audit_generated':
      return 'Your strategic audit';
    default:
      return 'Your content';
  }
}

function humanize(s: string): string {
  return s.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function lowerFirst(s: string): string {
  if (!s) return s;
  return s.charAt(0).toLowerCase() + s.slice(1);
}

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
