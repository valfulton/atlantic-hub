/**
 * lib/public_intel/adapters/md_land_rec.ts  (#423, val 2026-06-05)
 *
 * Maryland Land Records — the digital repository for every MD jurisdiction's
 * recorded land documents, run by the Maryland State Archives. Free to use
 * with a registered account. One login covers all 24 jurisdictions (23
 * counties + Baltimore City) — the cleanest free statewide land records
 * portal in the country.
 *
 * Why this is the first state in the multi-state RE rollout: every other
 * state requires per-county adapters. MD is one adapter for the whole state.
 *
 * What we pull: filings that signal distress on a property's chain of title:
 *   - Notice of Sale (NTS-equivalent — the auction notice)
 *   - Mortgage / Deed of Trust (the underlying loan — surfaces refinances,
 *     new debt, modifications)
 *   - Lis Pendens (foreclosure lawsuit filed)
 *   - Trustee's Deed (post-auction transfer — auction completed)
 *   - Tax Sale Certificate (tax delinquency leading to county sale)
 *
 * Architecture notes:
 *   - mdlandrec.net is a ColdFusion app. Plain HTML form posts, no JavaScript
 *     wall — no Puppeteer needed for this adapter.
 *   - Auth: POST credentials to /main/login.cfm, capture the JSESSIONID-style
 *     cookie, attach to subsequent requests.
 *   - Search: POST to the search form with filters (county, last name,
 *     instrument type, date range). Results land in an HTML table.
 *   - Parser: deliberately minimal — extracts rows via regex over the
 *     well-structured CF table HTML. A future pass can swap in cheerio if
 *     val wants to add an HTML parser to the dependency tree.
 *
 * Credentials: MDLANDREC_USERNAME + MDLANDREC_PASSWORD env vars. The val@
 * atlanticandvine.com account is the canonical session for the platform.
 *
 * Output: writes to public_intel_records with kind='md_land_rec'. The
 * Distress engine picks them up via the engine's score function the same
 * way it does CourtListener and CFPB. Cascade pipeline recipes referencing
 * 'md_land_rec' will activate automatically once this adapter is registered.
 */
import type { PublicIntelAdapter, RunContext, RunResult } from '../types';
import { storeRecord, noteRun } from '../store';

const LOGIN_URL = 'https://mdlandrec.net/main/login.cfm';
const SEARCH_URL = 'https://mdlandrec.net/searchindex.cfm';

/** Document types worth scoring as distress signals (ordered by weight). */
const DISTRESS_DOC_TYPES = [
  'Notice of Sale',
  'Trustee Deed',
  'Lis Pendens',
  'Foreclosure',
  'Tax Sale Certificate',
  'Tax Sale Deed',
  'Substitute Trustee',
  'Mortgage',
  'Deed of Trust'
];

/** MD jurisdictions accepted by the adapter. Used to validate operator config
 *  and to scope each run to a single county per call (rate-limit friendly). */
const MD_JURISDICTIONS = [
  'Allegany', 'Anne Arundel', 'Baltimore City', 'Baltimore County', 'Calvert',
  'Caroline', 'Carroll', 'Cecil', 'Charles', 'Dorchester', 'Frederick', 'Garrett',
  'Harford', 'Howard', 'Kent', 'Montgomery', 'Prince George\'s', 'Queen Anne\'s',
  'Somerset', 'St. Mary\'s', 'Talbot', 'Washington', 'Wicomico', 'Worcester'
] as const;
type MdCounty = typeof MD_JURISDICTIONS[number];

interface MdLandRecConfig {
  /** Counties to scan. Use a subset to stay within practical run time. */
  counties: MdCounty[];
  /** Document types to fetch. Defaults to DISTRESS_DOC_TYPES if omitted. */
  docTypes?: string[];
  /** Lookback window in days. Default 30. */
  sinceDays?: number;
}

interface ParsedHit {
  county: string;
  lastName: string | null;
  firstName: string | null;
  party: string;          // raw party string for display
  docType: string;
  recordedAt: string | null;   // ISO date when present
  book: string | null;
  page: string | null;
  liber: string | null;        // some counties use Liber/Folio instead of Book/Page
  folio: string | null;
  detailUrl: string | null;
}

function isCfg(c: unknown): c is MdLandRecConfig {
  if (!c || typeof c !== 'object') return false;
  const o = c as Record<string, unknown>;
  if (!Array.isArray(o.counties) || o.counties.some((x) => typeof x !== 'string')) return false;
  if (o.docTypes !== undefined && !(Array.isArray(o.docTypes) && o.docTypes.every((x) => typeof x === 'string'))) return false;
  if (o.sinceDays !== undefined && typeof o.sinceDays !== 'number') return false;
  return true;
}

function yyyymmdd(d: Date): string {
  // mdlandrec expects MM/DD/YYYY in form submissions.
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
}

