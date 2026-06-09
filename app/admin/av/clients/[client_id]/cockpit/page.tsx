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

  // v1 mock data — REPLACED by live cascade reads in #550 v2.
  const cockpitData = {
    kind,
    firstName,
    displayName: client.client_name,
    shortName: client.short_name ?? '',
    brief,
    // Mock counts — real version pulls from public_intel_records + narrative_lines
    pulse: { signalsThisWeek: 17, narrativesRunning: 3, pendingApprovals: 3, pressTouches: 9 }
  };

  return <CockpitClient data={cockpitData} clientId={clientId} />;
}
