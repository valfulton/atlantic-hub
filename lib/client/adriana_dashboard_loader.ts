/**
 * AdrianaDashboard loader — assembles the props that AdrianaDashboard.tsx
 * renders, from real Hub state:
 *   - brand_members → brand switcher chips
 *   - watchlistForClient (distress engine) → hero + watchlist cards w/ cascade
 *   - listClientLeads (pipeline) → fresh leads cards
 *
 * Pure read. Safe for /client/dashboard server component.
 */
import { listBrandsForUser } from '@/lib/client/membership';
import { watchlistForClient, type WatchlistRow } from '@/lib/public_intel/distress_engine';
import { listClientLeads, type ClientLead } from '@/lib/client/leads';
import { listEmployeesForClient } from '@/lib/client/employees_on_account';
import { getAvDb } from '@/lib/db/av';
import { getCopyMap } from '@/lib/copy/store';
import { getClientDealModel, leadMonthlyCents } from '@/lib/sales/deal_model';
import type { RowDataPacket } from 'mysql2';
import type { AdrianaDashboardProps, BrandChip, SignalCard, FeaturedSignal, CascadeNode, TeamMember } from '@/app/client/dashboard/AdrianaDashboard';

interface LoaderArgs {
  clientUserId: number;
  /** Active brand (resolved by activeBrandFor upstream). */
  activeClientId: number | null;
  firstName: string;
  brandName: string;             // "Atlantic & Vine" — the operator brand, not the client
  brandPill: string;             // "Client"
}

/** Greeting hour → "morning"/"afternoon"/"evening". UTC-tolerant. */
function greetingTime(now = new Date()): 'morning' | 'afternoon' | 'evening' {
  const h = now.getHours();
  if (h < 12) return 'morning';
  if (h < 18) return 'afternoon';
  return 'evening';
}

/** Two-letter brand initials from a name. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '·';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Human-readable label for a ClassifiedSignal cascade node on the CLIENT side.
 *
 *  val 2026-06-05 (HARD RULE): the client must NEVER see source provider names
 *  (CourtListener / CFPB / UCC / CA SOS / HMDA / PACER / MD Land Rec / etc).
 *  Those identify the data vendor we use, and exposing them makes Atlantic Hub
 *  read as a data reseller instead of a predictive-intelligence engine.
 *  Operator-side surfaces can still see `s.source`; this client-side helper
 *  is locked to the prettified `signalKind` ONLY.
 *
 *  Examples (brand-safe):
 *    bankruptcy_filed → "Bankruptcy Filed"
 *    suspended_entity → "Suspended Entity"
 *    ucc_filing       → "UCC Filing"
 *
 *  Memory: [[feedback_ai_verbiage]] — same instinct, applied to data sources. */
