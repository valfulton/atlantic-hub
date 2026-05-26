/**
 * lib/sales/rep_dashboard.ts
 *
 * Data access for the gamified sales-rep cockpit at /admin/av/employees/me.
 * Everything here is scoped to ONE rep via leads.assigned_to_user_id and
 * call_log.user_id, plus a cross-rep leaderboard so the team competes.
 *
 * Sells across EBW + A&V: leads carry target_business ('av' | 'ebw' | 'both'),
 * and we break the rep's live pipeline down by brand so a rep can see both books.
 *
 * Pipeline $ uses the same weighting as lib/sales/pipeline_value.ts:
 *   per_lead_value = Sprint floor ($1,995) * (score / 100)
 * so a lead's expected value scales with its AI score. Sum over live leads.
 *
 * admin_users + leads + call_log are all reachable on the getAvDb() connection
 * (see lib/employees/store.ts). We deliberately DON'T SQL-join leads to
 * admin_users (they're logically cross-DB); instead we aggregate leads by
 * assigned_to_user_id and map ids to rep names in JS via listEmployees().
 */
import { getAvDb } from '@/lib/db/av';
import { listEmployees } from '@/lib/employees/store';
import type { RowDataPacket } from 'mysql2';

const SPRINT_MONTHLY_USD = 1995;
/** Soft weekly call target for the activity ring. Tune freely — display-only. */
export const WEEKLY_CALL_TARGET = 25;

const LIVE_STATUSES = ['new', 'contacted', 'qualified'] as const;

export type LeadBand = 'hot' | 'warm' | 'cool' | null;
export type TargetBrand = 'av' | 'ebw' | 'both' | 'other';

export interface RepLead {
  id: number;
  auditId: string | null;
  company: string;
  industry: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  leadStatus: string;
  targetBrand: TargetBrand;
  score: number | null;
  band: LeadBand;
  estimatedValueCents: number;
  painSummary: string | null;
  lastActivityAt: string | null;
}

export interface RepStats {
  livePipelineValueCents: number;
  liveLeadCount: number;
  hotLeadCount: number;
  convertedCount: number;
  closedValueCents: number;
  newUncalledCount: number;
  byBrand: { av: number; ebw: number; both: number };
  statusCounts: Record<string, number>;
  callsThisWeek: number;
  connectsThisWeek: number;
  meetingsBookedAllTime: number;
  weeklyCallTarget: number;
  /** Consecutive days (ending today or yesterday) with >=1 logged call. */
  currentStreakDays: number;
  /** Distinct active call days in the trailing 30. */
  activeDaysLast30: number;
  topLead: { auditId: string | null; company: string; estimatedValueCents: number; score: number } | null;
}

export interface LeaderboardEntry {
  userId: number;
  name: string;
  convertedCount: number;
  liveLeadCount: number;
  livePipelineValueCents: number;
  callsThisWeek: number;
  isYou: boolean;
  rank: number;
}

export interface RepDashboard {
  stats: RepStats;
  leads: RepLead[];
  leaderboard: LeaderboardEntry[];
}

interface LeadRow extends RowDataPacket {
  id: number;
  audit_id: string | null;
  company: string | null;
  industry: string | null;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  lead_status: string | null;
  target_business: string | null;
  ai_score: number | null;
  ai_combined_score: number | null;
  ai_score_band: LeadBand;
  pain_point_profile: string | object | null;
  last_activity_at: string | Date | null;
}

function perLeadCents(score: number | null): number {
  if (score === null || score <= 0) return 0;
  const clamped = Math.min(100, Math.max(0, score));
  return Math.round(SPRINT_MONTHLY_USD * 100 * (clamped / 100));
}

function scoreOf(r: { ai_combined_score: number | null; ai_score: number | null }): number | null {
  if (r.ai_combined_score !== null) return Number(r.ai_combined_score);
  if (r.ai_score !== null) return Number(r.ai_score);
  return null;
}

function brandOf(raw: string | null): TargetBrand {
  const v = (raw || '').toLowerCase();
  if (v === 'av' || v === 'ebw' || v === 'both') return v;
  return 'other';
}

function realEmail(e: string | null): string | null {
  if (!e || !e.trim()) return null;
  const v = e.trim();
  if (/^(prospect|apollo|noemail)\+.*@eventsbywater\.com$/i.test(v)) return null;
  if (/^info@eventsbywater\.com$/i.test(v)) return null;
  return v;
}

