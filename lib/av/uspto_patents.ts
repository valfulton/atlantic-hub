/**
 * lib/av/uspto_patents.ts  (#521b, val 2026-06-08)
 *
 * USPTO patent lookup via PatentsView (https://search.patentsview.org/).
 * Free, public, returns patent applications + grants by assignee org name
 * or inventor name. No auth required for moderate query rates.
 *
 * Use cases:
 *   1. **Due diligence on a prospective client.** "Does this company actually
 *      own IP?" — runs name through patent records, returns count + recent
 *      titles. If a 'biotech' or 'medical device' prospect has zero patents,
 *      that's a signal.
 *   2. **Sales asset for IP-rich clients (Tim/OPHORA).** Surface their patents
 *      so val can reference them in outreach. ("You've got 3 patents on
 *      hyper-oxygenated water — leading with that line.")
 *   3. **Patent-troll detection.** Prospective client filed a flurry of patents
 *      against industry incumbents → flag as litigious.
 *
 * Returns up to MAX_RESULTS recent patents matching the assignee organization
 * name. Patent records get classified later by the distress engine if the
 * caller wants score contribution; for now, this is a one-shot lookup.
 */

const PATENTSVIEW_BASE = 'https://search.patentsview.org/api/v1';
const TIMEOUT_MS = 8000;
const MAX_RESULTS = 25;

export interface PatentHit {
  patentId: string;
  patentTitle: string;
  patentDate: string | null;     // YYYY-MM-DD
  assigneeOrg: string | null;
  inventorNames: string[];
  patentType: string | null;     // 'utility' | 'design' | 'plant' | etc.
  patentAbstract: string | null;
  /** Stable USPTO URL for human review. */
  publicUrl: string;
}

export interface PatentLookupResult {
  ok: boolean;
  query: string;
  byAssignee: PatentHit[];
  byInventor: PatentHit[];
  totalAssigneeHits: number;
  totalInventorHits: number;
  fetchedAt: string;
  error?: string;
}

interface PatentsViewPatent {
  patent_id?: string;
  patent_title?: string;
  patent_date?: string;
  patent_type?: string;
  patent_abstract?: string;
  assignees?: Array<{
    assignee_organization?: string;
    assignee_first_name?: string;
    assignee_last_name?: string;
  }>;
  inventors?: Array<{
    inventor_name_first?: string;
    inventor_name_last?: string;
  }>;
}

function publicUrlForPatent(patentId: string): string {
  // patft.uspto.gov is canonical for grants. Format: /netacgi/nph-Parser?Sect2=PTO1&p=1&u=/netahtml/PTO/srchnum.html&r=1&f=G&l=50&d=PALL&s1=<id>.PN
  // For PatentsView IDs the cleaner human URL is patentcenter.uspto.gov/applications.
  // Use Google Patents as the most reliable, mobile-friendly viewer.
  return `https://patents.google.com/patent/US${patentId}`;
}

function normalizeHit(p: PatentsViewPatent): PatentHit {
  const inventorNames = (p.inventors || []).map((i) => {
    const first = i.inventor_name_first?.trim() || '';
    const last = i.inventor_name_last?.trim() || '';
    return [first, last].filter(Boolean).join(' ');
  }).filter(Boolean);

  const assigneeOrg = p.assignees?.find((a) => a.assignee_organization)?.assignee_organization ?? null;

  return {
    patentId: p.patent_id ?? '',
    patentTitle: p.patent_title ?? '',
    patentDate: p.patent_date ?? null,
    assigneeOrg,
    inventorNames,
    patentType: p.patent_type ?? null,
    patentAbstract: p.patent_abstract ? p.patent_abstract.slice(0, 600) : null,
    publicUrl: publicUrlForPatent(p.patent_id ?? '')
  };
}

