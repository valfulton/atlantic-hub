/**
 * /api/client/discover  (client-scoped lead discovery)
 *
 * GET  -> returns the client's saved ICP + this-month usage/quota.
 * POST -> optionally saves an updated ICP, then runs Apollo discovery scoped
 *         to THIS client's hub (leads.client_id = their account). Reuses the
 *         exact operator engine (lib/apollo/discoverer) with clientId threaded
 *         through; provider keys stay server-side and are never exposed.
 *
 * Guards:
 *   - middleware (matcher /api/client/discover) sets x-ah-client-user-id.
 *   - audit_only tier is blocked (discovery is a Sprint+ capability).
 *   - per-client monthly cap by tier (today's Apollo ceiling is operator-wide;
 *     this adds per-account cost control).
 */
import { NextRequest, NextResponse } from 'next/server';
import { readClientActorFromHeaders } from '@/lib/auth/client-session';
import { findClientUserById, type ClientUserTier } from '@/lib/auth/client-user';
import { ensureClientHub } from '@/lib/client/provision';
import {
  getClientIcp,
  saveClientIcp,
  normalizeIcp,
  hasUsableIcp,
  icpToApolloFilters
} from '@/lib/client/icp';
import { runDiscoveryBatch } from '@/lib/apollo/discoverer';
import { runPlacesDiscoveryBatch } from '@/lib/google_places/discoverer';
import { logEvent } from '@/lib/events/log';
import { getAvDb } from '@/lib/db/av';
import type { ClientIcp } from '@/lib/client/icp';
import type { RowDataPacket } from 'mysql2';

/**
 * Build a Google Places free-text query from the ICP. Places needs a textQuery
 * (industry/keywords + location); returns null when the ICP lacks both so we
 * skip Places and let Apollo carry the run.
 */
function placesQueryFromIcp(icp: ClientIcp): string | null {
  const kw = icp.industries.join(' ').trim();
  const loc = icp.geographies.join(', ').trim();
  if (!kw && !loc) return null;
  return [kw, loc ? `in ${loc}` : ''].join(' ').trim();
}

export const runtime = 'nodejs';
export const maxDuration = 60;

/** Results pulled per run + monthly discovered-lead cap, by tier. */
const TIER_PER_RUN: Record<ClientUserTier, number> = { audit_only: 0, sprint: 12, momentum: 20, scale: 25 };
const TIER_MONTHLY_CAP: Record<ClientUserTier, number> = { audit_only: 0, sprint: 150, momentum: 500, scale: 1500 };

async function monthlyUsage(clientId: number): Promise<number> {
  const db = getAvDb();
  const [rows] = await db.execute<(RowDataPacket & { n: number | string })[]>(
    `SELECT COUNT(*) AS n FROM leads
      WHERE client_id = ?
        AND source_type = 'api'
        AND archived_at IS NULL
        AND YEAR(last_activity_at) = YEAR(UTC_TIMESTAMP())
        AND MONTH(last_activity_at) = MONTH(UTC_TIMESTAMP())`,
    [clientId]
  );
  return Number(rows[0]?.n ?? 0);
}

async function resolveClient(req: NextRequest) {
  const actor = readClientActorFromHeaders(req.headers);
  if (!actor) return { error: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) };
  const user = await findClientUserById(actor.clientUserId);
  if (!user) return { error: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) };
  let clientId = Number(user.client_id) || 0;
  if (clientId <= 0) {
    clientId = (await ensureClientHub(user)) ?? 0;
  }
  if (clientId <= 0) {
    return { error: NextResponse.json({ error: 'workspace_not_ready' }, { status: 409 }) };
  }
  return { user, clientId };
}

