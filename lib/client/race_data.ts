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
  incumbentParty: null
};

function pick(briefObj: Record<string, unknown>, key: string): string | null {
  const v = briefObj[key];
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
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

/** Scan a free-text timeline string for the next election. Looks for the
 *  earliest "Primary"/"General"/"Election"/"Runoff" keyword paired with a
 *  parseable date that is AFTER `today`. Falls back to first parseable date
 *  if no keyword match. */
function scanTimelineForNextElection(
  timeline: string,
  today: Date
): { iso: string; label: string } | null {
  // Split on common separators so each chunk has one candidate date.
  const chunks = timeline.split(/[.;\n]/).map((s) => s.trim()).filter(Boolean);
  const keyword = /\b(primary|general|election|runoff)\b/i;
  const candidates: Array<{ iso: string; label: string }> = [];
  for (const chunk of chunks) {
    const date = parseDate(chunk);
    if (!date) continue;
    const t = Date.parse(date + 'T12:00:00Z');
    if (!Number.isFinite(t) || t < today.getTime()) continue;
    const m = chunk.match(keyword);
    const label = m
      ? m[1][0].toUpperCase() + m[1].slice(1).toLowerCase()
      : 'Election';
    candidates.push({ iso: date, label });
  }
  if (candidates.length === 0) return null;
  // Earliest future election wins (primary before general).
  candidates.sort((a, b) => a.iso.localeCompare(b.iso));
  return candidates[0];
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

  // Next election — explicit date wins; otherwise scan the timeline string.
  let nextDate = pick(briefObj, 'next_election_date') ||
                 pick(briefObj, 'election_date');
  let nextLabel = pick(briefObj, 'next_election_label');
  if (!nextDate) {
    const timeline = pick(briefObj, 'timeline');
    if (timeline) {
      const found = scanTimelineForNextElection(timeline, today);
      if (found) {
        nextDate = found.iso;
        if (!nextLabel) nextLabel = found.label;
      }
    }
  }
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
    incumbentParty: incumbent.party
  };
}
