/**
 * lib/client/race_data.ts  (val 2026-06-17, UX/UI Phase 2)
 *
 * Parser + types for the Race Tracker hero data. Reads the candidate's
 * creative brief and surfaces only what is verifiably set; the renderer
 * empty-states everything else honestly (no invented party, no invented
 * ballot status, no fabricated endorsements).
 *
 * Field strategy:
 *   - candidateName  → brief.contact_name, falling back to brief.company
 *                      stripped of "for Congress" etc.
 *   - office         → brief.office_sought when set; otherwise derived from
 *                      brief.industry / brief.district (best-effort label).
 *   - districtLabel  → brief.district_label or brief.district
 *   - nextElection   → brief.next_election_date if explicitly set; otherwise
 *                      a heuristic scan of brief.timeline for a date pattern
 *                      next to "Primary" / "General" / "Election"
 *   - ballotStatus   → brief.ballot_status only; never inferred
 *   - party          → brief.party only; never inferred
 *   - incumbent      → brief.opponent_name or scanned from brief.competitors
 *                      ("Incumbent Sarah Elfreth (D)" → name + party)
 *
 * Everything is optional. The hero component checks each field and shows
 * either a "confirmed" pill (emerald-mist) or a dashed "confirming" pill,
 * per UX/UI's mock. The setup link below points to the brief editor so val
 * can fill the gaps in one place.
 */

export interface Endorsement {
  /** Endorser name (e.g. "Rep. Andy Harris"). */
  name: string;
  /** Their title / role / org. Optional. */
  role: string | null;
  /** ISO date logged. Optional. */
  date: string | null;
  /** A one-line quote, if recorded. Optional. */
  quote: string | null;
  /** URL to the source — press release, article, video. Optional. */
  sourceUrl: string | null;
}

export interface RaceData {
  candidateName: string | null;
  office: string | null;              // e.g. "U.S. House"
  districtLabel: string | null;       // e.g. "Maryland's 3rd Congressional District"
  /** ISO date of the NEXT election (primary if before general; general after). */
  nextElectionDate: string | null;
  /** Human label for the next election ("Primary" / "General" / "Runoff"). */
  nextElectionLabel: string | null;
  /** Days from `today` to the next election. Null if we can't compute. */
  daysToNext: number | null;
  /** "filed" / "primary" / "general" / "runoff" / "won" / null. */
  ballotStatus: string | null;
  /** "R" / "D" / "I" / etc. Only when explicitly set. */
  party: string | null;
  /** Incumbent or primary opponent — usually the person to watch. */
  incumbentName: string | null;
  /** "(D)" / "(R)" if we parsed one. */
  incumbentParty: string | null;
  /** Endorsements logged in the brief. Empty array when none have been
   *  added — the panel renders an honest empty-state, not invented rows. */
  endorsements: Endorsement[];
}

const EMPTY: RaceData = {
  candidateName: null,
  office: null,
  districtLabel: null,
  nextElectionDate: null,
  nextElectionLabel: null,
  daysToNext: null,
  ballotStatus: null,
  party: null,
  incumbentName: null,
  incumbentParty: null,
  endorsements: []
};

/** Parse brief.endorsements which may be a JSON array, a JSON-encoded string,
 *  or absent. Each entry can have name (required), plus optional role/date/
 *  quote/sourceUrl. Anything malformed is silently dropped — empty-state is
 *  honest, garbage rows would not be. */
function parseEndorsements(briefObj: Record<string, unknown>): Endorsement[] {
  const raw = briefObj.endorsements;
  if (!raw) return [];
  let arr: unknown = raw;
  if (typeof raw === 'string') {
    try { arr = JSON.parse(raw); } catch { return []; }
  }
  if (!Array.isArray(arr)) return [];
  const out: Endorsement[] = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const name = typeof r.name === 'string' ? r.name.trim() : '';
    if (!name || isPlaceholderText(name)) continue;
    const pickStr = (k: string): string | null => {
      const v = r[k];
      if (typeof v !== 'string') return null;
      const t = v.trim();
      if (t.length === 0 || isPlaceholderText(t)) return null;
      return t;
    };
    out.push({
      name,
      role: pickStr('role') || pickStr('title') || pickStr('org'),
      date: pickStr('date'),
      quote: pickStr('quote'),
      sourceUrl: pickStr('sourceUrl') || pickStr('source_url') || pickStr('url')
    });
  }
  return out;
}