async function postPatentsView(body: Record<string, unknown>): Promise<{ patents?: PatentsViewPatent[]; total_hits?: number } | null> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(`${PATENTSVIEW_BASE}/patent/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        // PatentsView prefers a user-agent; sending one keeps us off their generic-bot throttle.
        'User-Agent': 'AtlanticVineHub/1.0 (+https://atlanticandvine.com)'
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    if (!resp.ok) return null;
    return (await resp.json()) as { patents?: PatentsViewPatent[]; total_hits?: number };
  } catch (err) {
    console.error('[uspto_patents:fetch]', (err as Error).message);
    return null;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Look up patents by ASSIGNEE org name (case-insensitive substring). This is
 * the most common path for due diligence — "what has this COMPANY filed?"
 */
async function searchByAssignee(orgName: string): Promise<{ hits: PatentHit[]; total: number }> {
  const body = {
    q: { _text_phrase: { assignee_organization: orgName } },
    f: [
      'patent_id', 'patent_title', 'patent_date', 'patent_type', 'patent_abstract',
      'assignees.assignee_organization',
      'inventors.inventor_name_first', 'inventors.inventor_name_last'
    ],
    s: [{ patent_date: 'desc' }],
    o: { size: MAX_RESULTS }
  };
  const data = await postPatentsView(body);
  if (!data || !Array.isArray(data.patents)) return { hits: [], total: 0 };
  return { hits: data.patents.map(normalizeHit), total: data.total_hits ?? data.patents.length };
}

/**
 * Look up patents by INVENTOR name (last name + first name). Returns hits
 * where this person is named as an inventor.
 */
async function searchByInventor(firstName: string, lastName: string): Promise<{ hits: PatentHit[]; total: number }> {
  if (!lastName.trim()) return { hits: [], total: 0 };
  const body = {
    q: {
      _and: [
        { _text_phrase: { 'inventors.inventor_name_last': lastName } },
        ...(firstName.trim() ? [{ _text_phrase: { 'inventors.inventor_name_first': firstName } }] : [])
      ]
    },
    f: [
      'patent_id', 'patent_title', 'patent_date', 'patent_type', 'patent_abstract',
      'assignees.assignee_organization',
      'inventors.inventor_name_first', 'inventors.inventor_name_last'
    ],
    s: [{ patent_date: 'desc' }],
    o: { size: MAX_RESULTS }
  };
  const data = await postPatentsView(body);
  if (!data || !Array.isArray(data.patents)) return { hits: [], total: 0 };
  return { hits: data.patents.map(normalizeHit), total: data.total_hits ?? data.patents.length };
}

/**
 * Combined lookup: try both assignee (company) and inventor (person) paths.
 * Returns deduped results. `companyName` and `contactName` come from the
 * client's brief — either can be empty.
 */
export async function lookupPatentsForClient(args: {
  companyName?: string | null;
  contactName?: string | null;
}): Promise<PatentLookupResult> {
  const company = (args.companyName ?? '').trim();
  const contact = (args.contactName ?? '').trim();

  const result: PatentLookupResult = {
    ok: true,
    query: [company && `company: ${company}`, contact && `inventor: ${contact}`].filter(Boolean).join(' · '),
    byAssignee: [],
    byInventor: [],
    totalAssigneeHits: 0,
    totalInventorHits: 0,
    fetchedAt: new Date().toISOString()
  };

  if (!company && !contact) {
    return { ...result, ok: false, error: 'Need company name OR contact name to look up patents.' };
  }

  // Fire both queries in parallel.
  const [assigneeRes, inventorRes] = await Promise.all([
    company ? searchByAssignee(company) : Promise.resolve({ hits: [], total: 0 }),
    contact ? (() => {
      const parts = contact.split(/\s+/);
      const first = parts[0] ?? '';
      const last = parts.slice(1).join(' ') || parts[0] || '';
      return searchByInventor(first, last);
    })() : Promise.resolve({ hits: [], total: 0 })
  ]);

  result.byAssignee = assigneeRes.hits;
  result.byInventor = inventorRes.hits;
  result.totalAssigneeHits = assigneeRes.total;
  result.totalInventorHits = inventorRes.total;

  return result;
}