function painSummaryOf(raw: string | object | null): string | null {
  if (raw == null) return null;
  let obj: Record<string, unknown> | null = null;
  try {
    obj = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object') return null;
  const summary = obj.summary ?? obj.headline ?? obj.primary_pain ?? obj.primary;
  if (typeof summary === 'string' && summary.trim()) return summary.trim();
  const cat = obj.pain_category ?? obj.category;
  if (typeof cat === 'string' && cat.trim()) return cat.trim();
  return null;
}

function toIso(v: string | Date | null): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString();
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Local YYYY-MM-DD for a date, for streak day math. */
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Everything the rep cockpit needs for one rep. Read-only; called from a server
 * component after middleware has authenticated the rep (x-ah-user-id).
 */
export async function getRepDashboard(userId: number): Promise<RepDashboard> {
  const db = getAvDb();
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // 1. This rep's leads (all non-archived, so stats can count converted/lost too).
  const [leadRows] = await db.execute<LeadRow[]>(
    `SELECT id, audit_id, company, industry, contact_name, email, phone, website,
            lead_status, target_business, ai_score, ai_combined_score, ai_score_band,
            pain_point_profile, last_activity_at
       FROM leads
      WHERE archived_at IS NULL AND assigned_to_user_id = ?
      ORDER BY ai_combined_score IS NULL ASC, ai_combined_score DESC,
               last_activity_at DESC, id DESC
      LIMIT 300`,
    [userId]
  );

  const stats: RepStats = {
    livePipelineValueCents: 0,
    liveLeadCount: 0,
    hotLeadCount: 0,
    convertedCount: 0,
    closedValueCents: 0,
    newUncalledCount: 0,
    byBrand: { av: 0, ebw: 0, both: 0 },
    statusCounts: {},
    callsThisWeek: 0,
    connectsThisWeek: 0,
    meetingsBookedAllTime: 0,
    weeklyCallTarget: WEEKLY_CALL_TARGET,
    currentStreakDays: 0,
    activeDaysLast30: 0,
    topLead: null
  };

  const liveLeads: RepLead[] = [];
  for (const r of leadRows) {
    const status = r.lead_status || 'new';
    stats.statusCounts[status] = (stats.statusCounts[status] ?? 0) + 1;
    const score = scoreOf(r);
    const cents = perLeadCents(score);
    const brand = brandOf(r.target_business);

    const lead: RepLead = {
      id: r.id,
      auditId: r.audit_id,
      company: r.company || 'Untitled lead',
      industry: r.industry,
      contactName: r.contact_name && !r.contact_name.trim().startsWith('(') ? r.contact_name : null,
      email: realEmail(r.email),
      phone: r.phone && r.phone.trim() ? r.phone : null,
      website: r.website && r.website.trim() ? r.website : null,
      leadStatus: status,
      targetBrand: brand,
      score,
      band: r.ai_score_band,
      estimatedValueCents: cents,
      painSummary: painSummaryOf(r.pain_point_profile),
      lastActivityAt: toIso(r.last_activity_at)
    };

    if ((LIVE_STATUSES as readonly string[]).includes(status)) {
      stats.liveLeadCount += 1;
      stats.livePipelineValueCents += cents;
      if (r.ai_score_band === 'hot') stats.hotLeadCount += 1;
      if (status === 'new') stats.newUncalledCount += 1;
      if (brand === 'av' || brand === 'ebw' || brand === 'both') stats.byBrand[brand] += 1;
      if (cents > 0 && (!stats.topLead || cents > stats.topLead.estimatedValueCents)) {
        stats.topLead = { auditId: r.audit_id, company: lead.company, estimatedValueCents: cents, score: score ?? 0 };
      }
      liveLeads.push(lead);
    } else if (status === 'converted') {
      stats.convertedCount += 1;
      // A converted lead's "closed value" is the full Sprint floor (one month).
      stats.closedValueCents += SPRINT_MONTHLY_USD * 100;
    }
  }

  // 2. Call activity this week (rep's own calls).
  const [callRows] = await db.execute<(RowDataPacket & { outcome: string; n: number | string })[]>(
    `SELECT outcome, COUNT(*) AS n
       FROM call_log
      WHERE user_id = ? AND called_at >= ?
      GROUP BY outcome`,
    [userId, weekAgo]
  );
  for (const c of callRows) {
    const n = Number(c.n) || 0;
    stats.callsThisWeek += n;
    if (c.outcome === 'connected' || c.outcome === 'meeting_booked' || c.outcome === 'converted') {
      stats.connectsThisWeek += n;
    }
  }

  const [meetingRows] = await db.execute<(RowDataPacket & { n: number | string })[]>(
    `SELECT COUNT(*) AS n FROM call_log WHERE user_id = ? AND outcome = 'meeting_booked'`,
    [userId]
  );
  stats.meetingsBookedAllTime = Number(meetingRows[0]?.n ?? 0);

  // 3. Streak: distinct call days in the trailing 30, plus current consecutive run.
  const [dayRows] = await db.execute<(RowDataPacket & { d: string | Date })[]>(
    `SELECT DISTINCT DATE(called_at) AS d
       FROM call_log
      WHERE user_id = ? AND called_at >= (NOW() - INTERVAL 30 DAY)
      ORDER BY d DESC`,
    [userId]
  );
  const dayKeys = new Set<string>();
  for (const row of dayRows) {
    const d = row.d instanceof Date ? row.d : new Date(row.d);
    if (!Number.isNaN(d.getTime())) dayKeys.add(dayKey(d));
  }
  stats.activeDaysLast30 = dayKeys.size;
  // Current streak: walk back from today (allow today to be empty — count from
  // yesterday so the streak doesn't read 0 before the rep's first call today).
  let streak = 0;
  const cursor = new Date();
  if (!dayKeys.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (dayKeys.has(dayKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  stats.currentStreakDays = streak;

  // 4. Team leaderboard — aggregate leads by rep, map ids to names in JS.
  const leaderboard = await buildLeaderboard(userId, weekAgo);

  return { stats, leads: liveLeads, leaderboard };
}

async function buildLeaderboard(youUserId: number, weekAgo: Date): Promise<LeaderboardEntry[]> {
  const db = getAvDb();

  const [agg] = await db.execute<(RowDataPacket & {
    uid: number;
    converted: number | string;
    live_count: number | string;
    live_score_sum: number | string;
  })[]>(
    `SELECT assigned_to_user_id AS uid,
            SUM(lead_status = 'converted') AS converted,
            SUM(CASE WHEN lead_status IN ('new','contacted','qualified') THEN 1 ELSE 0 END) AS live_count,
            SUM(CASE WHEN lead_status IN ('new','contacted','qualified')
                     THEN COALESCE(ai_combined_score, ai_score, 0) ELSE 0 END) AS live_score_sum
       FROM leads
      WHERE archived_at IS NULL AND assigned_to_user_id IS NOT NULL
      GROUP BY assigned_to_user_id`
  );

  const [callAgg] = await db.execute<(RowDataPacket & { uid: number; n: number | string })[]>(
    `SELECT user_id AS uid, COUNT(*) AS n
       FROM call_log
      WHERE user_id IS NOT NULL AND called_at >= ?
      GROUP BY user_id`,
    [weekAgo]
  );
  const callsByUid = new Map<number, number>();
  for (const c of callAgg) callsByUid.set(Number(c.uid), Number(c.n) || 0);

  const aggByUid = new Map<number, { converted: number; live: number; valueCents: number }>();
  for (const a of agg) {
    aggByUid.set(Number(a.uid), {
      converted: Number(a.converted) || 0,
      live: Number(a.live_count) || 0,
      valueCents: Math.round(SPRINT_MONTHLY_USD * (Number(a.live_score_sum) || 0))
    });
  }

  // Roster of reps (active staff) so even a rep with no leads/calls appears.
  const employees = await listEmployees().catch(() => []);
  const entries: LeaderboardEntry[] = [];
  const seen = new Set<number>();
  for (const e of employees) {
    if (e.is_active !== 1) continue;
    const uid = e.user_id;
    seen.add(uid);
    const a = aggByUid.get(uid);
    entries.push({
      userId: uid,
      name: e.display_name || e.email,
      convertedCount: a?.converted ?? 0,
      liveLeadCount: a?.live ?? 0,
      livePipelineValueCents: a?.valueCents ?? 0,
      callsThisWeek: callsByUid.get(uid) ?? 0,
      isYou: uid === youUserId,
      rank: 0
    });
  }
  // Include the current rep even if they're not in the staff roster (e.g. owner).
  if (!seen.has(youUserId)) {
    const a = aggByUid.get(youUserId);
    entries.push({
      userId: youUserId,
      name: 'You',
      convertedCount: a?.converted ?? 0,
      liveLeadCount: a?.live ?? 0,
      livePipelineValueCents: a?.valueCents ?? 0,
      callsThisWeek: callsByUid.get(youUserId) ?? 0,
      isYou: true,
      rank: 0
    });
  }

  entries.sort(
    (x, y) =>
      y.convertedCount - x.convertedCount ||
      y.livePipelineValueCents - x.livePipelineValueCents ||
      y.callsThisWeek - x.callsThisWeek
  );
  entries.forEach((e, i) => (e.rank = i + 1));
  return entries;
}

export function formatUsd(cents: number): string {
  const dollars = Math.round(cents / 100);
  return dollars.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}
