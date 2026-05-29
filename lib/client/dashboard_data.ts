/**
 * lib/client/dashboard_data.ts
 *
 * Single source of truth for data shared across the client dashboard surfaces:
 *   - /client/dashboard            (what the client sees)
 *   - /client/audit                (the full audit page)
 *   - /admin/av/clients/[id]/preview (operator's read-only mirror)
 *
 * Pass 1 of the "one view, one loader" refactor. The audit query in particular
 * had to be fixed in THREE places (it kept showing a prospect's audit as the
 * client's own); centralizing it here means it can only ever be fixed once.
 *
 * The returned shape intentionally mirrors the leads row (snake_case) so existing
 * render code at the call sites is a drop-in — no template churn, lower risk.
 */
import { getAvDb } from '@/lib/db/av';
import { TIER_FEATURES, type ClientTier } from '@/lib/client-portal/tiers';
import { getOrComposeClientGuidance } from '@/lib/client/guidance';
import { listClientCampaignContent, listClientCampaigns, type CampaignContentItem, type ClientCampaign } from '@/lib/client/campaign';
import { getClientCreativeBrief, type CreativeBrief as CreativeBriefData } from '@/lib/client/brief';
import { clientMonthlyPipelineCents } from '@/lib/sales/deal_model';
import { listClientTeam, type TeamRep } from '@/lib/client/team';
import type { RowDataPacket } from 'mysql2';

export interface ClientOwnAuditRow {
  audit_id: string | null;
  company: string | null;
  industry: string | null;
  audit_content: string | null;
  audit_generated: Date | null;
  created_at: Date | null;
}

/**
 * The client's OWN business audit: the lead matching THEIR email. Never a
 * prospect scoped to their hub (client_id) — a prospect's marketing audit is not
 * the client's own. Returns null when the client has no audit on file yet.
 */
export async function getClientOwnAudit(email: string | null | undefined): Promise<ClientOwnAuditRow | null> {
  if (!email || !email.trim()) return null;
  const db = getAvDb();
  const [rows] = await db.execute<(RowDataPacket & ClientOwnAuditRow)[]>(
    `SELECT audit_id, company, industry, audit_content, audit_generated, created_at
       FROM leads
      WHERE archived_at IS NULL AND audit_content IS NOT NULL AND email = ?
      ORDER BY COALESCE(audit_generated, created_at) DESC
      LIMIT 1`,
    [email]
  );
  return rows[0] ?? null;
}

/** The logged-in (or previewed) client, enough to assemble their dashboard. */
export interface DashboardClient {
  clientUserId: number;
  clientId: number | null;
  email: string;
  tier: ClientTier;
  displayName: string | null;
}

/** Everything the client dashboard body renders. One loader so the real
 *  /client/dashboard and the operator preview assemble identical data. */
export interface ClientDashboardData {
  firstName: string;
  tier: ClientTier;
  audit: ClientOwnAuditRow | null;
  leadCount: number;
  guidance: Awaited<ReturnType<typeof getOrComposeClientGuidance>>;
  campaign: CampaignContentItem[];
  liveCount: number;
  inMotion: number;
  clientCampaigns: ClientCampaign[];
  brief: CreativeBriefData;
  monthlyPipelineCents: number | null;
  team: TeamRep[];
  features: (typeof TIER_FEATURES)[ClientTier];
  // (#242) Passed through so the dashboard body can mount client-scoped
  // server components (ThisWeekFeed) without re-resolving the actor.
  clientId: number | null;
}

export async function getClientDashboardData(client: DashboardClient): Promise<ClientDashboardData> {
  const db = getAvDb();
  const audit = await getClientOwnAudit(client.email);

  const [countRows] = await db.execute<(RowDataPacket & { c: number })[]>(
    `SELECT COUNT(*) AS c FROM leads
      WHERE archived_at IS NULL AND ((? IS NOT NULL AND client_id = ?) OR email = ?)`,
    [client.clientId, client.clientId, client.email]
  );
  const leadCount = Number(countRows[0]?.c ?? 0);

  const guidance = await getOrComposeClientGuidance({
    client: {
      clientUserId: client.clientUserId,
      clientId: client.clientId,
      email: client.email,
      tier: client.tier,
      displayName: client.displayName
    }
  });

  let campaign: CampaignContentItem[] = [];
  try { campaign = await listClientCampaignContent({ client_id: client.clientId, email: client.email }); } catch { campaign = []; }
  const liveCount = campaign.filter((c) => c.stage === 'live').length;
  const inMotion = campaign.filter((c) => c.stage !== 'live').length;

  let clientCampaigns: ClientCampaign[] = [];
  try { clientCampaigns = await listClientCampaigns({ client_id: client.clientId, email: client.email }); } catch { clientCampaigns = []; }

  let brief: CreativeBriefData = { activeLines: [], nextLeads: [], awaitingApproval: [], awaitingCount: 0, pipeline: { total: 0, hot: 0, warm: 0, cool: 0 } };
  try { brief = await getClientCreativeBrief({ client_id: client.clientId, email: client.email }); } catch { /* keep empty */ }

  const monthlyPipelineCents = await clientMonthlyPipelineCents(client.clientId).catch(() => null);
  const team = await listClientTeam(client.clientId).catch(() => []);

  return {
    firstName: client.displayName?.split(/[ ,]/)[0] || 'there',
    tier: client.tier,
    audit,
    leadCount,
    guidance,
    campaign,
    liveCount,
    inMotion,
    clientCampaigns,
    brief,
    monthlyPipelineCents,
    team,
    features: TIER_FEATURES[client.tier],
    clientId: client.clientId
  };
}
