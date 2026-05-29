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
  /** Industries / company-type keywords to EXCLUDE from results (post-filter:
   *  Apollo has no negative-keyword filter, so we drop matches after fetch). */
  excludedIndustries: string[];
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
  excludedIndustries: [],
  companySizeMin: null,
  companySizeMax: null,
  description: ''
};

/** Who authored an ICP item: the operator (val) or the client (their intake). */
export type IcpItemSource = 'operator' | 'client' | 'ai_intake';

/** Per-item authorship, keyed by lowercased item value within each list field. */
export interface IcpProvenance {
  industries: Record<string, IcpItemSource>;
  geographies: Record<string, IcpItemSource>;
  excludeGeographies: Record<string, IcpItemSource>;
  excludedIndustries: Record<string, IcpItemSource>;
  description: IcpItemSource | null;
}

export function emptyProvenance(): IcpProvenance {
  return {
    industries: {},
    geographies: {},
    excludeGeographies: {},
    excludedIndustries: {},
    description: null
  };
}

interface IcpRow extends RowDataPacket {
  target_industries: unknown;
  target_geographies: unknown;
  excluded_topics: unknown;
  excluded_industries: unknown;
  target_company_size_min: number | null;
  target_company_size_max: number | null;
  description: string | null;
  provenance: unknown;
}

/** mysql2 returns JSON columns parsed; tolerate a string or null too. */
function asSourceMap(v: unknown): Record<string, IcpItemSource> {
  const out: Record<string, IcpItemSource> = {};
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (val === 'operator' || val === 'client') out[k.trim().toLowerCase()] = val;
    }
  }
  return out;
}

function parseProvenance(v: unknown): IcpProvenance {
  let val: unknown = v;
  if (typeof val === 'string') {
    try { val = JSON.parse(val); } catch { val = null; }
  }
  const o = val && typeof val === 'object' && !Array.isArray(val) ? (val as Record<string, unknown>) : {};
  const desc = o.description;
  return {
    industries: asSourceMap(o.industries),
    geographies: asSourceMap(o.geographies),
    excludeGeographies: asSourceMap(o.excludeGeographies),
    excludedIndustries: asSourceMap(o.excludedIndustries),
    description: desc === 'operator' || desc === 'client' ? desc : null
  };
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

// Words that don't help as a search keyword tag on their own.
const KW_STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'for', 'with', 'who', 'that', 'this', 'their', 'your', 'our',
  'to', 'of', 'in', 'on', 'are', 'is', 'we', 'they', 'them', 'us', 'people', 'clients', 'customers',
  'businesses', 'companies', 'owners', 'looking', 'want', 'need', 'like', 'such', 'etc', 'any', 'all',
  'who', 'whose', 'mainly', 'mostly', 'typically', 'usually', 'ideal', 'target'
]);

/**
 * Turn a freeform "ideal customer" description into a handful of clean search
 * keyword tags. Clients often list types ("boutique hotels, wedding venues and
 * yacht clubs"); we split on list separators + "and", drop stopword-only or
 * over-long fragments, and keep the tight phrases that make good Apollo tags.
 */
function keywordTagsFromText(text: string): string[] {
  if (!text) return [];
  const parts = text
    .toLowerCase()
    .replace(/\b(and|&|as well as|including|like|such as)\b/g, ',')
    .split(/[,;/\n.]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const raw of parts) {
    const words = raw.split(/\s+/).filter((w) => w.length > 1 && !KW_STOP.has(w));
    if (words.length === 0 || words.length > 4) continue; // skip empties + long clauses
    const tag = words.join(' ').trim();
    if (tag.length >= 3 && !out.includes(tag)) out.push(tag);
    if (out.length >= 6) break;
  }
  return out;
}

