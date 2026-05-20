/**
 * lib/ai/engagement_score.ts
 *
 * The "Living Score" engine. Every interesting system_event nudges a
 * lead's ai_engagement_score up or down. The combined ai_combined_score
 * is what we display on the dashboard, so the dashboard moves with real
 * world signal (open, click, reply, bounce, unsubscribe, commercial
 * generation, audit refill) instead of sitting frozen at the moment of
 * first AI scoring.
 *
 * Design contract:
 *   - applyEngagementSignal never throws. Errors are logged to console.
 *     Engagement signaling must never break the calling code path.
 *   - Unknown event types are silently ignored. New sessions can emit
 *     new event types without coordinating with us.
 *   - Each call appends one entry to score_history JSON, capped at 50.
 *   - ai_combined_score is recomputed and persisted on every call so the
 *     leads list can sort + index on it.
 *
 * Wired in from lib/events/log.ts (fire and forget after each insert).
 * Also callable directly from email outreach reply-classifier, Grok
 * commercial generator, etc, with a synthetic event type if needed.
 */

import { getAvDb } from '@/lib/db/av';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

// ─── Event weight table ──────────────────────────────────────────────
// Positive numbers nudge the engagement score up. Negative pulls down.
// Tuning principle: a single positive reply should move the visible
// combined score by roughly one full band (e.g. warm to hot).
// Anything not listed here has zero effect.
const EVENT_WEIGHTS: Record<string, number> = {
  // ── operator interest signals (we are working this lead) ──
  'ai.audit_generated': 0,            // already part of fit score
  'ai.lead_scored': 0,                // same
  'ai.social_content_generated': 2,   // operator drafted content for them
  'ai.commercial_generated': 3,       // operator generated a Grok commercial
  'lead.enriched': 3,                 // Hunter found a real contact

  // ── outreach lifecycle (drives most movement once email is wired) ──
  'outreach.message_drafted': 1,
  'outreach.message_sent': 2,
  'outreach.message_opened': 5,
  'outreach.message_clicked': 8,
  'outreach.message_bounced': -20,
  'outreach.reply_received': 10,      // any reply is meaningful
  'outreach.reply_positive': 25,
  'outreach.reply_interested': 15,
  'outreach.reply_neutral': 0,
  'outreach.reply_negative': -5,
  'outreach.reply_unsubscribed': -50,
  'outreach.reply_autoresponder': 0,

  // ── social signals (lights up once social posting ships) ──
  'social.post_published_for_lead': 2,
  'social.engagement_received': 4,    // reaction / comment from prospect

  // ── client portal signals (once portal traffic flows) ──
  'client.audit_viewed': 8,           // they came back to read the audit
  'client.dashboard_login': 5,
  'client.upgrade_clicked': 18,       // intent to convert

  // ── manual operator notes ──
  'lead.note_added': 1,
  'lead.stage_advanced': 6,           // ops bumped to qualified
  'lead.stage_converted': 30,         // ops marked converted -- locks score high
  'lead.archived': -100,              // operator killed it -- floor it

  // ── call activity (logged from the Calls tab in the lead detail) ──
  'lead.call_logged': 1,              // generic call attempt
  'lead.call_connected': 4,           // actually got the prospect on the phone
  'lead.call_meeting_booked': 12,     // strongest in-pipeline signal
  'lead.call_follow_up': 2,           // they want to talk again
  'lead.call_not_interested': -3,

  // ── lifecycle (mostly informational; the real movement is on the
  //    parent .stage_advanced / .stage_converted events) ──
  'lead.lifecycle.nurture': 0,
  'lead.lifecycle.not_now': 0,
  'lead.lifecycle.referred': 0,
  'lead.lifecycle.case_study': 4,     // converted + reusable -- nudge up
  'lead.lifecycle.woken_by_date': 2,  // date-based wake -- mild bump
  'lead.lifecycle.woken_by_behavior': 5,

  // ── sales workflow ──
  'lead.handed_to_owner': 8,          // rep escalated to Val for warm-email close
  'lead.assignment_changed': 0
};

const HISTORY_CAP = 50;

interface LeadRow extends RowDataPacket {
  id: number;
  ai_score: number | null;
  ai_engagement_score: number;
  score_history: string | object | null;
}

interface HistoryEntry {
  at: string;             // ISO timestamp
  event_type: string;
  delta: number;          // how much engagement moved on this event
  fit: number | null;     // ai_score at the time
  engagement: number;     // ai_engagement_score AFTER this delta applied
  combined: number;       // ai_combined_score AFTER this delta applied
  note?: string;          // optional human-readable annotation
}

