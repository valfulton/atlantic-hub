/**
 * POST /api/admin/av/discover/instagram
 *
 * Apify Instagram Profile Scraper → insert as leads. Built for the USVI
 * boutique businesses that live on IG but don't show up in Apollo or
 * sometimes even Google Places.
 *
 * Body:
 *   { usernames: ["@thebahamastrails", "stcroix_dive"] }
 *
 * Accepts handles in any common format — @handle, raw handle, full IG URL.
 * Normalizes internally. Batches >25 are rejected (use multiple calls so
 * the sync run stays under 5min).
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { isFlagEnabled } from '@/lib/feature-flags';
import { runInstagramDiscoveryBatch } from '@/lib/apify/discoverer';
import { assignDiscoveredLeads, parseAssignToUserId } from '@/lib/leads/assign_discovered';
import { ApifyTokenMissingError, ApifyApiError, normalizeInstagramHandle } from '@/lib/apify/instagram';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_BATCH = 25;

export async function POST(req: NextRequest) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/discover/instagram',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  if (!(await isFlagEnabled('tab_av_enabled'))) {
    return NextResponse.json({ error: 'av tab disabled' }, { status: 403 });
  }

  let payload: Record<string, unknown> = {};
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json body' }, { status: 400 });
  }

  const rawUsernames = Array.isArray(payload.usernames) ? payload.usernames : [];
  const usernames = rawUsernames
    .filter((u): u is string => typeof u === 'string')
    .map((u) => normalizeInstagramHandle(u))
    .filter((u): u is string => !!u);

  if (usernames.length === 0) {
    return NextResponse.json(
      { error: 'usernames must be a non-empty array of Instagram handles (@foo, foo, or https://instagram.com/foo)' },
      { status: 400 }
    );
  }
  if (usernames.length > MAX_BATCH) {
    return NextResponse.json(
      { error: `batch too large — max ${MAX_BATCH} usernames per call to keep the run under 5 minutes` },
      { status: 400 }
    );
  }

  const destClientId =
    typeof payload.clientId === 'number' && Number.isInteger(payload.clientId) && payload.clientId > 0
      ? payload.clientId
      : null;
  const assignToUserId = destClientId ? null : parseAssignToUserId(payload);

  try {
    const batch = await runInstagramDiscoveryBatch(usernames, { clientId: destClientId });
    if (assignToUserId) {
      const leadIds = batch.results
        .filter((r) => r.outcome === 'inserted' && typeof r.leadId === 'number')
        .map((r) => r.leadId);
      await assignDiscoveredLeads(leadIds, assignToUserId, guard.actor.userId ?? null);
    }

    // (#240) Autopilot: score newly-inserted leads against the client's ICP.
    if (destClientId && batch.insertedCount > 0) {
      void import('@/lib/client/autopilot').then(({ maybeScoreDiscoveryBatch }) =>
        maybeScoreDiscoveryBatch({
          clientId: destClientId,
          insertedCount: batch.insertedCount
        }).catch(() => undefined)
      );
    }

    return NextResponse.json({
      source: 'instagram',
      inputCount: usernames.length,
      resolvedCount: batch.resolvedCount,
      insertedCount: batch.insertedCount,
      duplicateCount: batch.duplicateCount,
      results: batch.results
    });
  } catch (err) {
    if (err instanceof ApifyTokenMissingError) {
      return NextResponse.json(
        { error: 'APIFY_API_TOKEN not configured in Netlify. Add it under Site → Environment variables.' },
        { status: 503 }
      );
    }
    if (err instanceof ApifyApiError) {
      return NextResponse.json({ error: 'apify api error', detail: err.body.slice(0, 500), status: err.status }, { status: 502 });
    }
    console.error('[av:discover:instagram]', (err as Error).message);
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}
