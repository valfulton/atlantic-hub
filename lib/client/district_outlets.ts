/**
 * lib/client/district_outlets.ts  (val 2026-06-10)
 *
 * Maps a US congressional district code (e.g. "MD-3") to the local + regional
 * press outlets a political_campaign client should pitch first. Used to seed
 * press_touches with district-specific targets the moment a political_campaign
 * brief lands, instead of making val type the same list every time.
 *
 * Reusable: every new political_campaign client gets their district's outlets
 * the day they're onboarded. Adding a district = one entry here. No code
 * changes elsewhere.
 *
 * Format per outlet:
 *   - name: how the outlet appears in press releases + the press desk
 *   - kind: 'print' | 'broadcast' | 'digital' | 'wire' | 'podcast'
 *   - reach: 'local' | 'regional' | 'national'
 *   - pitchEmail: editorial / news / political desk inbox (optional)
 *   - beat: short descriptor of who covers what (optional)
 *
 * Maintained as data, not code. Add MD-1 / NY-14 / TX-15 / etc. by appending
 * to DISTRICT_OUTLETS. The lookup falls back to STATE_OUTLETS when a district
 * isn't enumerated yet, so even a brand-new state gets a sensible default.
 */

export interface PressOutlet {
  name: string;
  kind: 'print' | 'broadcast' | 'digital' | 'wire' | 'podcast';
  reach: 'local' | 'regional' | 'national';
  pitchEmail?: string;
  beat?: string;
  url?: string;
}

/** Outlets per congressional district. Add as new political_campaign clients
 *  land. Keys are the canonical district code, e.g. "MD-3" or "NY-14". */
export const DISTRICT_OUTLETS: Record<string, PressOutlet[]> = {
  // Maryland — John White (val's first political_campaign client)
  'MD-3': [
    { name: 'The Baltimore Banner', kind: 'digital', reach: 'regional',
      url: 'https://www.thebaltimorebanner.com',
      beat: 'Maryland politics + statewide enterprise reporting' },
    { name: 'The Capital Gazette (Annapolis)', kind: 'print', reach: 'local',
      url: 'https://www.capitalgazette.com',
      beat: 'Anne Arundel County government, AA politics' },
    { name: 'WBAL-TV 11 (NBC Baltimore)', kind: 'broadcast', reach: 'regional',
      url: 'https://www.wbaltv.com',
      beat: 'Baltimore + central MD political coverage' },
    { name: 'WJZ-13 (CBS Baltimore)', kind: 'broadcast', reach: 'regional',
      url: 'https://www.cbsnews.com/baltimore',
      beat: 'Baltimore + central MD political coverage' },
    { name: 'Maryland Matters', kind: 'digital', reach: 'regional',
      url: 'https://marylandmatters.org',
      beat: 'Maryland state-government policy reporting' },
    { name: 'WYPR (NPR Baltimore)', kind: 'broadcast', reach: 'regional',
      url: 'https://www.wypr.org',
      beat: 'Maryland politics + civic interviews' },
    { name: 'Howard County Times', kind: 'print', reach: 'local',
      beat: 'Howard County news + politics' },
    { name: 'Carroll County Times', kind: 'print', reach: 'local',
      beat: 'Carroll County news + politics' },
    { name: 'The Washington Examiner', kind: 'digital', reach: 'national',
      url: 'https://www.washingtonexaminer.com',
      beat: 'DMV politics + national-conservative readership' },
    { name: 'The Free Press', kind: 'digital', reach: 'national',
      url: 'https://www.thefp.com',
      beat: 'Long-form bipartisan-skeptical analysis' },
    { name: 'The Hill', kind: 'digital', reach: 'national',
      url: 'https://thehill.com',
      beat: 'Federal politics + congressional races' },
    { name: 'The Daily Caller', kind: 'digital', reach: 'national',
      url: 'https://dailycaller.com',
      beat: 'National conservative news' }
  ]
};

/** State-level fallback outlets used when a district isn't enumerated yet.
 *  Pitched alongside the district list (or instead of, when the district has
 *  no specific entry). */
export const STATE_OUTLETS: Record<string, PressOutlet[]> = {
  MD: [
    { name: 'The Baltimore Banner', kind: 'digital', reach: 'regional',
      url: 'https://www.thebaltimorebanner.com' },
    { name: 'Maryland Matters', kind: 'digital', reach: 'regional',
      url: 'https://marylandmatters.org' },
    { name: 'WBAL-TV 11', kind: 'broadcast', reach: 'regional' }
  ]
};

/** Always-pitch national outlets — used when a story has crossover appeal. */
export const NATIONAL_POLITICAL_OUTLETS: PressOutlet[] = [
  { name: 'POLITICO', kind: 'digital', reach: 'national',
    url: 'https://www.politico.com', beat: 'Federal + campaign politics' },
  { name: 'The New York Times', kind: 'print', reach: 'national' },
  { name: 'The Washington Post', kind: 'print', reach: 'national' },
  { name: 'Associated Press', kind: 'wire', reach: 'national',
    beat: 'Wire — picked up everywhere' },
  { name: 'Reuters', kind: 'wire', reach: 'national' }
];

/**
 * Get the press outlet list for a district code. Combines district-specific
 * outlets with state fallback if the district isn't enumerated, so every
 * political_campaign client gets a non-empty list.
 *
 * Pass includeNational=true to append the national-political tier as well —
 * recommended when the story has cross-state interest (defense_pr crossover,
 * national policy moment, etc.).
 */
export function outletsForDistrict(
  districtCode: string | null | undefined,
  opts: { includeNational?: boolean } = {}
): PressOutlet[] {
  const code = (districtCode ?? '').trim().toUpperCase();
  const districtList = DISTRICT_OUTLETS[code] ?? [];
  if (districtList.length > 0) {
    return opts.includeNational
      ? [...districtList, ...NATIONAL_POLITICAL_OUTLETS]
      : districtList;
  }
  // Fall back to state outlets if we have them.
  const state = code.split('-')[0];
  const stateList = STATE_OUTLETS[state] ?? [];
  return opts.includeNational
    ? [...stateList, ...NATIONAL_POLITICAL_OUTLETS]
    : stateList;
}

/** Convenience: shape the outlets into press_touches seed rows for a client.
 *  Returns one "drafted" / "pending pitch" row per outlet so val sees them on
 *  the press desk the moment the political_campaign is onboarded. */
export interface PressTouchSeed {
  outletName: string;
  outletKind: PressOutlet['kind'];
  reach: PressOutlet['reach'];
  status: 'pending';
  notes: string;
}

export function seedPressTouchesForDistrict(
  districtCode: string | null | undefined,
  opts: { includeNational?: boolean } = {}
): PressTouchSeed[] {
  return outletsForDistrict(districtCode, opts).map((o) => ({
    outletName: o.name,
    outletKind: o.kind,
    reach: o.reach,
    status: 'pending' as const,
    notes: o.beat ? `Beat: ${o.beat}` : ''
  }));
}
