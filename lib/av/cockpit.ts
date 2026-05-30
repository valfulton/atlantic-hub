/**
 * lib/av/cockpit.ts  (#219)
 *
 * Per-client snapshot for the operator cockpit at /admin/av/clients. Adds
 * the autopilot-health + pipeline-quality fields to the existing client
 * roster:
 *   - hotFitCount      : leads with client_icp_fit_score >= 85
 *   - pipelineCents    : sum(deal_unit_count * clients.deal_rate_cents) for
 *                        unconverted leads
 *   - icpPopulated     : client_icps has any industries or geographies
 *   - brandKitSet      : brief has non-empty brand_colors
 *   - lastDigestSentAt : most recent system_events.client.digest.sent
 *
 * One round-trip per client snapshot — totals queries scoped per-client to
 * keep the SQL simple. Roster size in practice is ≤ a few dozen.
 */
import { getAvDb } from '@/lib/db/av';
import { listClientAccounts, type ClientAccountSummary } from '@/lib/av/clients_overview';
import type { RowDataPacket } from 'mysql2';

export interface CockpitClient extends ClientAccountSummary {
  hotFitCount: number;
  pipelineCents: number | null;
  icpPopulated: boolean;
  brandKitSet: boolean;
  lastDigestSentAt: string | null;
}

interface HealthRow extends RowDataPacket {
  client_id: number;
  hot_fit_count: number;
  pipeline_cents: number | string | null;
  icp_industries: number | null;
  icp_geos: number | null;
  brand_colors_len: number | null;
  last_digest_at: string | Date | null;
}

/**
 * Fetch the cockpit roster. Combines listClientAccounts (existing summary)
 * with a single aggregation query that pulls per-client health metrics.
 */
export async function fetchCockpitClients(): Promise<CockpitClient[]> {
  const base = await listClientAccounts();
  if (base.length === 0) return [];

  // Single-query aggregation across leads + client_icps + creative_briefs +
  // system_events. LEFT JOINs everywhere so a client missing any one of
  // these still gets a row with zeros / nulls.
  let healthMap = new Map<number, HealthRow>();
  try {
    const db = getAvDb();
    const ids = base.map((c) => c.clientId);
    const placeholders = ids.map(() => '?').join(',');
    const [rows] = await db.execute<HealthRow[]>(
      `SELECT
          c.client_id,
          COALESCE(SUM(CASE WHEN l.client_icp_fit_score >= 85 THEN 1 ELSE 0 END), 0) AS hot_fit_count,
          COALESCE(SUM(
            CASE
              WHEN l.lead_status NOT IN ('converted', 'lost')
                AND l.deal_unit_count IS NOT NULL
                AND c.deal_rate_cents IS NOT NULL
              THEN l.deal_unit_count * c.deal_rate_cents
              ELSE 0
            END
          ), 0) AS pipeline_cents,
          (SELECT COALESCE(JSON_LENGTH(target_industries), 0) FROM client_icps WHERE client_id = c.client_id LIMIT 1) AS icp_industries,
          (SELECT COALESCE(JSON_LENGTH(target_geographies), 0) FROM client_icps WHERE client_id = c.client_id LIMIT 1) AS icp_geos,
          (SELECT
              CASE
                WHEN brief_payload IS NULL THEN 0
                ELSE CHAR_LENGTH(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(brief_payload, '$.brand_colors')), ''))
              END
             FROM creative_briefs WHERE client_id = c.client_id AND tenant_id = 'av' LIMIT 1
          ) AS brand_colors_len,
          (SELECT MAX(created_at) FROM system_events
            WHERE event_type = 'client.digest.sent' AND organization_id = c.client_id
          ) AS last_digest_at
        FROM clients c
        LEFT JOIN leads l
          ON l.client_id = c.client_id
         AND l.archived_at IS NULL
       WHERE c.client_id IN (${placeholders})
       GROUP BY c.client_id`,
      ids
    );
    healthMap = new Map(rows.map((r) => [r.client_id, r]));
  } catch (err) {
    console.error('[cockpit:health]', (err as Error).message);
    // Non-fatal: roster still renders with the base data.
  }

  return base.map((c) => {
    const h = healthMap.get(c.clientId);
    return {
      ...c,
      hotFitCount: h ? Number(h.hot_fit_count) || 0 : 0,
      pipelineCents: h && h.pipeline_cents != null ? Number(h.pipeline_cents) : 0,
      icpPopulated: !!h && (Number(h.icp_industries ?? 0) > 0 || Number(h.icp_geos ?? 0) > 0),
      brandKitSet: !!h && Number(h.brand_colors_len ?? 0) > 0,
      lastDigestSentAt: h?.last_digest_at ? new Date(h.last_digest_at).toISOString() : null
    };
  });
}

/** Short relative-time formatter shared with the cockpit table. */
export function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const secs = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.round(days / 30)}mo ago`;
}