/** Read the client's saved ICP, or EMPTY_ICP if none. */
export async function getClientIcp(clientId: number): Promise<ClientIcp> {
  if (!clientId || clientId <= 0) return { ...EMPTY_ICP };
  const db = getAvDb();
  const [rows] = await db.execute<IcpRow[]>(
    `SELECT target_industries, target_geographies, excluded_topics, excluded_industries,
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
    excludedIndustries: asStringArray(r.excluded_industries),
    companySizeMin: clampSize(r.target_company_size_min),
    companySizeMax: clampSize(r.target_company_size_max),
    description: typeof r.description === 'string' ? r.description : ''
  };
}

/** Read the client's saved ICP together with its per-item authorship. */
export async function getClientIcpWithProvenance(
  clientId: number
): Promise<{ icp: ClientIcp; provenance: IcpProvenance }> {
  if (!clientId || clientId <= 0) return { icp: { ...EMPTY_ICP }, provenance: emptyProvenance() };
  const db = getAvDb();
  const [rows] = await db.execute<IcpRow[]>(
    `SELECT target_industries, target_geographies, excluded_topics, excluded_industries,
            target_company_size_min, target_company_size_max, description, provenance
       FROM client_icps WHERE client_id = ? LIMIT 1`,
    [clientId]
  );
  const r = rows[0];
  if (!r) return { icp: { ...EMPTY_ICP }, provenance: emptyProvenance() };
  return {
    icp: {
      industries: asStringArray(r.target_industries),
      geographies: asStringArray(r.target_geographies),
      excludeGeographies: asStringArray(r.excluded_topics),
      excludedIndustries: asStringArray(r.excluded_industries),
      companySizeMin: clampSize(r.target_company_size_min),
      companySizeMax: clampSize(r.target_company_size_max),
      description: typeof r.description === 'string' ? r.description : ''
    },
    provenance: parseProvenance(r.provenance)
  };
}

/** Normalize a raw inbound ICP (from a form/JSON body) into a clean ClientIcp. */
export function normalizeIcp(raw: Record<string, unknown> | null | undefined): ClientIcp {
  const r = raw ?? {};
  return {
    industries: asStringArray(r.industries),
    geographies: asStringArray(r.geographies),
    excludeGeographies: asStringArray(r.excludeGeographies),
    excludedIndustries: asStringArray(r.excludedIndustries),
    companySizeMin: clampSize(r.companySizeMin),
    companySizeMax: clampSize(r.companySizeMax),
    description: typeof r.description === 'string' ? r.description.slice(0, 2000) : ''
  };
}

/** Upsert the client's ICP (one row per client). Optionally records per-item
 *  authorship (provenance) so the editor can color what val wrote vs the client. */
export async function saveClientIcp(
  clientId: number,
  icp: ClientIcp,
  userId?: number | null,
  provenance?: IcpProvenance | null
): Promise<void> {
  if (!clientId || clientId <= 0) throw new Error('saveClientIcp: invalid clientId');
  const db = getAvDb();
  const provJson = provenance == null ? null : JSON.stringify(provenance);
  await db.execute<ResultSetHeader>(
    `INSERT INTO client_icps
       (client_id, target_industries, target_geographies, excluded_topics, excluded_industries,
        target_company_size_min, target_company_size_max, description, provenance, updated_by_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       target_industries = VALUES(target_industries),
       target_geographies = VALUES(target_geographies),
       excluded_topics = VALUES(excluded_topics),
       excluded_industries = VALUES(excluded_industries),
       target_company_size_min = VALUES(target_company_size_min),
       target_company_size_max = VALUES(target_company_size_max),
       description = VALUES(description),
       provenance = COALESCE(VALUES(provenance), provenance),
       updated_by_user_id = VALUES(updated_by_user_id)`,
    [
      clientId,
      JSON.stringify(icp.industries),
      JSON.stringify(icp.geographies),
      JSON.stringify(icp.excludeGeographies),
      JSON.stringify(icp.excludedIndustries),
      icp.companySizeMin,
      icp.companySizeMax,
      icp.description || null,
      provJson,
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

  // Industries / keyword tags. Clients describe who they want to attract in
  // prose ("boutique hotels, wedding venues, yacht clubs and event planners"),
  // so we turn that into real search keyword tags — not just a note — alongside
  // their industry. This is what makes auto-found leads actually on-target.
  const idealText = pick('ideal_client', 'target_audience', 'target_customer', 'ideal_customer');
  const industries = Array.from(new Set([
    ...list(pick('industry')),
    ...list(pick('keywords', 'target_keywords')),
    ...keywordTagsFromText(idealText)
  ])).slice(0, 10);

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

/**
 * Merge a fresh intake-derived ICP suggestion onto an existing saved ICP so a
 * client's NEW submission repopulates their targeting WITHOUT wiping operator
 * curation. Policy (intentionally conservative on the operator-tuned fields):
 *   - geographies, description: replaced by the new intake when it provides them;
 *     kept as-is when the intake is silent (so a blank never erases a value).
 *   - industries: UNION of existing + suggested, deduped (curated tags survive,
 *     the client's new signal is added).
 *   - excludedIndustries: ALWAYS preserved — the intake form has no exclude
 *     field, so these are operator-tuned (e.g. EHP excluding insurance carriers).
 *   - excludeGeographies: preserved if set, else taken from the suggestion.
 *   - company size: taken from intake when present, else preserved.
 */
export function mergeIntakeIcp(
  existing: ClientIcp,
  suggested: ClientIcp,
  priorProv: IcpProvenance = emptyProvenance()
): { icp: ClientIcp; provenance: IcpProvenance } {
  const union = (a: string[], b: string[]): string[] => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const s of [...a, ...b]) {
      const k = s.trim().toLowerCase();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(s.trim());
    }
    return out.slice(0, 12);
  };

  const icp: ClientIcp = {
    industries: suggested.industries.length
      ? union(existing.industries, suggested.industries)
      : existing.industries,
    geographies: suggested.geographies.length ? suggested.geographies : existing.geographies,
    excludeGeographies: existing.excludeGeographies.length
      ? existing.excludeGeographies
      : suggested.excludeGeographies,
    excludedIndustries: existing.excludedIndustries, // operator-curated: never auto-overwrite
    companySizeMin: suggested.companySizeMin ?? existing.companySizeMin,
    companySizeMax: suggested.companySizeMax ?? existing.companySizeMax,
    description: suggested.description ? suggested.description : existing.description
  };

  const lowerSet = (a: string[]) => new Set(a.map((s) => s.trim().toLowerCase()).filter(Boolean));
  const sIndustries = lowerSet(suggested.industries);
  const sGeo = lowerSet(suggested.geographies);
  const sExGeo = lowerSet(suggested.excludeGeographies);

  const provenance: IcpProvenance = {
    industries: provMapFor(icp.industries, sIndustries, priorProv.industries),
    geographies: provMapFor(icp.geographies, sGeo, priorProv.geographies),
    excludeGeographies: provMapFor(icp.excludeGeographies, sExGeo, priorProv.excludeGeographies),
    // Excludes come only from the operator (intake has no exclude field).
    excludedIndustries: provMapFor(icp.excludedIndustries, new Set(), priorProv.excludedIndustries),
    description: suggested.description ? 'client' : priorProv.description ?? (icp.description ? 'operator' : null)
  };

  return { icp, provenance };
}

/**
 * Per-item authorship for a field: an item the new intake supplied is tagged
 * 'client'; an item carried over keeps its prior source; anything else (a brand
 * new item, e.g. operator-typed) defaults to 'operator'.
 */
function provMapFor(
  finalItems: string[],
  suggestedSet: Set<string>,
  prior: Record<string, IcpItemSource>
): Record<string, IcpItemSource> {
  const out: Record<string, IcpItemSource> = {};
  for (const it of finalItems) {
    const k = it.trim().toLowerCase();
    if (!k) continue;
    out[k] = suggestedSet.has(k) ? 'client' : prior[k] ?? 'operator';
  }
  return out;
}

/**
 * Provenance for an OPERATOR manual save: val owns the final list, so each item
 * keeps its prior source if it was already on file (a client-authored item she
 * chose to keep stays 'client' — a durable memory of who asked for it) and any
 * brand-new item she typed is 'operator'. Removed items simply drop out.
 */
export function operatorSaveProvenance(icp: ClientIcp, priorProv: IcpProvenance): IcpProvenance {
  const none = new Set<string>();
  return {
    industries: provMapFor(icp.industries, none, priorProv.industries),
    geographies: provMapFor(icp.geographies, none, priorProv.geographies),
    excludeGeographies: provMapFor(icp.excludeGeographies, none, priorProv.excludeGeographies),
    excludedIndustries: provMapFor(icp.excludedIndustries, none, priorProv.excludedIndustries),
    description: priorProv.description ?? (icp.description ? 'operator' : null)
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

/**
 * Post-filter helper: true if a company's text (name / industry / description)
 * matches any of the ICP's excluded-industry terms. Apollo has no negative
 * keyword filter, so discovery uses this to drop off-target results (e.g. a
 * benefits broker excluding "hospital", "health system", "insurance carrier").
 */
export function matchesExcludedIndustry(text: string | null | undefined, icp: ClientIcp): boolean {
  if (!text || !icp.excludedIndustries || icp.excludedIndustries.length === 0) return false;
  const hay = text.toLowerCase();
  return icp.excludedIndustries.some((term) => {
    const t = (term || '').trim().toLowerCase();
    return t.length > 0 && hay.includes(t);
  });
}