/** USPS-style county code suffix for region_code. "Montgomery" → "MD-MO". */
function countyCode(county: string): string {
  const stripped = county.replace(/[^A-Za-z]/g, '').toUpperCase();
  return 'MD-' + stripped.slice(0, 2);
}

/**
 * Authenticate against mdlandrec.net. Returns the Set-Cookie chain we need
 * to attach to subsequent search requests, or null on failure.
 */
async function login(username: string, password: string): Promise<string | null> {
  try {
    const form = new URLSearchParams();
    form.set('USERNAME', username);
    form.set('PASSWORD', password);
    form.set('submit', 'Login');

    const res = await fetch(LOGIN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'AtlanticHub/1.0 (research; contact: PR@api.atlanticandvine.com)',
        Accept: 'text/html'
      },
      body: form.toString(),
      redirect: 'manual'
    });

    // ColdFusion sets CFID + CFTOKEN cookies on successful login. A failed
    // login redirects back to /main/login.cfm with no session set.
    const setCookie = res.headers.get('set-cookie') ?? '';
    if (!/CFID=|CFTOKEN=|JSESSIONID=/i.test(setCookie)) return null;

    // Extract just the cookie name=value pairs (drop attributes).
    const pairs = setCookie
      .split(/,\s*(?=[A-Za-z]+=)/)
      .map((c) => c.split(';')[0]?.trim() ?? '')
      .filter(Boolean);
    return pairs.join('; ');
  } catch {
    return null;
  }
}

/**
 * Run one search request scoped to (county, docType, dateRange). Returns the
 * parsed rows. Intentionally narrow per call so we stay polite to the server.
 */
async function searchOne(
  cookie: string,
  county: string,
  docType: string,
  since: Date,
  through: Date
): Promise<ParsedHit[]> {
  try {
    const form = new URLSearchParams();
    form.set('county', county);
    form.set('instrumentType', docType);
    form.set('dateFrom', yyyymmdd(since));
    form.set('dateTo', yyyymmdd(through));
    form.set('action', 'search');

    const res = await fetch(SEARCH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: cookie,
        'User-Agent': 'AtlanticHub/1.0 (research; contact: PR@api.atlanticandvine.com)',
        Accept: 'text/html'
      },
      body: form.toString()
    });
    if (!res.ok) return [];
    const html = await res.text();
    return parseRows(html, county, docType);
  } catch {
    return [];
  }
}

/**
 * Extract result rows from mdlandrec's table HTML. Deliberately minimal —
 * targets the known CF table structure. If the upstream layout changes the
 * adapter will return zero rows (logged in noteRun), prompting a fix.
 *
 * The table cells we care about: party name, instrument type, recorded date,
 * book/page or liber/folio, detail link.
 */
function parseRows(html: string, county: string, docType: string): ParsedHit[] {
  const hits: ParsedHit[] = [];
  // Strip newlines so regex doesn't need to handle them.
  const flat = html.replace(/\s+/g, ' ');
  // Each result row is wrapped in <tr class="resultRow"> ... </tr>.
  const rowRegex = /<tr[^>]*class="[^"]*resultRow[^"]*"[^>]*>(.*?)<\/tr>/gi;
  let match: RegExpExecArray | null;
  while ((match = rowRegex.exec(flat)) !== null) {
    const row = match[1];
    const cells = [...row.matchAll(/<td[^>]*>(.*?)<\/td>/gi)].map((m) =>
      m[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim()
    );
    if (cells.length < 4) continue;

    const party = cells[0] || '';
    const [lastName, firstNameWithRest] = party.includes(',')
      ? party.split(',', 2).map((s) => s.trim())
      : [party.trim(), null];
    const firstName = firstNameWithRest ? firstNameWithRest.split(/\s+/)[0] : null;

    const recordedAt = (() => {
      const raw = cells[2] || '';
      const d = new Date(raw);
      return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
    })();

    // Book/Page OR Liber/Folio — mdlandrec uses both depending on county.
    const ref = cells[3] || '';
    const bp = ref.match(/(?:Book|Liber)\s*([A-Z0-9]+)\s*[/,\s]+\s*(?:Page|Folio)\s*(\d+)/i);

    const detail = row.match(/<a[^>]+href="([^"]+)"/i);

    hits.push({
      county,
      lastName: lastName || null,
      firstName,
      party,
      docType,
      recordedAt,
      book: ref.toLowerCase().includes('book') && bp ? bp[1] : null,
      page: ref.toLowerCase().includes('book') && bp ? bp[2] : null,
      liber: ref.toLowerCase().includes('liber') && bp ? bp[1] : null,
      folio: ref.toLowerCase().includes('liber') && bp ? bp[2] : null,
      detailUrl: detail ? `https://mdlandrec.net${detail[1].startsWith('/') ? '' : '/'}${detail[1]}` : null
    });
  }
  return hits;
}

/**
 * Build the stable entity_key for a hit. Combines county + party + book/page
 * so re-runs don't duplicate.
 */
