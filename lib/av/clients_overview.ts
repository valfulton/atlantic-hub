/**
 * lib/av/clients_overview.ts
 *
 * Operator-side read model for the per-client account view. This is the
 * cross-client cockpit (operator-only): a roster of every client hub and a
 * detail view showing a client's pipeline, their discovery activity, and any
 * errors they will NEVER see ([[client-simplicity-hide-machinery]]).
 *
 * Errors are recorded by client discovery as system_events rows with
 * source='client_discovery' and client_id in the payload (see
 * app/api/client/discover/route.ts).
 */
import { getAvDb } from '@/lib/db/av';
import { getClientIcp, type ClientIcp } from '@/lib/client/icp';
import { listClientLeads, type ClientLead } from '@/lib/client/leads';
import type { RowDataPacket } from 'mysql2';

export interface ClientAccountSummary {
  clientId: number;
  name: string;
  slug: string;
  industry: string | null;
  enabled: boolean;
  planTier: string;
  leadCount: number;
  discoveredThisMonth: number;
  recentErrorCount: number;
}

export interface ClientDiscoveryEvent {
  at: string | null;
  status: string;
  stage: string | null;
  message: string | null;
}

export interface ClientAccountMember {
  email: string;
  displayName: string | null;
  tier: string;
  lastLoginAt: string | null;
}

export interface ClientAccountDetail {
  clientId: number;
  name: string;
  slug: string;
  industry: string | null;
  enabled: boolean;
  planTier: string;
  createdAt: string | null;
  members: ClientAccountMember[];
  leadCount: number;
  discoveredThisMonth: number;
  icp: ClientIcp;
  recentErrors: ClientDiscoveryEvent[];
  leads: ClientLead[];
}

function toIso(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString();
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Every active client hub with at-a-glance health. Operator-only. */
export async function listClientAccounts(): Promise<ClientAccountSummary[]> {
  const db = getAvDb();
  const [rows] = await db.execute<(RowDataPacket & {
    client_id: number; client_name: string; client_slug: string; industry: string | null;
    enabled: unknown; plan_tier: string; lead_count: number | string;
    discovered_this_month: number | string; recent_error_count: number | string;
  })[]>(
    `SELECT c.client_id, c.client_name, c.client_slug, c.industry, c.enabled, c.plan_tier,
            (SELECT COUNT(*) FROM leads l
              WHERE l.client_id = c.client_id AND l.archived_at IS NULL) AS lead_count,
            (SELECT COUNT(*) FROM leads l
              WHERE l.client_id = c.client_id AND l.source_type = 'api' AND l.archived_at IS NULL
                AND YEAR(l.last_activity_at) = YEAR(UTC_TIMESTAMP())
                AND MONTH(l.last_activity_at) = MONTH(UTC_TIMESTAMP())) AS discovered_this_month,
            (SELECT COUNT(*) FROM system_events e
              WHERE e.source = 'client_discovery' AND e.status = 'failure'
                AND JSON_EXTRACT(e.payload, '$.client_id') = c.client_id
                AND e.created_at > DATE_SUB(NOW(), INTERVAL 30 DAY)) AS recent_error_count
       FROM clients c
      WHERE c.archived_at IS NULL
      ORDER BY c.created_at DESC
      LIMIT 200`
  );
  return rows.map((r) => ({
    clientId: r.client_id,
    name: r.client_name,
    slug: r.client_slug,
    industry: r.industry,
    enabled: r.enabled === 1 || r.enabled === true || r.enabled === '1',
    planTier: r.plan_tier,
    leadCount: Number(r.lead_count) || 0,
    discoveredThisMonth: Number(r.discovered_this_month) || 0,
    recentErrorCount: Number(r.recent_error_count) || 0
  }));
}

/** Full per-client detail. Returns null if the client doesn't exist/active. */
export async function getClientAccountDetail(clientId: number): Promise<ClientAccountDetail | null> {
  if (!clientId || clientId <= 0) return null;
  const db = getAvDb();

  const [crows] = await db.execute<(RowDataPacket & {
    client_id: number; client_name: string; client_slug: string; industry: string | null;
    enabled: unknown; plan_tier: string; created_at: Date | string | null;
  })[]>(
    `SELECT client_id, client_name, client_slug, industry, enabled, plan_tier, created_at
       FROM clients WHERE client_id = ? AND archived_at IS NULL LIMIT 1`,
    [clientId]
  );
  const c = crows[0];
  if (!c) return null;

  const [members] = await db.execute<(RowDataPacket & {
    email: string; display_name: string | null; tier: string; last_login_at: Date | string | null;
  })[]>(
    `SELECT email, display_name, tier, last_login_at
       FROM client_users WHERE client_id = ? AND archived_at IS NULL
      ORDER BY last_login_at DESC LIMIT 20`,
    [clientId]
  );

  const [counts] = await db.execute<(RowDataPacket & { lead_count: number | string; discovered_this_month: number | string })[]>(
    `SELECT
       (SELECT COUNT(*) FROM leads l WHERE l.client_id = ? AND l.archived_at IS NULL) AS lead_count,
       (SELECT COUNT(*) FROM leads l WHERE l.client_id = ? AND l.source_type = 'api' AND l.archived_at IS NULL
          AND YEAR(l.last_activity_at) = YEAR(UTC_TIMESTAMP())
          AND MONTH(l.last_activity_at) = MONTH(UTC_TIMESTAMP())) AS discovered_this_month`,
    [clientId, clientId]
  );

  const [events] = await db.execute<(RowDataPacket & {
    created_at: Date | string | null; status: string; payload: unknown; error_message: string | null;
  })[]>(
    `SELECT created_at, status, payload, error_message
       FROM system_events
      WHERE source = 'client_discovery'
        AND JSON_EXTRACT(payload, '$.client_id') = ?
      ORDER BY created_at DESC
      LIMIT 25`,
    [clientId]
  );

  const [icp, leads] = await Promise.all([
    getClientIcp(clientId),
    listClientLeads({ client_id: clientId })
  ]);

  const recentErrors: ClientDiscoveryEvent[] = events.map((e) => {
    let stage: string | null = null;
    try {
      const p = (typeof e.payload === 'string' ? JSON.parse(e.payload) : e.payload) as Record<string, unknown> | null;
      if (p && typeof p.stage === 'string') stage = p.stage;
    } catch {
      /* ignore */
    }
    return { at: toIso(e.created_at), status: e.status, stage, message: e.error_message };
  });

  return {
    clientId: c.client_id,
    name: c.client_name,
    slug: c.client_slug,
    industry: c.industry,
    enabled: c.enabled === 1 || c.enabled === true || c.enabled === '1',
    planTier: c.plan_tier,
    createdAt: toIso(c.created_at),
    members: members.map((m) => ({
      email: m.email,
      displayName: m.display_name,
      tier: m.tier,
      lastLoginAt: toIso(m.last_login_at)
    })),
    leadCount: Number(counts[0]?.lead_count) || 0,
    discoveredThisMonth: Number(counts[0]?.discovered_this_month) || 0,
    icp,
    recentErrors,
    leads
  };
}
