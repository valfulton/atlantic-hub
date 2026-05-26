/**
 * POST /api/admin/av/clients/[client_id]/find-leads
 *
 * Operator-triggered, CLIENT-SCOPED lead discovery. Runs the exact same engine as
 * the client portal's "Find new leads" (lib/apollo + lib/google_places) but for a
 * specified client_id, so every lead it finds is stamped with THAT client's
 * client_id — it lands in the client's own hub, never in the operator AV/EBW
 * pipeline. Lets val find a small, controlled, one-time batch for Mike/Skip
 * without switching accounts or mixing pipelines.
 *
 * Body: { limit?: number }  // how many to pull this run (1..25, default 10)
 *
 * Quality + cost control: the operator picks the count; the per-account monthly
 * cap (schema 049, if set) is respected as a ceiling. Owner + staff only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { getAvDb } from '@/lib/db/av';
import { logEvent } from '@/lib/events/log';
import {
  getClientIcp,
  saveClientIcp,
  suggestIcpFromIntake,
  hasUsableIcp,
  icpToApolloFilters,
  type ClientIcp
} from '@/lib/client/icp';
import { getBriefPayload } from '@/lib/client/brief_store';
import { getClientLeadCapOverride } from '@/lib/av/client_access';
import { runDiscoveryBatch } from '@/lib/apollo/discoverer';
import { runPlacesDiscoveryBatch } from '@/lib/google_places/discoverer';
import type { RowDataPacket } from 'mysql2';

export const runtime = 'nodejs';
export const maxDuration = 60;

const DEFAULT_LIMIT = 10;
const MAX_PER_RUN = 25;

function placesQueryFromIcp(icp: ClientIcp): string | null {
  const kw = icp.industries.join(' ').trim();
  const loc = icp.geographies.join(', ').trim();
  if (!kw && !loc) return null;
  return [kw, loc ? `in ${loc}` : ''].join(' ').trim();
}

async function monthlyUsage(clientId: number): Promise<number> {
  const db = getAvDb();
  const [rows] = await db.execute<(RowDataPacket & { n: number | string })[]>(
    `SELECT COUNT(*) AS n FROM leads
      WHERE client_id = ? AND source_type = 'api' AND archived_at IS NULL
        AND YEAR(last_activity_at) = YEAR(UTC_TIMESTAMP())
        AND MONTH(last_activity_at) = MONTH(UTC_TIMESTAMP())`,
    [clientId]
  );
  return Number(rows[0]?.n ?? 0);
}

export async function POST(req: NextRequest, { params }: { params: { client_id: string } }) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/av/clients/find-leads:POST', tenantId: 'av' });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const clientId = Number.parseInt(params.client_id, 10);
  if (!Number.isFinite(clientId) || clientId <= 0) return NextResponse.json({ error: 'invalid client id' }, { status: 400 });

  let body: Record<string, unknown> = {};
  try { body = (await req.json()) as Record<string, unknown>; } catch { /* default limit */ }
  const reqLimit = Number.parseInt(String(body.limit ?? DEFAULT_LIMIT), 10);
  const limit = Number.isFinite(reqLimit) ? Math.max(1, Math.min(MAX_PER_RUN, reqLimit)) : DEFAULT_LIMIT;

  try {
    // 1. Resolve the client's ICP; if none, derive it from their intake/brief and
    //    save it so the next run reuses it. No ICP + no intake -> can't search.
    let icp = await getClientIcp(clientId);
    if (!hasUsableIcp(icp)) {
      try {
        const suggested = suggestIcpFromIntake(await getBriefPayload('av', clientId));
        if (hasUsableIcp(suggested)) {
          await saveClientIcp(clientId, suggested, null);
          icp = suggested;
        }
      } catch { /* fall through to the guard below */ }
    }
    if (!hasUsableIcp(icp)) {
      return NextResponse.json(
        { error: 'icp_incomplete', message: 'No ideal-client profile yet. Fill their intake (industry, location, or company size) so discovery knows who to find.' },
        { status: 400 }
      );
    }

    // 2. Respect the per-account monthly cap (rail) if one is set.
    const cap = await getClientLeadCapOverride(clientId);
    const used = cap != null ? await monthlyUsage(clientId) : 0;
    let budget = limit;
    if (cap != null) {
      const remaining = Math.max(0, cap - used);
      if (remaining <= 0) {
        return NextResponse.json(
          { error: 'cap_reached', message: `This account's monthly lead cap (${cap}) is reached. Raise it on this page to find more.`, usage: { usedThisMonth: used, monthlyCap: cap } },
          { status: 429 }
        );
      }
      budget = Math.min(limit, remaining);
    }

    let inserted = 0, duplicates = 0, attempted = 0;
    const notes: string[] = [];

    // 3. Apollo (B2B companies by ICP) — scoped to THIS client.
    try {
      const summary = await runDiscoveryBatch({
        filters: icpToApolloFilters(icp, { perPage: budget }),
        triggerSource: 'manual',
        clientId,
        excludeIndustries: icp.excludedIndustries,
        actorUserId: guard.actor.userId ?? null
      });
      inserted += summary.inserted;
      duplicates += summary.duplicates;
      attempted += summary.attempted;
      if (summary.stoppedEarlyReason) notes.push(`apollo: ${summary.stoppedEarlyReason}`);
    } catch (e) {
      notes.push(`apollo failed: ${(e as Error).message.slice(0, 120)}`);
    }

    // 4. Google Places (local businesses) if the ICP yields a text query.
    const placesQuery = placesQueryFromIcp(icp);
    if (placesQuery && inserted < budget) {
      try {
        const p = await runPlacesDiscoveryBatch(
          { textQuery: placesQuery, pageSize: Math.min(20, budget) },
          { clientId }
        );
        inserted += p.insertedCount;
        duplicates += p.duplicateCount;
        attempted += p.resultsCount;
      } catch (e) {
        notes.push(`places failed: ${(e as Error).message.slice(0, 120)}`);
      }
    }

    await logEvent({
      eventType: 'lead.client_discovery',
      userId: guard.actor.userId ?? null,
      source: 'operator_find_leads',
      payload: { client_id: clientId, inserted, duplicates, attempted, budget, notes }
    }).catch(() => {});

    const message = inserted > 0
      ? `Found ${inserted} new lead${inserted === 1 ? '' : 's'} for this client (${duplicates} already in their hub). Review them in their pipeline.`
      : notes.length
        ? `No new leads this run. ${notes.join('; ')}`
        : 'No new matches this run. Try broadening their ICP (industry / location).';

    return NextResponse.json({ ok: true, inserted, duplicates, attempted, message });
  } catch (err) {
    return NextResponse.json({ error: 'discovery failed', errorClass: (err as Error).name }, { status: 500 });
  }
}
