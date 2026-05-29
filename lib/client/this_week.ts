/**
 * lib/client/this_week.ts  (#242 / #216 v0)
 *
 * Data builder for the client-side "this week" activity feed. Reads
 * system_events for the last 7 days, scoped to events that are about THIS
 * client's account or a lead they own. Aggregates into a few client-friendly
 * sentences ("5 new leads found", "3 hot fits worth your call", "audit
 * refreshed after intake update", etc.) — NOT a raw event log.
 *
 * Symmetric with the operator-side AutopilotActivity widget (#241), but
 * tuned for what the CLIENT cares about (not the internals).
 *
 * Returns an empty/null result for clients with no activity yet so the
 * widget hides itself on Day 1.
 */
import { getAvDb } from '@/lib/db/av';
import type { RowDataPacket } from 'mysql2';

export interface ThisWeekItem {
  /** Stable sort key (newest first). */
  at: string;
  /** Short rendered headline (client voice). */
  text: string;
  /** Tone for the visual treatment. */
  tone: 'good' | 'info' | 'urgent';
  /** Optional href the headline links to (e.g. /client/leads, /client/pr). */
  href?: string;
}

export interface ThisWeekSummary {
  items: ThisWeekItem[];
  /** Friendly window label, e.g. "Last 7 days". */
  windowLabel: string;
}

const WINDOW_DAYS = 7;

interface EventRow extends RowDataPacket {
  event_type: string;
  payload: string | object | null;
  created_at: string | Date;
  lead_id: number | null;
}

function safePayload(raw: unknown): Record<string, unknown> {
  if (raw == null) return {};
  if (typeof raw === 'object') return raw as Record<string, unknown>;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) as Record<string, unknown>; } catch { return {}; }
  }
  return {};
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Build the "this week" summary for a client.
 *
 * Categories (in priority order):
 *   1. Press opportunities matched — high visibility, high client interest
 *   2. New hot fits (≥85) — actionable, deserves a call this week
 *   3. New leads count (last 7d) — pipeline growth signal
 *   4. Audit refreshed (autopilot) — system kept up with the brief
 *   5. ICP sharpened (autopilot) — system understood new intake
 *
 * Each renders as a single line so the panel stays under ~5 rows on
 * dashboards with lots happening.
 */
export async function fetchClientThisWeek(clientId: number): Promise<ThisWeekSummary> {
  const items: ThisWeekItem[] = [];
  const db = getAvDb();

  // Single query for events about this client's organization OR about leads
  // they own. organization_id == client_id on system_events; leads carry
  // client_id directly.
  let rows: EventRow[] = [];
  try {
    const [r] = await db.execute<EventRow[]>(
      `SELECT event_type, payload, created_at, lead_id
         FROM system_events
        WHERE created_at > DATE_SUB(NOW(), INTERVAL ? DAY)
          AND (
                organization_id = ?
             OR lead_id IN (SELECT id FROM leads WHERE client_id = ? AND archived_at IS NULL)
              )
        ORDER BY created_at DESC
        LIMIT 500`,
      [WINDOW_DAYS, clientId, clientId]
    );
    rows = r;
  } catch {
    return { items: [], windowLabel: `Last ${WINDOW_DAYS} days` };
  }

  // --- 1. Press opportunities matched ---
  const prMatches = rows.filter((r) => r.event_type === 'pr.ingest.parsed' || r.event_type === 'pr.opportunity.parsed');
  if (prMatches.length > 0) {
    const latest = prMatches[0];
    items.push({
      at: String(latest.created_at),
      tone: 'good',
      text:
        prMatches.length === 1
          ? `A press opportunity matched to your story.`
          : `${prMatches.length} press opportunities matched to your story.`,
      href: '/client/pr'
    });
  }

  // --- 2. New hot fits (≥85) ---
  // lead.icp_fit.scored event carries the score in its payload.
  let hotFits = 0;
  let latestHotFitAt: string | null = null;
  for (const r of rows) {
    if (r.event_type !== 'lead.icp_fit.scored') continue;
    const p = safePayload(r.payload);
    const score = num(p.score);
    if (score >= 85) {
      hotFits += 1;
      if (!latestHotFitAt) latestHotFitAt = String(r.created_at);
    }
  }
  if (hotFits > 0 && latestHotFitAt) {
    items.push({
      at: latestHotFitAt,
      tone: 'urgent',
      text:
        hotFits === 1
          ? `1 strong-fit lead worth your call this week.`
          : `${hotFits} strong-fit leads worth your call this week.`,
      href: '/client/leads'
    });
  }

  // --- 3. New leads count ---
  // Multiple discovery sources fire "lead.created" or "lead.bulk_*"; we count
  // anything that increases the pipeline. To stay accurate, we cross-check
  // against the lead table for this client's leads created in the window.
  try {
    const [leadRows] = await db.execute<(RowDataPacket & { c: number; latest: string | Date | null })[]>(
      `SELECT COUNT(*) AS c, MAX(submission_date) AS latest
         FROM leads
        WHERE client_id = ? AND archived_at IS NULL
          AND submission_date > DATE_SUB(NOW(), INTERVAL ? DAY)`,
      [clientId, WINDOW_DAYS]
    );
    const newLeadCount = num(leadRows[0]?.c);
    const latest = leadRows[0]?.latest;
    if (newLeadCount > 0 && latest) {
      items.push({
        at: String(latest),
        tone: 'info',
        text:
          newLeadCount === 1
            ? `1 new prospect added to your pipeline.`
            : `${newLeadCount} new prospects added to your pipeline.`,
        href: '/client/leads'
      });
    }
  } catch { /* non-fatal */ }

  // --- 4. Audit refreshed (autopilot caught up after a brief edit) ---
  const auditRegen = rows.find((r) => r.event_type === 'autopilot.audit_regen_completed');
  if (auditRegen) {
    const p = safePayload(auditRegen.payload);
    const r = num(p.regenerated);
    if (r > 0) {
      items.push({
        at: String(auditRegen.created_at),
        tone: 'info',
        text:
          r === 1
            ? `Your audit was refreshed to reflect the latest brief.`
            : `${r} of your lead audits were refreshed to match the latest brief.`
      });
    }
  }

  // --- 5. ICP sharpened (system absorbed your latest intake answers) ---
  const icpSharpened = rows.find((r) => r.event_type === 'autopilot.icp_sharpened');
  if (icpSharpened) {
    items.push({
      at: String(icpSharpened.created_at),
      tone: 'info',
      text: `We sharpened your prospect targeting from your latest intake.`
    });
  }

  // Sort newest first, cap at 5 — keep the panel calm.
  items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  return {
    items: items.slice(0, 5),
    windowLabel: `Last ${WINDOW_DAYS} days`
  };
}
