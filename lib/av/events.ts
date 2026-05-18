/**
 * lead_events writer + platform-role → AV-actor-role mapping.
 *
 * Every AV mutation writes:
 *   1. A row in `lead_events` (per-tenant domain event log; rich payload).
 *   2. A row in `audit_log_global` (platform compliance log; PII-scrubbed).
 *
 * The route handlers call `writeLeadEvent()` for (1) and rely on the
 * existing `guardAdminRequest` flow to handle (2)'s "view" rows. For the
 * mutation-specific compliance row, routes call `writeAuditRow` directly
 * with an `action` like 'av_lead_created' or 'av_lead_stage_changed'.
 *
 * Note on actor_role: `lead_events.actor_role` is VARCHAR(40) so the
 * column accepts any string — but to keep dashboards consistent we map
 * the platform role onto the AV-actor vocabulary defined in
 * 004_av_detail.sql:
 *   owner       = Val (platform 'owner')
 *   operator    = Hub staff (platform 'staff')
 *   client_user = AV client seat (platform 'client_user')
 *   system      = automated event (no human actor; e.g. AI scoring cron)
 */
import { getAvDb } from '@/lib/db/av';

export type LeadEventType =
  | 'created'
  | 'stage_changed'
  | 'note_added'
  | 'tag_added'
  | 'tag_removed'
  | 'archived'
  | 'exported'
  | 'deleted'
  | 'ai_scored'
  | 'ai_audited'
  | 'ai_email_drafted'
  | 'email_opened'
  | 'email_clicked';

export type AvActorRole = 'owner' | 'operator' | 'client_user' | 'system';

export function mapPlatformRoleToAvActorRole(
  platformRole: 'owner' | 'staff' | 'client_user'
): AvActorRole {
  switch (platformRole) {
    case 'owner':
      return 'owner';
    case 'staff':
      return 'operator';
    case 'client_user':
      return 'client_user';
  }
}

export interface WriteLeadEventParams {
  clientId: number;
  leadId: number;
  eventType: LeadEventType;
  payload?: Record<string, unknown> | null;
  actorUserId?: number | null;
  actorRole?: AvActorRole | null;
}

/**
 * Write a lead_events row. Never throws to the caller — domain-event
 * failures should not abort a successful business mutation. Logs to
 * stderr on failure so the platform audit log still records the action.
 */
export async function writeLeadEvent(params: WriteLeadEventParams): Promise<void> {
  try {
    const db = getAvDb();
    await db.execute(
      `INSERT INTO lead_events
         (client_id, lead_id, event_type, event_payload, actor_user_id, actor_role)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        params.clientId,
        params.leadId,
        params.eventType,
        params.payload ? JSON.stringify(params.payload) : null,
        params.actorUserId ?? null,
        params.actorRole ?? 'system'
      ]
    );
  } catch (err) {
    console.error('[av:lead-event-write-failed]', {
      clientId: params.clientId,
      leadId: params.leadId,
      eventType: params.eventType,
      err: (err as Error).message
    });
  }
}
