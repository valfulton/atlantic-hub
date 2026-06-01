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
import { getBriefSeed } from '@/lib/client/brief_store';

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

/**
 * Crude tokenizer for the free-text intake fields (ideal_client, geo_focus).
 * Splits on commas / semicolons / pipes / " and " / newlines, trims, strips
 * obvious noise. Not a parser — just gets the operator unblocked when their
 * structured ICP table is empty but their intake is rich.
 */
function tokenizeFreeText(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[,;|\n]| and /i)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2 && s.length <= 80);
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

    // Primary path: the curated ICP table has values, use them as-is.
    let industries = icp.industries;
    let geographies = icp.geographies;
    let employeeRanges = bucketsForRange(icp.companySizeMin, icp.companySizeMax);
    let source: 'icp' | 'brief_fallback' | 'mixed' | 'none' =
      industries.length || geographies.length || employeeRanges.length ? 'icp' : 'none';

    // Fallback (#95 followup): the ICP table is empty for keys val didn't
    // explicitly curate. Read the brief seed and use ideal_client / geo_focus
    // as a stop-gap so "Find leads for Tim" works the moment his intake is in
    // — operator doesn't have to also fill IcpEditor by hand. This is
    // imperfect (free-text split, no semantic weighting) but it's the
    // difference between "form auto-fills" and "form sits empty."
    if (industries.length === 0 || geographies.length === 0) {
      const seed = await getBriefSeed('av', clientId);
      if (seed) {
        if (industries.length === 0 && seed.audience) {
          industries = tokenizeFreeText(seed.audience).slice(0, 8);
        }
        if (geographies.length === 0 && seed.geoFocus) {
          geographies = tokenizeFreeText(seed.geoFocus).slice(0, 5);
        }
        // Mark mixed (some from ICP, some inferred) vs pure brief_fallback.
        const usedFallback = (industries.length > 0 || geographies.length > 0);
        if (usedFallback) {
          source = source === 'none' ? 'brief_fallback' : 'mixed';
        }
      }
    }

    return NextResponse.json({
      ok: true,
      industries,
      geographies,
      excludedIndustries: icp.excludedIndustries,
      // (#307) Surface excludeGeographies too. The form was silently dropping
      // both excludes — val saved 8 fields and only 3 showed up.
      excludeGeographies: icp.excludeGeographies,
      employeeRanges,
      source,
      hint:
        source === 'brief_fallback' || source === 'mixed'
          ? 'Some fields were inferred from the brief because this client\'s ICP table is empty. Open IcpEditor on their client page to curate it.'
          : null
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'server error', errorClass: (err as Error).name },
      { status: 500 }
    );
  }
}