function cascadeNodeLabel(s: { source?: string | null; signalKind: string }): string {
  // Deliberately ignore s.source. Operator views can branch on it; client cannot.
  return s.signalKind
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Map a distress WatchlistRow into the cascade trail + chip our card expects. */
function watchlistRowToCard(row: WatchlistRow): SignalCard {
  const trail = (row.contributingSignals || []).slice(0, 3).map((s, i, arr) => ({
    label: cascadeNodeLabel(s),
    payoff: i === arr.length - 1
  } as CascadeNode));
  // "Freshness" chip — newest signal first.
  const newestAt = row.firstSeenAt;
  const days = Math.floor((Date.now() - newestAt.getTime()) / 86400000);
  const chipLabel =
    days <= 0 ? 'New · filed today' :
    days === 1 ? 'New · filed yesterday' :
    days < 7 ? `New · ${days} days ago` :
    'Distress signal';
  return {
    id: `wl-${row.entityKey}`,
    entityName: row.entityLabel || row.entityKey,
    entityInitial: (row.entityLabel || row.entityKey).trim().charAt(0).toUpperCase() || '·',
    chip: { kind: 'distress', label: chipLabel },
    oneLiner: oneLinerForSignals(row),
    trail,
    primaryAction: {
      label: '✎ Draft outreach',
      href: `/client/watchlist#${encodeURIComponent(row.entityKey)}`
    }
  };
}

/** Heuristic Fraunces one-liner from the strongest contributing signal. */
function oneLinerForSignals(row: WatchlistRow): string {
  const top = row.contributingSignals[0];
  if (!top) return 'A new signal landed on this entity.';
  // ClassifiedSignal no longer carries a `.label` field — derive one from
  // `.source` (preferred — operator trace) falling back to `.signalKind`.
  return `${cascadeNodeLabel(top)}. They don't know we know yet.`;
}

/** Map a client lead row into a fresh-lead SignalCard. */
function leadToCard(l: ClientLead): SignalCard {
  const fit = l.icpFitScore ?? l.score ?? 0;
  const band = l.band ?? null;
  const chipLabel = band
    ? `${fit} fit · ${band}`
    : l.icpFitScore != null
      ? `${l.icpFitScore} fit`
      : 'New lead';
  const trail: CascadeNode[] = [];
  if (l.contactName) trail.push({ label: l.contactTitle ? `${l.contactTitle} found` : 'Contact found' });
  if (l.email) trail.push({ label: 'Email verified' });
  if (l.callScript?.primaryPain) trail.push({ label: 'Pain extracted', payoff: true });
  else if (trail.length > 0) trail[trail.length - 1].payoff = true;
  return {
    id: `ld-${l.id}`,
    entityName: l.company,
    entityInitial: l.company.trim().charAt(0).toUpperCase() || '·',
    chip: { kind: 'fit', label: chipLabel },
    oneLiner: l.painSummary || l.icpFitReasoning || 'Enriched and ready for outreach.',
    trail: trail.length > 0 ? trail : [{ label: 'Scored', payoff: true }],
    primaryAction: {
      label: l.phone ? '📞 Call now' : l.email ? '✎ Review & send' : '✚ Add to pipeline',
      href: l.auditId ? `/client/leads/${l.auditId}` : '/client/leads'
    },
    // Carry the contact facts onto the card — phone + address must always show
    // when present (val 2026-06-05; the cream card layout had been dropping them).
    contact: {
      phone: l.phone,
      email: l.email,
      website: l.website,
      address: [l.addressStreet, l.addressCity, l.addressState, l.addressPostal].filter(Boolean).join(', ') || null
    }
  };
}

/** (val 2026-06-06, SPEC §1) "This week" counts scoped to the active brand
 *  over the trailing 7 days. Every query soft-fails to 0 so a missing table
 *  never breaks the dashboard. The hero hides any clause whose count is 0.
 *  Order — leads first (the headline), then approval queue, press, calls. */
async function loadThisWeekCounts(clientId: number): Promise<{
  leadsAdded: number;
  postsAwaitingApproval: number;
  pressMatches: number;
  callsLogged: number;
}> {
  const pool = getAvDb();
  type Cnt = RowDataPacket & { n: number };
  const day7 = `DATE_SUB(NOW(), INTERVAL 7 DAY)`;
  const safe = async (sql: string, params: unknown[]): Promise<number> => {
    try {
      const [rows] = await pool.execute<Cnt[]>(sql, params);
      return Number(rows[0]?.n ?? 0);
    } catch {
      return 0;
    }
  };
  const [leadsAdded, postsAwaitingApproval, pressMatches, callsLogged] = await Promise.all([
    safe(
      `SELECT COUNT(*) AS n FROM leads
        WHERE client_id = ? AND archived_at IS NULL AND created_at >= ${day7}`,
      [clientId]
    ),
    // Social outbox queued and awaiting client approval. Real table is
    // social_outbox; client_approval IS NULL = pending; client_approval = false
    // = rejected; true = approved. Pending = "needs your attention" recap clause.
    safe(
      `SELECT COUNT(*) AS n FROM social_outbox
        WHERE client_id = ? AND client_approval IS NULL`,
      [clientId]
    ),
    safe(
      `SELECT COUNT(*) AS n FROM pr_opportunities
        WHERE client_id = ? AND created_at >= ${day7}`,
      [clientId]
    ),
    safe(
      `SELECT COUNT(*) AS n FROM call_log
        WHERE client_id = ? AND created_at >= ${day7}`,
      [clientId]
    )
  ]);
  return { leadsAdded, postsAwaitingApproval, pressMatches, callsLogged };
}

/** (val 2026-06-06, SPEC §1) Sum the monthly forecast across the client's
 *  open pipeline using their real deal model (`per_head` or `flat`, stored on
 *  the clients row). Returns USD whole dollars, or null when the client has
 *  no deal_model set — the hero treats null as "hide the $ line." Never
 *  fabricates a number; this is a real forecast or nothing. */
async function computePipelinePotentialUsd(clientId: number): Promise<number | null> {
  try {
    const model = await getClientDealModel(clientId);
    if (!model) return null;
    const db = getAvDb();
    type Row = RowDataPacket & {
      deal_unit_count: number | null;
      deal_flat_cents: number | null;
    };
    const [rows] = await db.execute<Row[]>(
      `SELECT deal_unit_count, deal_flat_cents FROM leads
        WHERE client_id = ?
          AND archived_at IS NULL
          AND lead_status IN ('new','qualifying','audited','enriched','contacted','engaged','proposal')`,
      [clientId]
    );
    let totalCents = 0;
    let anyValued = false;
    for (const r of rows) {
      const cents = leadMonthlyCents(model, {
        dealUnitCount: r.deal_unit_count == null ? null : Number(r.deal_unit_count),
        dealFlatCents: r.deal_flat_cents == null ? null : Number(r.deal_flat_cents)
      });
      if (cents != null) {
        totalCents += cents;
        anyValued = true;
      }
    }
    if (!anyValued) return null;
    return Math.round(totalCents / 100);
  } catch {
    return null;
  }
}

/** Count of active narrative lines for the client (for the "12 active" chip).
 *  Returns 0 on schema mismatch — degrades silently. */
async function countActiveCampaigns(clientId: number): Promise<number> {
  try {
    const pool = getAvDb();
    type Row = RowDataPacket & { n: number };
    const [rows] = await pool.execute<Row[]>(
      `SELECT COUNT(*) AS n FROM narrative_lanes
        WHERE client_id = ? AND state IN ('active', 'reinforcing')`,
      [clientId]
    );
    return Number(rows[0]?.n ?? 0);
  } catch {
    return 0;
  }
}

/** Resolve the client_name for a given client_id (used in chip labels). */
async function clientNameOf(clientId: number): Promise<string | null> {
  try {
    const pool = getAvDb();
    type Row = RowDataPacket & { client_name: string };
    const [rows] = await pool.execute<Row[]>(
      `SELECT client_name FROM clients WHERE client_id = ? LIMIT 1`,
      [clientId]
    );
    return rows[0]?.client_name ?? null;
  } catch {
    return null;
  }
}

/** (#406) Operator-set nickname for a client. Best-effort: returns null if
 *  schema 073 hasn't been applied yet OR if val hasn't set one. Callers fall
 *  back to initialsOf(clientName) when this returns null. */
async function clientShortNameOf(clientId: number): Promise<string | null> {
  try {
    const db = getAvDb();
    const [rows] = await db.execute<(RowDataPacket & { short_name: string | null })[]>(
      `SELECT short_name FROM clients WHERE client_id = ? LIMIT 1`,
      [clientId]
    );
    const s = rows[0]?.short_name;
    return typeof s === 'string' && s.trim() ? s.trim() : null;
  } catch {
    return null;
  }
}

export async function loadAdrianaDashboard(args: LoaderArgs): Promise<AdrianaDashboardProps> {
  const { clientUserId, activeClientId, firstName, brandName, brandPill } = args;

  // Brands the user is a member of → switcher chips.
  let brands: BrandChip[] = [];
  try {
    const memberships = await listBrandsForUser(clientUserId);
    brands = memberships.map((m) => ({
      id: m.clientId,
      name: m.clientName || `Brand ${m.clientId}`,
      initials: initialsOf(m.clientName || `B${m.clientId}`),
      href: `/client/dashboard?brand=${m.clientId}`,
      active: m.clientId === activeClientId
    }));
  } catch {
    brands = [];
  }

  // Watchlist for the active brand → hero + 4 cards.
  let watchlistRows: WatchlistRow[] = [];
  let activeClientName: string | null = null;
  let activeClientShortName: string | null = null;
  let activeCampaignCount = 0;
  // (#377) AV employees on this client — Adriana sees Rebecca; Tim sees nothing.
  // Lib already returns [] on error, so this never breaks the dashboard.
  let team: TeamMember[] = [];
  if (activeClientId) {
    [watchlistRows, activeClientName, activeClientShortName, activeCampaignCount, team] = await Promise.all([
      watchlistForClient(activeClientId, 8).catch(() => []),
      clientNameOf(activeClientId),
      clientShortNameOf(activeClientId),
      countActiveCampaigns(activeClientId),
      listEmployeesForClient(activeClientId).catch(() => [] as TeamMember[])
    ]);
  }

  // Hero — top entity from the watchlist (cascade attribution drives the trail).
  let hero: FeaturedSignal | null = null;
  if (watchlistRows.length > 0) {
    const top = watchlistRows[0];
    const trailHero = (top.contributingSignals || []).slice(0, 3).map((s, i, arr) => ({
      label: cascadeNodeLabel(s),
      payoff: i === arr.length - 1
    }));
    hero = {
      eyebrow: '✦ This week’s strongest signal',
      headline: `${top.entityLabel || top.entityKey} just surfaced.`,
      headlineAccent: 'They don’t know we know.',
      // (#406) Prefer val's nickname (short_name); fall back to computed initials.
      who: `${top.entityLabel || top.entityKey} · flagged on your ${activeClientShortName || (activeClientName ? activeClientName.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() : 'channel')} watchlist`,
      trail: trailHero,
      ctaLabel: 'Open the signal →',
      ctaHref: `/client/watchlist#${encodeURIComponent(top.entityKey)}`
    };
  }

  const watchlistCards = watchlistRows.slice(0, 4).map(watchlistRowToCard);

  // Fresh leads — top 4 most-recent leads in the user's pipeline.
  // Also feeds the outcome hero (pipeline buckets + potential $).
  let leadCards: SignalCard[] = [];
  let allLeads: ClientLead[] = [];
  try {
    allLeads = await listClientLeads({ client_id: activeClientId });
    leadCards = allLeads.slice(0, 4).map(leadToCard);
  } catch {
    leadCards = [];
    allLeads = [];
  }

  // (SPEC §1) Pipeline bucket counts + potential $. "Open" = not lost/won/dead.
  const OPEN_STATUSES = new Set<string>(['new', 'qualifying', 'audited', 'enriched', 'contacted', 'engaged', 'proposal']);
  const openLeads = allLeads.filter((l) => OPEN_STATUSES.has(l.leadStatus));
  const pipeline = {
    total: openLeads.length,
    hot: openLeads.filter((l) => l.band === 'hot').length,
    warm: openLeads.filter((l) => l.band === 'warm').length,
    cool: openLeads.filter((l) => l.band === 'cool').length
  };
  let potentialUsd: number | null = null;
  if (activeClientId && pipeline.total > 0) {
    potentialUsd = await computePipelinePotentialUsd(activeClientId);
  }
  const thisWeek = activeClientId
    ? await loadThisWeekCounts(activeClientId)
    : { leadsAdded: 0, postsAwaitingApproval: 0, pressMatches: 0, callsLogged: 0 };

  const newCount = watchlistRows.filter((r) => {
    const ageHours = (Date.now() - r.firstSeenAt.getTime()) / 3600000;
    return ageHours <= 36;
  }).length;
  const subhead =
    newCount > 0
      ? `${newCount} new ${newCount === 1 ? 'signal' : 'signals'} on your watchlist since yesterday. Here’s what’s worth a move.`
      : 'Quiet on the wire. New signals will appear here as they’re scored.';

  // (#406) Short_name wins, else computed initials. The label still gets a
  // period for visual symmetry with "Atlantic & Vine." across the chrome.
  const activeBrandShort = activeClientShortName || (activeClientName ? initialsOf(activeClientName) : '');
  const activeCountLabel = activeBrandShort
    ? `${activeBrandShort} · ${activeCampaignCount} active`
    : `${activeCampaignCount} active`;

  // Per-client editable section copy (edit in /admin/av/copy). Covers the
  // operator mirror too, since both call this loader.
  const copy = await getCopyMap(
    ['dashboard.sec.watchlist', 'dashboard.sec.leads', 'dashboard.empty'],
    { clientId: activeClientId ?? undefined }
  );

  return {
    brandName,
    brandPill,
    firstName,
    userInitial: firstName.trim().charAt(0).toUpperCase() || '·',
    greetingTime: greetingTime(),
    subhead,
    copy,
    brands,
    team,
    // (SPEC §1) Outcome-hero payload — pipeline buckets, forecast potential,
    // and the "this week" recap counts. Hero hides zero clauses.
    pipeline,
    potentialUsd,
    thisWeek,
    hero,
    watchlist: {
      activeCountLabel,
      moreHref: '/client/watchlist',
      cards: watchlistCards
    },
    freshLeads: {
      sublabel: 'enriched today',
      moreHref: '/client/leads',
      cards: leadCards
    }
  };
}