export async function GET(req: NextRequest) {
  const r = await resolveClient(req);
  if ('error' in r) return r.error;
  const { user, clientId } = r;
  try {
    const [icp, used] = await Promise.all([getClientIcp(clientId), monthlyUsage(clientId)]);
    return NextResponse.json({
      icp,
      tier: user.tier,
      locked: user.tier === 'audit_only',
      usage: { usedThisMonth: used, monthlyCap: TIER_MONTHLY_CAP[user.tier], perRun: TIER_PER_RUN[user.tier] }
    });
  } catch (err) {
    console.error('[client:discover:get]', (err as Error).message);
    return NextResponse.json({ error: 'server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const r = await resolveClient(req);
  if ('error' in r) return r.error;
  const { user, clientId } = r;

  if (user.tier === 'audit_only') {
    return NextResponse.json({ error: 'upgrade_required', message: 'Lead discovery is available on the Sprint plan and above.' }, { status: 403 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    /* empty body is fine: run with saved ICP */
  }

  try {
    // Persist an inbound ICP if provided, then always run from the stored one.
    if (body.icp && typeof body.icp === 'object') {
      await saveClientIcp(clientId, normalizeIcp(body.icp as Record<string, unknown>), user.client_user_id);
    }
    const icp = await getClientIcp(clientId);
    if (!hasUsableIcp(icp)) {
      return NextResponse.json(
        { error: 'icp_incomplete', message: 'Add at least an industry, a location, or a company size to find leads.' },
        { status: 400 }
      );
    }

    const cap = TIER_MONTHLY_CAP[user.tier];
    const used = await monthlyUsage(clientId);
    if (used >= cap) {
      return NextResponse.json(
        { error: 'monthly_cap_reached', message: `You've reached this month's discovery limit (${cap}).`, usage: { usedThisMonth: used, monthlyCap: cap } },
        { status: 429 }
      );
    }

    const perRun = TIER_PER_RUN[user.tier];
    const budget = Math.min(perRun, Math.max(1, cap - used));

    // Run multiple sources behind the single client action. Each source is
    // isolated: if one provider fails, the other still contributes, and the
    // client never sees the raw error — we record it for the operator instead.
    let inserted = 0;
    let duplicates = 0;
    let attempted = 0;
    let anyError = false;

    // 1) Apollo (B2B companies by ICP).
    try {
      const summary = await runDiscoveryBatch({
        filters: icpToApolloFilters(icp, { perPage: budget }),
        triggerSource: 'manual',
        clientId,
        actorUserId: null
      });
      inserted += summary.inserted;
      duplicates += summary.duplicates;
      attempted += summary.attempted;
      if (summary.stoppedEarlyReason) {
        anyError = true;
        await logEvent({
          eventType: 'workflow.failed',
          source: 'client_discovery',
          status: 'failure',
          payload: { client_id: clientId, stage: 'apollo', reason: summary.stoppedEarlyReason }
        });
      }
    } catch (e) {
      anyError = true;
      await logEvent({
        eventType: 'workflow.failed',
        source: 'client_discovery',
        status: 'failure',
        payload: { client_id: clientId, stage: 'apollo' },
        errorMessage: (e as Error).message.slice(0, 500)
      });
    }

    // 2) Google Places (local/hospitality), only if the ICP yields a query.
    const placesQuery = placesQueryFromIcp(icp);
    if (placesQuery) {
      try {
        const p = await runPlacesDiscoveryBatch(
          { textQuery: placesQuery, pageSize: Math.min(20, budget) },
          { clientId }
        );
        inserted += p.insertedCount;
        duplicates += p.duplicateCount;
        attempted += p.resultsCount;
      } catch (e) {
        anyError = true;
        await logEvent({
          eventType: 'workflow.failed',
          source: 'client_discovery',
          status: 'failure',
          payload: { client_id: clientId, stage: 'places' },
          errorMessage: (e as Error).message.slice(0, 500)
        });
      }
    }

    const usedAfter = await monthlyUsage(clientId);

    // Client-safe message: calm + generic, no provider/error detail.
    let message: string;
    if (inserted > 0) {
      message = `Found ${inserted} new lead${inserted === 1 ? '' : 's'}. They're being scored and will appear below.`;
    } else if (anyError) {
      message = 'We hit a brief snag finding leads. Please try again in a moment.';
    } else {
      message = 'No new matches this run. Try broadening your industries or locations.';
    }

    return NextResponse.json({
      ok: true,
      inserted,
      duplicates,
      attempted,
      message,
      usage: { usedThisMonth: usedAfter, monthlyCap: cap }
    });
  } catch (err) {
    // Unexpected failure: log for operator, return a calm client message.
    console.error('[client:discover:post]', (err as Error).message);
    await logEvent({
      eventType: 'workflow.failed',
      source: 'client_discovery',
      status: 'failure',
      payload: { client_id: clientId, stage: 'route' },
      errorMessage: (err as Error).message.slice(0, 500)
    }).catch(() => {});
    return NextResponse.json(
      { error: 'discovery_failed', message: 'We hit a brief snag finding leads. Please try again in a moment.' },
      { status: 500 }
    );
  }
}
