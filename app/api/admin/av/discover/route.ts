/**
 * POST /api/admin/av/discover
 *
 * Manual-trigger Apollo discovery. Called by the form on /admin/av/discover.
 *
 * Body shape (all fields optional except at least one filter must be set):
 *   {
 *     personTitles: string[],
 *     personLocations: string[],
 *     organizationLocations: string[],
 *     organizationIndustries: string[],
 *     organizationNumEmployeesRanges: string[],
 *     qKeywords: string,
 *     page: number,
 *     perPage: number
 *   }
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { isFlagEnabled } from '@/lib/feature-flags';
import { runDiscoveryBatch } from '@/lib/apollo/discoverer';
import type { ApolloSearchFilters } from '@/lib/apollo/search';

export const runtime = 'nodejs';
export const maxDuration = 60;

function parseStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const cleaned = v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((s) => s.trim());
  return cleaned.length > 0 ? cleaned : undefined;
}

export async function POST(req: NextRequest) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/discover',
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
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const VALID_SENIORITIES = new Set([
    'owner', 'founder', 'c_suite', 'partner', 'vp',
    'head', 'director', 'manager', 'senior', 'entry', 'intern'
  ]);
  const senioritiesRaw = parseStringArray(payload.personSeniorities);
  const personSeniorities = senioritiesRaw
    ? senioritiesRaw.filter((s) => VALID_SENIORITIES.has(s)) as ApolloSearchFilters['personSeniorities']
    : undefined;

  const filters: ApolloSearchFilters = {
    personTitles: parseStringArray(payload.personTitles),
    personSeniorities,
    personLocations: parseStringArray(payload.personLocations),
    organizationLocations: parseStringArray(payload.organizationLocations),
    qOrganizationDomainsList: parseStringArray(payload.qOrganizationDomainsList),
    organizationIndustries: parseStringArray(payload.organizationIndustries),
    organizationNumEmployeesRanges: parseStringArray(payload.organizationNumEmployeesRanges),
    qKeywords: typeof payload.qKeywords === 'string' && payload.qKeywords.trim() ? payload.qKeywords.trim() : undefined,
    page: typeof payload.page === 'number' && Number.isFinite(payload.page) ? Math.max(1, Math.floor(payload.page)) : 1,
    perPage: typeof payload.perPage === 'number' && Number.isFinite(payload.perPage)
      ? Math.max(1, Math.min(100, Math.floor(payload.perPage)))
      : 25
  };

  // Require at least one filter (no "search the world" calls)
  const hasAnyFilter =
    !!filters.personTitles ||
    (!!filters.personSeniorities && filters.personSeniorities.length > 0) ||
    !!filters.personLocations ||
    !!filters.organizationLocations ||
    !!filters.qOrganizationDomainsList ||
    !!filters.organizationIndustries ||
    !!filters.organizationNumEmployeesRanges ||
    !!filters.qKeywords;

  if (!hasAnyFilter) {
    return NextResponse.json(
      { error: 'at_least_one_filter_required' },
      { status: 400 }
    );
  }

  try {
    const summary = await runDiscoveryBatch({
      filters,
      triggerSource: 'manual',
      actorUserId: guard.actor.userId
    });
    return NextResponse.json(summary);
  } catch (err) {
    console.error('[av:discover:post]', (err as Error).message);
    return NextResponse.json(
      { error: 'discovery_run_failed', errorClass: (err as Error).name, message: (err as Error).message },
      { status: 500 }
    );
  }
}
