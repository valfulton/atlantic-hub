/**
 * POST /api/admin/av/discover/places
 *
 * Google Places (New) Text Search → insert as leads. Hospitality-friendly:
 * unlike Apollo, Google Places covers small/independent USVI businesses
 * (boutique hotels, family restaurants, marinas) that Apollo's B2B
 * universe doesn't include.
 *
 * Body:
 *   {
 *     textQuery: string,              // REQUIRED, e.g. "boutique hotels in St. Croix USVI"
 *     includedType?: string,          // 'restaurant' | 'lodging' | 'tourist_attraction' | etc.
 *     locationBias?: { latitude: number; longitude: number; radius: number },
 *     pageSize?: number,              // 1-20, default 20
 *     pageToken?: string,             // continuation for paging
 *     openNow?: boolean
 *   }
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { isFlagEnabled } from '@/lib/feature-flags';
import { runPlacesDiscoveryBatch } from '@/lib/google_places/discoverer';
import { assignDiscoveredLeads, parseAssignToUserId } from '@/lib/leads/assign_discovered';
import { GooglePlacesApiKeyMissingError, GooglePlacesApiError, type TextSearchFilters } from '@/lib/google_places/search';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/discover/places',
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

  const textQuery = typeof payload.textQuery === 'string' ? payload.textQuery.trim() : '';
  if (!textQuery) {
    return NextResponse.json({ error: 'textQuery is required (a free-text search like \"boutique hotels in St. Croix\")' }, { status: 400 });
  }

  const filters: TextSearchFilters = {
    textQuery,
    pageSize: Math.min(20, Math.max(1, Number(payload.pageSize) || 20))
  };
  if (typeof payload.includedType === 'string' && payload.includedType.trim()) {
    filters.includedType = payload.includedType.trim();
  }
  if (typeof payload.pageToken === 'string' && payload.pageToken) {
    filters.pageToken = payload.pageToken;
  }
  if (typeof payload.openNow === 'boolean') {
    filters.openNow = payload.openNow;
  }
  if (payload.locationBias && typeof payload.locationBias === 'object') {
    const lb = payload.locationBias as { latitude?: unknown; longitude?: unknown; radius?: unknown };
    if (typeof lb.latitude === 'number' && typeof lb.longitude === 'number' && typeof lb.radius === 'number') {
      filters.locationBias = { latitude: lb.latitude, longitude: lb.longitude, radius: lb.radius };
    }
  }

  // Optional destination: stamp results to a client's hub instead of the AV pipeline.
  const destClientId =
    typeof payload.clientId === 'number' && Number.isInteger(payload.clientId) && payload.clientId > 0
      ? payload.clientId
      : null;
  const assignToUserId = destClientId ? null : parseAssignToUserId(payload);

  try {
    const batch = await runPlacesDiscoveryBatch(filters, { clientId: destClientId });
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
      source: 'google_places',
      resultsCount: batch.resultsCount,
      insertedCount: batch.insertedCount,
      duplicateCount: batch.duplicateCount,
      nextPageToken: batch.nextPageToken,
      results: batch.results
    });
  } catch (err) {
    if (err instanceof GooglePlacesApiKeyMissingError) {
      return NextResponse.json(
        { error: 'GOOGLE_PLACES_API_KEY not configured in Netlify. Add it under Site → Environment variables.' },
        { status: 503 }
      );
    }
    if (err instanceof GooglePlacesApiError) {
      return NextResponse.json({ error: 'google places api error', detail: err.body.slice(0, 500), status: err.status }, { status: 502 });
    }
    console.error('[av:discover:places]', (err as Error).message);
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}
