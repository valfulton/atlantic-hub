/**
 * /admin/av/clients/[client_id]/cockpit — Campaign Cockpit (#550 v1)
 *
 * Per-client cockpit demo. Reads the client's brief_payload as the source of
 * truth, renders the kind-aware demo view (defense_pr / political_campaign /
 * etc.), and shows pending-approval rows the operator can green-light.
 *
 * v1 SCOPE — what's REAL vs what's MOCK:
 *   - Real: client identity (clients table), brief_payload (creative_briefs),
 *     short_name, kind inference from brief.industry
 *   - Mock: district pulse signals, narrative-line counts, demographic
 *     resonance, cascade attribution. Replaced with live data in #550 v2
 *     once public_intel_records is filtered by kind + the cascade engine
 *     starts emitting attributions.
 *   - Stub: green-light POST hits /api/admin/av/cockpit/greenlight which
 *     logs intent. Real publish wiring comes when narrative_line_links +
 *     outbox are connected, also #550 v2.
 *
 * Why v1 still ships value: val can text John White / Ron Elfenbein / any
 * client a direct link to /admin/av/clients/[their-id]/cockpit. The page
 * renders their actual brief in a cockpit shell that LOOKS like the live
 * version, which is enough to demo the engine and close the deal.
 *
 * Owner + staff only. Client_users cannot reach this route (route guard
 * below — operator-only). The CLIENT-FACING equivalent (cream skin,
 * read-only) is in #550 v3.
 */
import { headers } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import { getAvDb } from '@/lib/db/av';
import { getBriefPayload } from '@/lib/client/brief_store';
import type { RowDataPacket } from 'mysql2';
import CockpitClient from './CockpitClient';
import { cockpitTitlesFor } from '@/lib/av/cockpit_asset_titles';
// (#571, Tier 2.1) Real cockpit counters — replace the mock pulse numbers.
import { countPendingApprovals, listApprovalsForClient } from '@/lib/av/cockpit_approvals';
import { countPressTouchesThisWeek } from '@/lib/client/press_touches';

export const dynamic = 'force-dynamic';

interface ClientRow extends RowDataPacket {
  client_id: number;
  client_name: string;
  short_name: string | null;
  industry: string | null;
  plan_tier: string;
}

/**
 * Cheap kind inference from the brief until clients.client_kind ships (#551).
 * Reads brief.industry first, then falls back to clients.industry.
 * Strict matching — only switches off lead-gen for known patterns.
 */
function inferClientKind(briefIndustry: string, clientsIndustry: string): string {
  const s = `${briefIndustry} ${clientsIndustry}`.toLowerCase();
  if (s.includes('defense') || s.includes('federal criminal') || s.includes('legal defense')) return 'defense_pr';
  if (s.includes('political') || s.includes('campaign') || s.includes('congressional')) return 'political_campaign';
  if (s.includes('catamaran') || s.includes('yacht') || s.includes('hospitality') || s.includes('charter')) return 'luxury_hospitality';
  if (s.includes('book') || s.includes('author')) return 'book_pr';
  return 'lead_gen';
}

interface CockpitProps {
  params: { client_id: string };
}

