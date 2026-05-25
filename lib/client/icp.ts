/**
 * lib/client/icp.ts
 *
 * A client's Ideal Customer Profile (ICP) -- the description of who THEY want
 * to reach -- and the mapping that turns it into Apollo discovery filters.
 *
 * This is the seed of client-run discovery: a client like CBB arrives with
 * zero leads, describes their ideal customer once, and the engine finds
 * matching companies into their own hub. Stored in the (previously dormant)
 * client_icps table, one row per client (UNIQUE client_id).
 *
 * Note: client_icps was originally shaped for a content-digest feature, so we
 * repurpose a couple of columns for discovery: target_geographies = locations,
 * excluded_topics = locations to exclude. Documented here so it isn't a
 * mystery later.
 */
import { getAvDb } from '@/lib/db/av';
import type { ApolloOrgSearchFilters } from '@/lib/apollo/search';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

export interface ClientIcp {
  /** Industries / keywords describing the target company (Apollo keyword tags). */
  industries: string[];
  /** Target HQ locations (city / state / country). */
  geographies: string[];
  /** Locations to exclude. */
  excludeGeographies: string[];
  /** Company size band (employees). */
  companySizeMin: number | null;
  companySizeMax: number | null;
  /** Freeform note describing the ideal client (operator + client reference). */
  description: string;
}

export const EMPTY_ICP: ClientIcp = {
  industries: [],
  geographies: [],
  excludeGeographies: [],
  companySizeMin: null,
  companySizeMax: null,
  description: ''
};

interface IcpRow extends RowDataPacket {
  target_industries: unknown;
  target_geographies: unknown;
  excluded_topics: unknown;
  target_company_size_min: number | null;
  target_company_size_max: number | null;
  description: string | null;
}

/** mysql2 returns JSON columns already-parsed, but tolerate strings too. */
function asStringArray(v: unknown): string[] {
  let val: unknown = v;
  if (typeof val === 'string') {
    const str = val;
    try {
      val = JSON.parse(str);
    } catch {
      return str.trim() ? [str.trim()] : [];
    }
  }
  if (!Array.isArray(val)) return [];
  return val.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((s) => s.trim());
}

