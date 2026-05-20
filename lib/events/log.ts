/**
 * lib/events/log.ts
 *
 * Single helper used by every code path that wants to record a cross-cutting
 * system event. Writes one row into shhdbite_AV.system_events.
 *
 * DESIGN CONTRACT:
 *   - logEvent NEVER throws. If the insert fails, the failure is logged to
 *     console.error and the caller continues. Event logging must never break
 *     business logic.
 *   - logEvent does not block long. The single INSERT is awaited inside the
 *     helper so the caller's `await logEvent(...)` resolves once the row is
 *     persisted, but if the caller does not await (fire-and-forget) the row
 *     still lands. We intentionally do not implement any batching, queueing
 *     or retry -- if the DB is unreachable, drop the event and move on.
 *
 * Event-type naming convention: dot-namespaced, lowercase, underscores
 *   lead.created
 *   lead.enriched
 *   lead.enrichment_failed
 *   lead.bulk_enrichment_attempted
 *   ai.lead_scored
 *   ai.audit_generated
 *   ai.score_failed
 *   ai.social_content_generated
 *   api.openai_error
 *   api.apollo_error
 *   api.rate_limited
 *   scoring.cron_run
 *   scoring.cron_error
 *   workflow.failed
 *
 * Source labels:
 *   apollo, google_places, instagram, csv, scrape, hunter, openai, scraper, cron
 *
 * Schema: schema/010_system_events.sql
 */

import { getAvDb } from '@/lib/db/av';
import { applyEngagementSignalBackground } from '@/lib/ai/engagement_score';
import type { ResultSetHeader } from 'mysql2';

export type LogEventStatus = 'success' | 'failure' | 'partial' | 'pending';

export interface LogEventArgs {
  eventType: string;
  leadId?: number | null;
  userId?: number | null;
  organizationId?: number | null;
  source?: string;
  payload?: object;
  status?: LogEventStatus;
  executionTimeMs?: number;
  errorMessage?: string;
}

/**
 * Insert a row into shhdbite_AV.system_events. Errors are swallowed.
 *
 * Returns a resolved promise once the insert is complete (or fails silently).
 * Callers may safely `await` it or fire-and-forget.
 */
export async function logEvent(args: LogEventArgs): Promise<void> {
  try {
    const db = getAvDb();
    const payloadJson = args.payload ? JSON.stringify(args.payload) : null;
    const errorMessage = args.errorMessage ? args.errorMessage.slice(0, 1000) : null;
    await db.execute<ResultSetHeader>(
      `INSERT INTO system_events
         (event_type, organization_id, lead_id, user_id, source, payload,
          status, execution_time_ms, error_message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        args.eventType,
        args.organizationId ?? null,
        args.leadId ?? null,
        args.userId ?? null,
        args.source ?? null,
        payloadJson,
        args.status ?? 'success',
        args.executionTimeMs ?? null,
        errorMessage
      ]
    );
  } catch (err) {
    // Never throw out of logEvent. Visible in Netlify function logs for triage.
    console.error('[events:log]', args.eventType, (err as Error).message);
  }

  // Living Score: fire engagement signal in the background if the event
  // carries a leadId. The engagement scorer ignores unknown event types
  // so this is safe to call for every event that has a lead attached.
  // Success-status only -- failures should not move the score upward.
  if (args.leadId && (args.status ?? 'success') === 'success') {
    applyEngagementSignalBackground({
      leadId: args.leadId,
      eventType: args.eventType
    });
  }
}