export default async function CockpitPage({ params }: CockpitProps) {
  // Operator role guard — client_users redirected to their own dashboard.
  const role = headers().get('x-ah-user-role') as 'owner' | 'staff' | 'client_user' | null;
  if (role === 'client_user') redirect('/client/dashboard');

  const clientId = Number.parseInt(params.client_id, 10);
  if (!Number.isFinite(clientId) || clientId <= 0) notFound();

  const db = getAvDb();
  const [rows] = await db.execute<ClientRow[]>(
    `SELECT client_id, client_name, short_name, industry, plan_tier
       FROM clients WHERE client_id = ? LIMIT 1`,
    [clientId]
  );
  if (rows.length === 0) notFound();
  const client = rows[0];

  // The brief is the source of truth. Operator-side cockpit reads it raw.
  const brief = ((await getBriefPayload('av', clientId)) as Record<string, unknown> | null) ?? {};
  const briefIndustry = typeof brief.industry === 'string' ? brief.industry : '';
  const contactName = typeof brief.contact_name === 'string' ? brief.contact_name : '';
  const ownerName = typeof brief.owner_name === 'string' ? brief.owner_name : '';
  const kind = inferClientKind(briefIndustry, client.industry ?? '');

  // First name for the greeting — fall back ladder until something lands.
  // (This is the fix for the "Good afternoon, there." bug val flagged: the
  // greeting was using a literal 'there' as fallback. Now: contact_name first
  // token → owner_name first token → client_name → 'there'.)
  const firstName =
    contactName.split(/\s+/)[0] ||
    ownerName.split(/\s+/)[0] ||
    client.client_name.split(/\s+/)[0] ||
    'there';

  // (#571, Tier 2.1) Real counters — parallel reads, soft-fail to 0.
  //   narrativesRunning → narrative_lanes WHERE client_id + state active/reinforcing
  //   pendingApprovals  → cockpit_approvals WHERE status='pending'
  //   pressTouches      → press_touches in the last 7 days
  //   signalsThisWeek   → public_intel_records.seen_at >= NOW() - INTERVAL 7 DAY,
  //                       scoped via brief.district_zips or brief.business_state.
  // (#568) Brief-grounded approval titles (still per-kind; persisted approvals
  //         take precedence below so edits aren't overwritten).
  // (#569/#570) Existing approvals from cockpit_approvals — persisted edits
  //         + greenlit rows merge ahead of the inline brief-generated slots.
  const [narrativesRunning, pendingApprovals, pressTouches, signalsThisWeek, persistedApprovals] = await Promise.all([
    countNarrativesRunningForClient(clientId),
    countPendingApprovals(clientId),
    countPressTouchesThisWeek(clientId),
    countSignalsThisWeekForBrief(brief as Record<string, unknown>),
    listApprovalsForClient(clientId, { status: 'pending', limit: 8 })
  ]);

  const briefTitles = cockpitTitlesFor(kind, brief as Record<string, unknown>);
  // (#581) Carry campaignName + bodyWordCount through so the cockpit cards can
  // render "Campaign · {name}" and "Draft · 247 words" inline. Inline (brief-
  // grounded) titles have no body or campaign yet; the body generator fills
  // them on the next brief save.
  const persistedAsApprovals = persistedApprovals.map((a) => ({
    id: String(a.id),
    kind: a.kind,
    title: a.title,
    angle: a.angle ?? '—',
    source: a.source ?? '',
    campaignName: a.campaignName,
    bodyWordCount: a.body ? a.body.trim().split(/\s+/).filter(Boolean).length : 0
  }));
  // De-dupe by (kind, angle) so we don't double-show the same slot once an
  // operator's edit has been persisted.
  const seen = new Set(persistedAsApprovals.map((p) => `${p.kind}:${p.angle}`));
  const merged = [
    ...persistedAsApprovals,
    ...briefTitles.filter((t) => !seen.has(`${t.kind}:${t.angle}`))
  ];

  const cockpitData = {
    kind,
    firstName,
    displayName: client.client_name,
    shortName: client.short_name ?? '',
    brief,
    pulse: {
      signalsThisWeek,
      narrativesRunning,
      pendingApprovals,
      pressTouches
    }
  };

  return <CockpitClient data={cockpitData} clientId={clientId} initialApprovals={merged} />;
}

/** (#571) Count active narrative lines owned by this client. Soft-fail to 0. */
async function countNarrativesRunningForClient(clientId: number): Promise<number> {
  if (!Number.isInteger(clientId) || clientId <= 0) return 0;
  try {
    const db = getAvDb();
    const [rows] = await db.execute<(RowDataPacket & { n: number })[]>(
      `SELECT COUNT(*) AS n FROM narrative_lanes
        WHERE tenant_id = 'av' AND client_id = ?
          AND state IN ('active','reinforcing')`,
      [clientId]
    );
    return Number(rows[0]?.n ?? 0);
  } catch {
    return 0;
  }
}

/** (#571) Count public_intel_records seen in the last 7 days, scoped to the
 *  brief's district_zips when present, otherwise the business_state.
 *  Soft-fail to 0. */
async function countSignalsThisWeekForBrief(brief: Record<string, unknown> | null): Promise<number> {
  if (!brief) return 0;
  const zipsRaw = brief['district_zips'];
  const state = typeof brief['business_state'] === 'string' ? (brief['business_state'] as string).trim().toUpperCase() : '';
  let zips: string[] = [];
  if (Array.isArray(zipsRaw)) zips = zipsRaw.map(String);
  else if (typeof zipsRaw === 'string') {
    try { const arr = JSON.parse(zipsRaw); if (Array.isArray(arr)) zips = arr.map(String); }
    catch { zips = zipsRaw.split(/[\s,]+/); }
  }
  zips = zips.map((z) => z.match(/\d{5}/)?.[0]).filter((z): z is string => !!z).slice(0, 30);
  try {
    const db = getAvDb();
    if (zips.length > 0) {
      const placeholders = zips.map(() => '?').join(',');
      const [rows] = await db.execute<(RowDataPacket & { n: number })[]>(
        `SELECT COUNT(*) AS n FROM public_intel_records
          WHERE seen_at >= NOW() - INTERVAL 7 DAY
            AND (zip IN (${placeholders})
                 OR JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.zip')) IN (${placeholders}))`,
        [...zips, ...zips]
      );
      return Number(rows[0]?.n ?? 0);
    }
    if (state && state.length === 2) {
      const [rows] = await db.execute<(RowDataPacket & { n: number })[]>(
        `SELECT COUNT(*) AS n FROM public_intel_records
          WHERE seen_at >= NOW() - INTERVAL 7 DAY
            AND state = ?`,
        [state]
      );
      return Number(rows[0]?.n ?? 0);
    }
    return 0;
  } catch {
    return 0;
  }
}