function clampSize(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

/** Read the client's saved ICP, or EMPTY_ICP if none. */
export async function getClientIcp(clientId: number): Promise<ClientIcp> {
  if (!clientId || clientId <= 0) return { ...EMPTY_ICP };
  const db = getAvDb();
  const [rows] = await db.execute<IcpRow[]>(
    `SELECT target_industries, target_geographies, excluded_topics,
            target_company_size_min, target_company_size_max, description
       FROM client_icps WHERE client_id = ? LIMIT 1`,
    [clientId]
  );
  const r = rows[0];
  if (!r) return { ...EMPTY_ICP };
  return {
    industries: asStringArray(r.target_industries),
    geographies: asStringArray(r.target_geographies),
    excludeGeographies: asStringArray(r.excluded_topics),
    companySizeMin: clampSize(r.target_company_size_min),
    companySizeMax: clampSize(r.target_company_size_max),
    description: typeof r.description === 'string' ? r.description : ''
  };
}

/** Normalize a raw inbound ICP (from a form/JSON body) into a clean ClientIcp. */
export function normalizeIcp(raw: Record<string, unknown> | null | undefined): ClientIcp {
  const r = raw ?? {};
  return {
    industries: asStringArray(r.industries),
    geographies: asStringArray(r.geographies),
    excludeGeographies: asStringArray(r.excludeGeographies),
    companySizeMin: clampSize(r.companySizeMin),
    companySizeMax: clampSize(r.companySizeMax),
    description: typeof r.description === 'string' ? r.description.slice(0, 2000) : ''
  };
}

/** Upsert the client's ICP (one row per client). */
export async function saveClientIcp(clientId: number, icp: ClientIcp, userId?: number | null): Promise<void> {
  if (!clientId || clientId <= 0) throw new Error('saveClientIcp: invalid clientId');
  const db = getAvDb();
  await db.execute<ResultSetHeader>(
    `INSERT INTO client_icps
       (client_id, target_industries, target_geographies, excluded_topics,
        target_company_size_min, target_company_size_max, description, updated_by_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       target_industries = VALUES(target_industries),
       target_geographies = VALUES(target_geographies),
       excluded_topics = VALUES(excluded_topics),
       target_company_size_min = VALUES(target_company_size_min),
       target_company_size_max = VALUES(target_company_size_max),
       description = VALUES(description),
       updated_by_user_id = VALUES(updated_by_user_id)`,
    [
      clientId,
      JSON.stringify(icp.industries),
      JSON.stringify(icp.geographies),
      JSON.stringify(icp.excludeGeographies),
      icp.companySizeMin,
      icp.companySizeMax,
      icp.description || null,
      userId ?? null
    ]
  );
}

/**
 * Build a STARTER ICP from a client's intake submission so their discovery
 * panel is pre-filled the first time they open it (rather than blank). We map
 * what intake captured -> ICP: industry -> industries, message/challenge ->
 * notes. Locations aren't captured at intake, so the client adds those.
 * Returned as a suggestion; it's only persisted when they first run discovery.
 */
export function suggestIcpFromIntake(raw: unknown): ClientIcp {
  let p: Record<string, unknown> | null = null;
  try {
    p = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Record<string, unknown> | null;
  } catch {
    p = null;
  }
  if (!p || typeof p !== 'object') return { ...EMPTY_ICP };

  // First non-empty string among several possible field names (the live intake
  // form, the operator brief, and the canonical brief all use different names).
  const pick = (...keys: string[]): string => {
    for (const k of keys) {
      const v = (p as Record<string, unknown>)[k];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return '';
  };
  // Split a freeform field into list items on commas / semicolons / newlines.
  const list = (s: string): string[] =>
    s ? s.split(/[\n;,]+/).map((x) => x.trim()).filter(Boolean).slice(0, 8) : [];

  // Industries / keyword tags: the client's industry + any explicit keywords.
  const industries = Array.from(new Set([
    ...list(pick('industry')),
    ...list(pick('keywords', 'target_keywords'))
  ]));

  // Geographies: the intake's geo focus (the form captures geo_focus).
  const geographies = list(pick('geo_focus', 'geographies', 'location', 'target_geographies'));

  // Company size: parse a band like "10-50", "50+", "200 employees".
  let companySizeMin: number | null = null;
  let companySizeMax: number | null = null;
  const sizeStr = pick('company_size', 'target_company_size', 'companySize');
  if (sizeStr) {
    const nums = (sizeStr.match(/\d[\d,]*/g) || []).map((n) => clampSize(n.replace(/,/g, ''))).filter((n): n is number => n != null);
    if (nums.length >= 2) { companySizeMin = Math.min(nums[0], nums[1]); companySizeMax = Math.max(nums[0], nums[1]); }
    else if (nums.length === 1) { companySizeMin = nums[0]; }
  }

  // Description: the richest signal we have for who they want to reach.
  const description = pick(
    'key_message', 'target_audience', 'ideal_client', 'audience_insights',
    'business_description', 'message', 'challenge'
  );

  return {
    ...EMPTY_ICP,
    industries,
    geographies,
    companySizeMin,
    companySizeMax,
    description: description ? description.slice(0, 2000) : ''
  };
}

/** Does this ICP have enough to run a discovery search? */
export function hasUsableIcp(icp: ClientIcp): boolean {
  return (
    icp.industries.length > 0 ||
    icp.geographies.length > 0 ||
    icp.companySizeMin !== null ||
    icp.companySizeMax !== null
  );
}

function employeeRanges(min: number | null, max: number | null): string[] | undefined {
  if (min === null && max === null) return undefined;
  const lo = min && min > 0 ? min : 1;
  const hi = max && max > 0 ? max : 1_000_000;
  return hi < lo ? [`${hi},${lo}`] : [`${lo},${hi}`];
}

/** Turn a client's ICP into Apollo organization-search filters. */
export function icpToApolloFilters(
  icp: ClientIcp,
  opts: { page?: number; perPage?: number } = {}
): ApolloOrgSearchFilters {
  return {
    qOrganizationKeywordTags: icp.industries.length > 0 ? icp.industries : undefined,
    organizationLocations: icp.geographies.length > 0 ? icp.geographies : undefined,
    organizationNotLocations: icp.excludeGeographies.length > 0 ? icp.excludeGeographies : undefined,
    organizationNumEmployeesRanges: employeeRanges(icp.companySizeMin, icp.companySizeMax),
    page: opts.page && opts.page > 0 ? Math.floor(opts.page) : 1,
    perPage: opts.perPage && opts.perPage > 0 ? Math.min(100, Math.floor(opts.perPage)) : 10
  };
}