function entityKey(h: ParsedHit): string {
  const ref = h.book && h.page ? `${h.book}-${h.page}` : h.liber && h.folio ? `${h.liber}-${h.folio}` : '';
  const party = (h.lastName ?? '') + (h.firstName ? ',' + h.firstName : '');
  return ['mdlandrec', h.county.replace(/\s+/g, '_'), party, ref, h.docType.replace(/\s+/g, '_')]
    .filter(Boolean)
    .join('|');
}

function summaryLabel(h: ParsedHit): string {
  const date = h.recordedAt ? ` (${h.recordedAt})` : '';
  return `${h.party} — ${h.docType} — ${h.county}, MD${date}`.slice(0, 240);
}

export const mdLandRecAdapter: PublicIntelAdapter = {
  kind: 'md_land_rec',
  displayName: 'Maryland Land Records (statewide)',
  description:
    'Statewide deeds, mortgages, foreclosure notices, lis pendens, and trustee sales — every Maryland jurisdiction from one free login. The fastest path to MD distressed-property coverage.',
  requiresKey: true,
  apiKeyEnv: 'MDLANDREC_USERNAME',
  costNote: 'Free · Maryland State Archives · requires a free registered account',
  bestFor: ['MD real estate distress prospecting', 'MD foreclosure outreach', 'Title-research workflows'],

  validateConfig(config: Record<string, unknown> | null): string | null {
    if (!config) return 'config required — pick at least one Maryland county to scan';
    if (!isCfg(config)) return 'config must be { counties: string[], docTypes?: string[], sinceDays?: number }';
    if (config.counties.length === 0) return 'pick at least one Maryland county';
    const bad = config.counties.find((c) => !MD_JURISDICTIONS.includes(c as MdCounty));
    if (bad) return `unknown Maryland county: ${bad}`;
    return null;
  },

  async run(ctx: RunContext): Promise<RunResult> {
    const config = ctx.source.config as MdLandRecConfig | null;
    if (!config || !isCfg(config)) {
      await noteRun({ sourceId: ctx.source.sourceId, status: 'error', detail: 'no config' });
      return { ok: false, written: 0, fromCache: 0, detail: 'no config' };
    }
    const username = process.env.MDLANDREC_USERNAME;
    const password = process.env.MDLANDREC_PASSWORD;
    if (!username || !password) {
      await noteRun({
        sourceId: ctx.source.sourceId,
        status: 'error',
        detail: 'MDLANDREC_USERNAME/MDLANDREC_PASSWORD not set'
      });
      return { ok: false, written: 0, fromCache: 0, detail: 'MDLANDREC_USERNAME/MDLANDREC_PASSWORD not set' };
    }

    // (#429 follow-up, 2026-06-05) mdlandrec.net redesigned Fall 2025:
    //   - mdlandrec.net/main/login.cfm → landrec.msa.maryland.gov/Pages/Login.aspx
    //   - migrated ColdFusion → ASP.NET (ViewState + EventValidation required)
    //   - now requires email MFA on every login
    // The plain-fetch login() below will always fail against the new site.
    // Reporting the real cause so the smoke test stops misleading the operator
    // with "check credentials" when credentials are not the issue.
    const cookie = await login(username, password);
    if (!cookie) {
      const detail =
        'upstream redesigned — landrec.msa.maryland.gov is ASP.NET + email MFA. ' +
        'Plain-fetch adapter cannot authenticate. Needs Puppeteer (task #422) + MFA pipeline, ' +
        'OR per-county Circuit Court adapter (task #431, recommended for Anne Arundel waterfront).';
      await noteRun({ sourceId: ctx.source.sourceId, status: 'error', detail });
      return { ok: false, written: 0, fromCache: 0, detail };
    }

    const sinceDays = ctx.sinceDays ?? config.sinceDays ?? 30;
    const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
    const through = new Date();
    const docTypes = config.docTypes && config.docTypes.length > 0 ? config.docTypes : DISTRESS_DOC_TYPES;

    let written = 0;
    let totalSeen = 0;
    for (const county of config.counties) {
      for (const docType of docTypes) {
        const hits = await searchOne(cookie, county, docType, since, through);
        totalSeen += hits.length;
        for (const h of hits) {
          const id = await storeRecord({
            sourceKind: 'md_land_rec',
            entityKey: entityKey(h),
            clientId: ctx.clientId ?? null,
            leadId: ctx.leadId ?? null,
            recordJson: h,
            summaryLabel: summaryLabel(h),
            regionCode: countyCode(county),
            expiresAt: null
          });
          if (id) written += 1;
        }
        // Polite delay between requests (200ms) to keep within reasonable
        // bounds on the state archive's free tier.
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    const detail = `MD: ${config.counties.length} counties · ${docTypes.length} doc types · ${totalSeen} hits · ${written} new`;
    await noteRun({
      sourceId: ctx.source.sourceId,
      status: totalSeen === 0 ? 'skipped' : 'ok',
      detail
    });
    return {
      ok: true,
      written,
      fromCache: Math.max(0, totalSeen - written),
      detail
    };
  }
};