/**
 * Combine the fit score (set by the AI scorer) with the engagement delta.
 * Currently a clamped sum. Tuning: engagement is full-weight against fit
 * because we want real signal to overwhelm a stale fit estimate quickly.
 */
export function computeCombinedScore(
  fit: number | null,
  engagement: number
): number | null {
  if (fit === null || fit === undefined) return null;
  const raw = fit + engagement;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

/**
 * Apply one engagement signal to a lead. Updates ai_engagement_score,
 * ai_combined_score, score_history, engagement_score_updated_at. Never
 * throws. Returns the new combined score on success, or null on no-op /
 * error.
 */
export async function applyEngagementSignal(opts: {
  leadId: number;
  eventType: string;
  note?: string;
}): Promise<number | null> {
  const weight = EVENT_WEIGHTS[opts.eventType];
  if (weight === undefined || weight === 0) {
    // Unknown or zero-weight event -- nothing to do, this is fine.
    return null;
  }

  try {
    const db = getAvDb();
    const [rows] = await db.execute<LeadRow[]>(
      `SELECT id, ai_score, ai_engagement_score, score_history
         FROM leads
        WHERE id = ?
          AND archived_at IS NULL
        LIMIT 1`,
      [opts.leadId]
    );
    if (rows.length === 0) return null;
    const row = rows[0];

    const newEngagement = (row.ai_engagement_score ?? 0) + weight;
    const newCombined = computeCombinedScore(row.ai_score, newEngagement);

    const history = parseHistory(row.score_history);
    history.unshift({
      at: new Date().toISOString(),
      event_type: opts.eventType,
      delta: weight,
      fit: row.ai_score,
      engagement: newEngagement,
      combined: newCombined ?? 0,
      ...(opts.note ? { note: opts.note.slice(0, 240) } : {})
    });
    while (history.length > HISTORY_CAP) history.pop();

    await db.execute<ResultSetHeader>(
      `UPDATE leads
          SET ai_engagement_score = ?,
              ai_combined_score = ?,
              score_history = ?,
              engagement_score_updated_at = NOW(),
              last_activity_at = NOW()
        WHERE id = ?`,
      [
        newEngagement,
        newCombined,
        JSON.stringify(history),
        opts.leadId
      ]
    );

    return newCombined;
  } catch (err) {
    // Never propagate. Engagement scoring is best-effort by design.
    console.error(
      '[engagement-score]',
      opts.leadId,
      opts.eventType,
      (err as Error).message
    );
    return null;
  }
}

/**
 * Fire-and-forget wrapper for callers who do not want to await. The
 * promise is intentionally swallowed; failures are visible in the
 * Netlify function log only.
 */
export function applyEngagementSignalBackground(opts: {
  leadId: number;
  eventType: string;
  note?: string;
}): void {
  applyEngagementSignal(opts).catch((err) => {
    console.error('[engagement-score:bg]', opts.leadId, (err as Error).message);
  });
}

/**
 * Helper used by surfaces that want to recompute the combined score
 * without firing a signal -- for example after a Re-score that changed
 * ai_score, we want ai_combined_score to refresh against the new fit.
 */
export async function recomputeCombinedForLead(leadId: number): Promise<void> {
  try {
    const db = getAvDb();
    const [rows] = await db.execute<LeadRow[]>(
      `SELECT id, ai_score, ai_engagement_score, score_history
         FROM leads
        WHERE id = ? AND archived_at IS NULL
        LIMIT 1`,
      [leadId]
    );
    if (rows.length === 0) return;
    const row = rows[0];
    const combined = computeCombinedScore(row.ai_score, row.ai_engagement_score ?? 0);
    await db.execute<ResultSetHeader>(
      `UPDATE leads SET ai_combined_score = ? WHERE id = ?`,
      [combined, leadId]
    );
  } catch (err) {
    console.error('[engagement-score:recompute]', leadId, (err as Error).message);
  }
}

function parseHistory(raw: string | object | null): HistoryEntry[] {
  if (!raw) return [];
  if (typeof raw === 'object') return raw as HistoryEntry[];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Exposed for the UI sparkline. Returns the score_history JSON parsed
 * for a single lead.
 */
export async function readScoreHistory(leadId: number): Promise<HistoryEntry[]> {
  try {
    const db = getAvDb();
    const [rows] = await db.execute<(RowDataPacket & { score_history: string | object | null })[]>(
      `SELECT score_history FROM leads WHERE id = ? LIMIT 1`,
      [leadId]
    );
    if (rows.length === 0) return [];
    return parseHistory(rows[0].score_history);
  } catch {
    return [];
  }
}
