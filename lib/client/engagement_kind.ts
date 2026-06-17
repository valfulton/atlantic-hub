/**
 * lib/client/engagement_kind.ts
 *
 * The single source of truth for what each ENGAGEMENT KIND enables across the
 * Hub. Kind belongs to the engagement (a brand_members row, #101), NOT to the
 * client — one person/brand can carry several engagements of different kinds
 * over time (Ron: Defense PR -> Practice Marketing; John White: Campaign +
 * Compass). See schema/085_engagement_kind.sql.
 *
 * ENGAGEMENT_KIND_CONFIG drives: the dashboard hero phrase, the "Your
 * Pipeline" equivalent label, which panels mount, which welcome-popover copy
 * keys feed the modal, and (via kinds?: on intake fields) which intake
 * questions are asked.
 *
 * getEngagementKind() reads brand_members.engagement_kind for the ACTIVE
 * engagement and never throws — it degrades to 'lead_gen' (the column default
 * and today's behavior) on any miss. The #550 cockpit's inferClientKind()
 * remains the separate fallback for brands with no brand_members row yet.
 */
import { getAvDb } from '@/lib/db/av';
import type { RowDataPacket } from 'mysql2';

export type EngagementKind =
  | 'lead_gen'
  | 'defense_pr'
  | 'political_campaign'
  | 'luxury_hospitality'
  | 'book_pr';

/** The enum values, in schema order. */
export const ENGAGEMENT_KINDS: EngagementKind[] = [
  'lead_gen',
  'defense_pr',
  'political_campaign',
  'luxury_hospitality',
  'book_pr'
];

export function isEngagementKind(v: unknown): v is EngagementKind {
  return typeof v === 'string' && (ENGAGEMENT_KINDS as string[]).includes(v);
}

export interface EngagementKindConfig {
  /** Dashboard hero phrase. */
  heroLabel: string;
  /** The "Your Pipeline" equivalent label. */
  pipelineLabel: string;
  showLeadsPanel: boolean;
  showWatchlistPanel: boolean;
  /** NEW panel — count of journalist outreach. */
  showPressTouchesPanel: boolean;
  /** NEW panel — defense_pr only. */
  showCaseBriefPanel: boolean;
  /** NEW panel — political_campaign only. */
  showDistrictHeatMap: boolean;
  /** NEW panel — luxury_hospitality only. */
  showItineraryPanel: boolean;
  /** Which site_copy keys feed the welcome modal (resolved per active engagement). */
  welcomePopoverKeys: string[];
}