/** Treat operator-intake placeholder strings as null so they never leak to a
 *  client surface. John's brief has `party: "TODO_ASK — confirm with John
 *  (D / R / I)"` from the intake gen — without this guard the RaceTrackerHero
 *  was rendering that text inside a solid emerald pill instead of falling
 *  back to the honest "Party — confirming" dashed pill. Universal — protects
 *  every political_campaign brief whose intake left placeholders behind. */
const PLACEHOLDER_MARKERS = [
  'todo_ask',
  '[ask]',
  '[todo]',
  'confirm with',
  'tbd',
  'tbc',
  'to be confirmed',
  'to be determined'
];

function isPlaceholderText(s: string): boolean {
  const lower = s.toLowerCase();
  for (const m of PLACEHOLDER_MARKERS) {
    if (lower.includes(m)) return true;
  }
  return false;
}

function pick(briefObj: Record<string, unknown>, key: string): string | null {
  const v = briefObj[key];
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (t.length === 0) return null;
  if (isPlaceholderText(t)) return null;
  return t;
}

/** "John White for Congress" → "John White"; "John White" → "John White". */
function stripCampaignSuffix(name: string | null): string | null {
  if (!name) return null;
  return name
    .replace(/\s+for\s+(?:congress|u\.?s\.?\s+(?:house|senate)|senate|governor|mayor|state\s+\w+).*/i, '')
    .trim() || null;
}

/** Parse a date in any of these forms into an ISO date string:
 *  - "June 23, 2026" / "Jun 23, 2026"
 *  - "2026-06-23"
 *  - "6/23/2026" / "06/23/2026"
 *  Returns null on miss. */
function parseDate(raw: string): string | null {
  // ISO first.
  const iso = raw.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  // M/D/YYYY
  const mdy = raw.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (mdy) {
    const mm = mdy[1].padStart(2, '0');
    const dd = mdy[2].padStart(2, '0');
    return `${mdy[3]}-${mm}-${dd}`;
  }
  // "Month D, YYYY"
  const named = raw.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z.]*\s+(\d{1,2}),?\s+(\d{4})\b/i);
  if (named) {
    const months: Record<string, string> = {
      jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
      jul: '07', aug: '08', sep: '09', sept: '09', oct: '10', nov: '11', dec: '12'
    };
    const key = named[1].toLowerCase().slice(0, 4);
    const mm = months[key] ?? months[named[1].toLowerCase().slice(0, 3)];
    if (mm) {
      const dd = named[2].padStart(2, '0');
      return `${named[3]}-${mm}-${dd}`;
    }
  }
  return null;
}

function daysBetween(targetIso: string, today: Date): number | null {
  const t = Date.parse(targetIso + 'T12:00:00Z');
  if (!Number.isFinite(t)) return null;
  const diffMs = t - today.getTime();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

/** "Incumbent Sarah Elfreth (D) in general." → { name: "Sarah Elfreth", party: "D" } */
function parseIncumbent(competitors: string | null): {
  name: string | null;
  party: string | null;
} {
  if (!competitors) return { name: null, party: null };
  // Look for "Incumbent <Name> (<P>)" first, then fall back to any "(<P>)" tail.
  const m = competitors.match(
    /incumbent\s+([A-Z][a-zA-Z'.-]+(?:\s+[A-Z][a-zA-Z'.-]+){0,3})(?:\s*\(\s*([A-Za-z])\s*\))?/i
  );
  if (m) {
    return { name: m[1].trim(), party: (m[2] || '').toUpperCase() || null };
  }
  return { name: null, party: null };
}

/** Best-effort office label from industry / district when office_sought is not
 *  in the brief. "Political · congressional campaign · MD-3 R primary" →
 *  "U.S. House". */
