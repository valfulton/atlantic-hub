/**
 * POST /api/admin/av/discover
 *
 * Apollo company-discovery endpoint. Calls organizations/search to find
 * companies matching the operator's ICP, inserts each as a lead with
 * company-level data only. Daily Hunter cron then enriches with real
 * contact info.
 *
 * Body (all optional except at least one filter required):
 *   {
 *     qOrganizationName: string,
 *     organizationLocations: string[],
 *     organizationNotLocations: string[],
 *     qOrganizationDomainsList: string[],
 *     qOrganizationKeywordTags: string[],
 *     organizationNumEmployeesRanges: string[],
 *     page: number,
 *     perPage: number
 *   }
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { isFlagEnabled } from '@/lib/feature-flags';
import { runDiscoveryBatch } from '@/lib/apollo/discoverer';
import type { ApolloOrgSearchFilters } from '@/lib/apollo/search';

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

  const filters: ApolloOrgSearchFilters = {
    qOrganizationName: typeof payload.qOrganizationName === 'string' && payload.qOrganizationName.trim()
      ? payload.qOrganizationName.trim()
      : undefined,
    organizationLocations: parseStringArray(payload.organizationLocations),
    organizationNotLocations: parseStringArray(payload.organizationNotLocations),
    qOrganizationDomainsList: parseStringArray(payload.qOrganizationDomainsList),
    qOrganizationKeywordTags: parseStringArray(payload.qOrganizationKeywordTags),
    organizationNumEmployeesRanges: parseStringArray(payload.organizationNumEmployeesRanges),
    page: typeof payload.page === 'number' && Number.isFinite(payload.page) ? Math.max(1, Math.floor(payload.page)) : 1,
    perPage: typeof payload.perPage === 'number' && Number.isFinite(payload.perPage)
      ? Math.max(1, Math.min(100, Math.floor(payload.perPage)))
      : 25
  };

  const hasAnyFilter =
    !!filters.qOrganizationName ||
    !!filters.organizationLocations ||
    !!filters.qOrganizationDomainsList ||
    !!filters.qOrganizationKeywordTags ||
    !!filters.organizationNumEmployeesRanges;

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
