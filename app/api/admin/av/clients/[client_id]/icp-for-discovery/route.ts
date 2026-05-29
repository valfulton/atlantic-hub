/**
 * GET /api/admin/av/clients/[client_id]/icp-for-discovery  (#238)
 *
 * Returns a client's stored ICP shaped for the operator "Find new leads" page,
 * so when val picks a client from the destination dropdown the search filters
 * (locations / industries / employee-size ranges) auto-fill from THIS client's
 * saved ICP instead of forcing her to type them.
 *
 * Read-only. Owner / staff only via guardAdminRequest. Returns:
 *   { industries: string[], geographies: string[], excludedIndustries: string[],
 *     employeeRanges: string[] }
 *
 * employeeRanges are pre-bucketed into the same "min,max" string format the
 * Apollo discover form uses (e.g. "1,10" / "11,50" / "51,200" / "201,500" /
 * "501,1000" / "1001,5000" / "5001,1000000") so the form can re-select pills
 * without translating ranges client-side.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { getClientIcp } from '@/lib/client/icp';

export const runtime = 'nodejs';
export const maxDuration = 10;

// Pre-bucket boundaries used by the discover form's pills. Keep in sync with
// DiscoverForm.EMPLOYEE_RANGES.
const RANGE_BUCKETS: { min: number; max: number; value: string }[] = [
  { min: 1,    max: 10,      value: '1,10' },
  { min: 11,   max: 50,      value: '11,50' },
  { min: 51,   max: 200,     value: '51,200' },
  { min: 201,  max: 500,     value: '201,500' },
  { min: 501,  max: 1000,    value: '501,1000' },
  { min: 1001, max: 5000,    value: '1001,5000' },
  { min: 5001, max: 1000000, value: '5001,1000000' }
];

/**
 * Map the client's stored companySizeMin/Max (single int range) onto the
 * discover form's bucketed pills. Every bucket that overlaps [min, max] is
 * selected so a client with size 30-150 picks both "11-50" and "51-200".
 */
function bucketsForRange(min: number | null, max: number | null): string[] {
  if (min == null && max == null) return [];
  const lo = min ?? 1;
  const hi = max ?? 1_000_000;
  return RANGE_BUCKETS
    .filter((b) => b.max >= lo && b.min <= hi)
    .map((b) => b.value);
}

export async function GET(req: NextRequest, { params }: { params: { client_id: string } }) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/clients/[client_id]/icp-for-discovery:GET',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const clientId = Number.parseInt(params.client_id, 10);
  if (!Number.isFinite(clientId) || clientId <= 0) {
    return NextResponse.json({ error: 'invalid client_id' }, { status: 400 });
  }

  try {
    const icp = await getClientIcp(clientId);
    return NextResponse.json({
      ok: true,
      industries: icp.industries,
      geographies: icp.geographies,
      excludedIndustries: icp.excludedIndustries,
      employeeRanges: bucketsForRange(icp.companySizeMin, icp.companySizeMax)
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'server error', errorClass: (err as Error).name },
      { status: 500 }
    );
  }
}