export const ENGAGEMENT_KIND_CONFIG: Record<EngagementKind, EngagementKindConfig> = {
  lead_gen: {
    heroLabel: 'Who is about to need you',
    pipelineLabel: 'Prospects, scored for fit',
    showLeadsPanel: true,
    showWatchlistPanel: true,
    showPressTouchesPanel: false,
    showCaseBriefPanel: false,
    showDistrictHeatMap: false,
    showItineraryPanel: false,
    welcomePopoverKeys: ['welcome.lead_gen.s1', 'welcome.lead_gen.s2', 'welcome.lead_gen.s3']
  },
  defense_pr: {
    heroLabel: 'Your case has a story. Here is the desk that tells it.',
    pipelineLabel: 'Press touches this week',
    showLeadsPanel: false,
    showWatchlistPanel: false,
    showPressTouchesPanel: true,
    showCaseBriefPanel: true,
    showDistrictHeatMap: false,
    showItineraryPanel: false,
    welcomePopoverKeys: ['welcome.defense_pr.s1', 'welcome.defense_pr.s2', 'welcome.defense_pr.s3']
  },
  political_campaign: {
    heroLabel: 'Your district. Your message. Your green-light.',
    // (val 2026-06-17, UX/UI Phase 1) Engine-vocab purge — "Narrative lines"
    // is the operator-side term for the spine. A candidate thinks in stops
    // and stories, not narrative lines. The race tracker hero will replace
    // this sub-line in Phase 2; until then, keep it candidate-voiced.
    pipelineLabel: 'Where the story is this week',
    showLeadsPanel: false,
    showWatchlistPanel: true, // distress signals as district pulse
    showPressTouchesPanel: true,
    showCaseBriefPanel: false,
    showDistrictHeatMap: true,
    // (val 2026-06-17, UX/UI Phase 1) Itinerary re-enabled for political —
    // candidates live in the rhythm of stops (rallies, town halls, debates,
    // fundraisers). The hospitality copy is replaced per-kind inside
    // ItineraryPanel; the schema (port/arrival/departure) is reused as
    // (location/date/dateEnd) until kind-aware intake (#554) ships richer
    // fields.
    showItineraryPanel: true,
    welcomePopoverKeys: ['welcome.political.s1', 'welcome.political.s2', 'welcome.political.s3']
  },
  luxury_hospitality: {
    heroLabel: 'Each port is a chapter.',
    pipelineLabel: 'Stories from the next stop',
    showLeadsPanel: false,
    showWatchlistPanel: false,
    showPressTouchesPanel: true,
    showCaseBriefPanel: false,
    showDistrictHeatMap: false,
    showItineraryPanel: true,
    welcomePopoverKeys: ['welcome.hospitality.s1', 'welcome.hospitality.s2', 'welcome.hospitality.s3']
  },
  book_pr: {
    heroLabel: 'Your book has a story arc. Here is your launch.',
    pipelineLabel: 'Media wins for the launch',
    showLeadsPanel: false,
    showWatchlistPanel: false,
    showPressTouchesPanel: true,
    showCaseBriefPanel: false,
    showDistrictHeatMap: false,
    showItineraryPanel: false,
    welcomePopoverKeys: ['welcome.book_pr.s1', 'welcome.book_pr.s2', 'welcome.book_pr.s3']
  }
};

/** Convenience: the config for a kind (always defined; defaults to lead_gen). */
export function configForKind(kind: EngagementKind): EngagementKindConfig {
  return ENGAGEMENT_KIND_CONFIG[kind] ?? ENGAGEMENT_KIND_CONFIG.lead_gen;
}

/**
 * The engagement kind for the ACTIVE engagement.
 *
 * - Live client path: pass clientUserId + the active brand clientId — resolves
 *   that person's membership row for that brand.
 * - Operator-preview / brand-scoped path: pass clientId only — resolves any
 *   member's kind for the brand (all members of a brand share its kind).
 *
 * Returns 'lead_gen' on any miss (no row, NULL, unknown value, or DB error) so
 * existing surfaces never change behavior and the function never throws.
 */
export async function getEngagementKind(args: {
  clientId: number | null;
  clientUserId?: number | null;
}): Promise<EngagementKind> {
  const { clientId, clientUserId } = args;
  if (!Number.isInteger(clientId) || (clientId as number) <= 0) return 'lead_gen';
  try {
    const db = getAvDb();
    if (clientUserId != null && Number.isInteger(clientUserId) && clientUserId > 0) {
      const [rows] = await db.execute<(RowDataPacket & { engagement_kind: string })[]>(
        `SELECT engagement_kind FROM brand_members
          WHERE client_user_id = ? AND client_id = ? LIMIT 1`,
        [clientUserId, clientId]
      );
      const k = rows[0]?.engagement_kind;
      if (isEngagementKind(k)) return k;
      // person has no membership row for this brand — fall through to brand-level
    }
    // Brand-level resolution: prefer the owner's row, else any member.
    const [rows] = await db.execute<(RowDataPacket & { engagement_kind: string })[]>(
      `SELECT engagement_kind FROM brand_members
        WHERE client_id = ?
        ORDER BY FIELD(role,'owner','rep','viewer') LIMIT 1`,
      [clientId]
    );
    const k = rows[0]?.engagement_kind;
    return isEngagementKind(k) ? k : 'lead_gen';
  } catch (err) {
    console.error('[engagement_kind:getEngagementKind]', (err as Error).message);
    return 'lead_gen';
  }
}
