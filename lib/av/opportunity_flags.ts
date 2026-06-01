/**
 * lib/av/opportunity_flags.ts  (#183 / #296)
 *
 * "What heated up in the last 24h" — a small read-only feed of leads val
 * (or any operator) should glance at. Surfaces three signal types:
 *
 *   1. Newly hot AV-score: ai_score >= 85 set within the last 24h
 *   2. Just enriched + warm or hotter: enriched_at within 24h AND ai_score >= 75
 *   3. High ICP-fit jump: client_icp_fit_score >= 85 set within 24h
 *
 * The same lead can appear via multiple signals; we de-dupe by lead.id
 * and prefer the highest-priority signal label.
 *
 * Read-only. Single query. No writes. Safe to call on every cockpit
 * render — costs about as much as listClientAccounts (cheap).
 *
 * NOT a notification system — there's no "unread" state server-side.
 * Dismissal is purely client-side (localStorage) so each operator's
 * dismisses stay personal without a schema change.
 */
import { getAvDb } from '@/lib/db/av';
import type { RowDataPacket } from 'mysql2';
// (#305) Types + the SIGNAL_COPY meta map live in the sidecar so client
// components can import them without dragging mysql2 into the browser
// bundle. Server code re-imports both from here so call sites don't change.
import { SIGNAL_COPY, type FlagSignal, type OpportunityFlag } from './opportunity_flags_meta';
export { SIGNAL_COPY };
export type { FlagSignal, OpportunityFlag };

// Highest-priority first. When the same lead matches several signals,
// the first one in this list wins for the badge/label.
const SIGNAL_PRIORITY: FlagSignal[] = ['newly_hot', 'icp_fit_jump', 'just_enriched_warm'];

interface FlagRow extends RowDataPacket {
  id: number;
  audit_id: string | null;
  company: string | null;
  client_id: number | null;
  client_name: string | null;
  ai_score: number | null;
  client_icp_fit_score: number | null;
  audit_generated: string | Date | null;
  enriched_at: string | Date | null;
  // The three "did this signal fire?" flags below come from CASE expressions
  // in the SELECT — saves writing three separate queries + a UNION.
  is_newly_hot: number;
  is_enriched_warm: number;
  is_icp_jump: number;
  // The fired-at timestamp for whichever signal is highest-priority on this row.
  fired_at: string | Date | null;
}

const WINDOW_HOURS = 24;
const LIMIT = 40; // soft cap; dropdown shouldn't be a firehose

function toIso(v: string | Date | null): string {
  if (!v) return new Date().toISOString();
  if (v instanceof Date) return v.toISOString();
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

/**
 * Load the current opportunity flags. Returns newest-first, de-duped by
 * leadId. Never throws — returns [] on any DB issue so the header pill
 * fails closed (the dropdown just won't show signals, the page still loads).
 */
export async function listOpportunityFlags(): Promise<OpportunityFlag[]> {
  try {
    const db = getAvDb();
    // One query, three CASE-driven signal flags. The WHERE OR clause limits
    // candidates to leads that match AT LEAST one signal in the window.
    const [rows] = await db.execute<FlagRow[]>(
      `SELECT l.id,
              l.audit_id,
              l.company,
              l.client_id,
              c.client_name,
              l.ai_score,
              l.client_icp_fit_score,
              l.audit_generated,
              l.enriched_at,
              CASE WHEN l.ai_score >= 85
                    AND l.audit_generated IS NOT NULL
                    AND l.audit_generated >= (NOW() - INTERVAL ${WINDOW_HOURS} HOUR)
                   THEN 1 ELSE 0 END AS is_newly_hot,
              CASE WHEN l.enriched_at IS NOT NULL
                    AND l.enriched_at >= (NOW() - INTERVAL ${WINDOW_HOURS} HOUR)
                    AND l.ai_score >= 75
                   THEN 1 ELSE 0 END AS is_enriched_warm,
              CASE WHEN l.client_icp_fit_score >= 85
                    AND l.audit_generated IS NOT NULL
                    AND l.audit_generated >= (NOW() - INTERVAL ${WINDOW_HOURS} HOUR)
                   THEN 1 ELSE 0 END AS is_icp_jump,
              GREATEST(
                COALESCE(l.audit_generated, '1970-01-01'),
                COALESCE(l.enriched_at, '1970-01-01')
              ) AS fired_at
         FROM leads l
         LEFT JOIN clients c ON c.client_id = l.client_id
        WHERE l.archived_at IS NULL
          AND (
                (l.ai_score >= 85 AND l.audit_generated >= (NOW() - INTERVAL ${WINDOW_HOURS} HOUR))
             OR (l.enriched_at >= (NOW() - INTERVAL ${WINDOW_HOURS} HOUR) AND l.ai_score >= 75)
             OR (l.client_icp_fit_score >= 85 AND l.audit_generated >= (NOW() - INTERVAL ${WINDOW_HOURS} HOUR))
          )
        ORDER BY fired_at DESC
        LIMIT ${LIMIT}`
    );

    const out: OpportunityFlag[] = [];
    for (const r of rows) {
      // Pick the highest-priority signal that fired for this row.
      let chosen: FlagSignal | null = null;
      for (const sig of SIGNAL_PRIORITY) {
        if (sig === 'newly_hot' && r.is_newly_hot) { chosen = sig; break; }
        if (sig === 'icp_fit_jump' && r.is_icp_jump) { chosen = sig; break; }
        if (sig === 'just_enriched_warm' && r.is_enriched_warm) { chosen = sig; break; }
      }
      if (!chosen) continue;
      const score =
        chosen === 'icp_fit_jump'
          ? Number(r.client_icp_fit_score ?? 0)
          : Number(r.ai_score ?? 0);
      out.push({
        leadId: r.id,
        auditId: r.audit_id,
        company: r.company || 'Untitled lead',
        clientId: r.client_id ?? null,
        clientName: r.client_name && r.client_name.trim() ? r.client_name.trim() : null,
        signal: chosen,
        score,
        firedAt: toIso(r.fired_at)
      });
    }
    return out;
  } catch (err) {
    console.error('[opportunity_flags] listOpportunityFlags failed:', (err as Error).message);
    return [];
  }
}

// (#305) SIGNAL_COPY moved to ./opportunity_flags_meta.ts (re-exported above).