function deriveOffice(briefObj: Record<string, unknown>): string | null {
  const explicit = pick(briefObj, 'office_sought');
  if (explicit) return explicit;
  const industry = pick(briefObj, 'industry');
  if (!industry) return null;
  const lower = industry.toLowerCase();
  if (/congress|u\.?s\.?\s+house/.test(lower)) return 'U.S. House';
  if (/u\.?s\.?\s+senate/.test(lower)) return 'U.S. Senate';
  if (/governor/.test(lower)) return 'Governor';
  if (/mayor/.test(lower)) return 'Mayor';
  if (/state\s+(senate|house|assembly)/.test(lower)) {
    const m = lower.match(/state\s+(senate|house|assembly)/);
    return m ? `State ${m[1][0].toUpperCase()}${m[1].slice(1)}` : null;
  }
  return null;
}

/** Build the friendly district line: "Maryland's 3rd Congressional District". */
function deriveDistrictLabel(briefObj: Record<string, unknown>): string | null {
  const explicit = pick(briefObj, 'district_label');
  if (explicit) return explicit;
  return pick(briefObj, 'district');
}

export function parseRaceData(
  briefObj: Record<string, unknown>,
  today: Date = new Date()
): RaceData {
  if (!briefObj || typeof briefObj !== 'object') return EMPTY;

  // Candidate name — explicit contact > stripped company.
  const candidate =
    pick(briefObj, 'candidate_name') ||
    pick(briefObj, 'contact_name') ||
    stripCampaignSuffix(pick(briefObj, 'company'));

  // (val 2026-06-17, fix) Next election = EARLIEST future date across every
  // known source. The previous version preferred `election_date` and never
  // looked at the timeline if that field existed — which meant John's
  // November 3 general clobbered the June 23 primary that was 6 days away.
  // Now we collect every parseable candidate (explicit fields + timeline
  // scan) and pick the soonest one that is still in the future.
  const candidates: Array<{ iso: string; label: string | null }> = [];

  const pushIso = (raw: string | null, label: string | null) => {
    if (!raw) return;
    const parsed = parseDate(raw) || (raw.match(/^\d{4}-\d{2}-\d{2}$/) ? raw : null);
    if (!parsed) return;
    candidates.push({ iso: parsed, label });
  };
  pushIso(pick(briefObj, 'primary_election_date'), 'Primary');
  pushIso(pick(briefObj, 'general_election_date'), 'General');
  pushIso(pick(briefObj, 'runoff_election_date'), 'Runoff');
  pushIso(pick(briefObj, 'next_election_date'), pick(briefObj, 'next_election_label'));
  pushIso(pick(briefObj, 'election_date'), pick(briefObj, 'next_election_label'));

  const timeline = pick(briefObj, 'timeline');
  if (timeline) {
    // scanTimelineForNextElection returns just one (the earliest); to merge
    // properly with explicit fields, scan ALL future dates in the timeline.
    const chunks = timeline.split(/[.;\n]/).map((s) => s.trim()).filter(Boolean);
    const keyword = /\b(primary|general|election|runoff)\b/i;
    for (const chunk of chunks) {
      const date = parseDate(chunk);
      if (!date) continue;
      const m = chunk.match(keyword);
      const label = m ? m[1][0].toUpperCase() + m[1].slice(1).toLowerCase() : 'Election';
      candidates.push({ iso: date, label });
    }
  }

  // Filter to future + pick earliest. (Equal dates: explicit field wins by
  // virtue of being pushed first.)
  const future = candidates.filter((c) => {
    const t = Date.parse(c.iso + 'T12:00:00Z');
    return Number.isFinite(t) && t >= today.getTime();
  });
  future.sort((a, b) => a.iso.localeCompare(b.iso));
  const winner = future[0] || null;

  const nextDate = winner?.iso ?? null;
  const nextLabel = winner?.label ?? null;
  const days = nextDate ? daysBetween(nextDate, today) : null;

  const incumbent = parseIncumbent(pick(briefObj, 'competitors'));

  return {
    candidateName: candidate,
    office: deriveOffice(briefObj),
    districtLabel: deriveDistrictLabel(briefObj),
    nextElectionDate: nextDate,
    nextElectionLabel: nextLabel,
    daysToNext: days,
    ballotStatus: pick(briefObj, 'ballot_status'),
    party: pick(briefObj, 'party'),
    incumbentName: pick(briefObj, 'opponent_name') || incumbent.name,
    incumbentParty: incumbent.party,
    endorsements: parseEndorsements(briefObj)
  };
}
