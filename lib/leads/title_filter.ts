/**
 * lib/leads/title_filter.ts  (#252 Inc 2)
 *
 * Apply a client's ICP "preferred / excluded contact titles" to a candidate
 * list of people from any discovery source (Apollo, Hunter people-search,
 * Apify-scraped contacts, future Yelp / BBB). One function, used everywhere
 * "pick the top person" happens — so Skip's "no HR" rule and val's "prefer
 * CEO/Founder" rule fire the same way no matter which source surfaced the
 * candidate.
 *
 * Matching:
 *   - Case-insensitive substring match (lowercase-normalized).
 *   - A title MATCHES a list entry when ANY token of the entry appears as a
 *     substring of the candidate title. So `HR` matches `Head of HR`, `VP HR`,
 *     `HR Business Partner`. `Recruiter` matches `Senior Technical Recruiter`.
 *     `CEO` matches `CEO & Founder`. We deliberately match permissively because
 *     real-world titles are noisy and "exact match only" would let too many
 *     gate-keepers slip through.
 *   - Empty candidate title -> NEITHER list matches; the person stays as a
 *     neutral candidate (we don't drop someone for not having a title).
 *
 * Ranking:
 *   - 2 = excluded (caller usually drops these BEFORE sorting; this is a
 *         belt-and-suspenders rank for any survivor)
 *   - 1 = preferred match (sort first)
 *   - 0 = neither matched (sort after preferred)
 *
 * Result: filter() drops excluded; sort() puts preferred at the top. Use
 * `filterAndRank` to get both in one call.
 */

export interface TitlePrefs {
  /** Lowercase substrings that mark a candidate as PREFERRED (CEO, Founder…). */
  preferred: string[];
  /** Lowercase substrings that mark a candidate as EXCLUDED (HR, Recruiter…). */
  excluded: string[];
}

/** True when this prefs object has at least one filter rule. Caller can skip
 *  any extra Apollo fetch budget when there are no rules to enforce. */
export function hasTitleFilters(p: TitlePrefs): boolean {
  return p.preferred.length > 0 || p.excluded.length > 0;
}

/** Normalize once at the boundary so downstream comparisons are deterministic. */
export function buildTitlePrefs(args: {
  preferredContactTitles?: string[] | null;
  excludedContactTitles?: string[] | null;
}): TitlePrefs {
  const norm = (a?: string[] | null): string[] =>
    (a ?? [])
      .map((s) => (typeof s === 'string' ? s.trim().toLowerCase() : ''))
      .filter((s): s is string => s.length > 0);
  return {
    preferred: norm(args.preferredContactTitles),
    excluded: norm(args.excludedContactTitles)
  };
}

/** Does this candidate title match ANY pattern in the list? */
function matchesAny(title: string, patterns: string[]): boolean {
  if (!title || patterns.length === 0) return false;
  const hay = title.toLowerCase();
  return patterns.some((p) => hay.includes(p));
}

/**
 * Rank a single candidate: 2 excluded, 1 preferred, 0 neutral.
 * Excluded wins over preferred when both match (defensive — caller should
 * drop excluded entries before ranking, but a CEO title that ALSO contains
 * "HR" somewhere is a real-world possibility we shouldn't preferred-up).
 */
export function rankTitle(title: string | null | undefined, prefs: TitlePrefs): 0 | 1 | 2 {
  const t = (title ?? '').trim();
  if (!t) return 0;
  if (matchesAny(t, prefs.excluded)) return 2;
  if (matchesAny(t, prefs.preferred)) return 1;
  return 0;
}

export interface FilterCounts {
  /** Candidates removed because their title matched an excluded pattern. */
  excluded: number;
  /** Candidates ranked first because their title matched a preferred pattern. */
  preferred: number;
  /** Candidates that matched neither list — kept as neutral fallbacks. */
  neutral: number;
}

/**
 * Drop excluded, sort preferred-first, return ordered list + a count report so
 * the caller can log "skipped 3 HR titles for client X" without re-running the
 * filter logic. Generic over any candidate shape that has a title field —
 * pass a getter so we don't pin the input type.
 */
export function filterAndRank<T>(
  candidates: T[],
  getTitle: (c: T) => string | null | undefined,
  prefs: TitlePrefs
): { kept: T[]; counts: FilterCounts } {
  if (!hasTitleFilters(prefs)) {
    return {
      kept: candidates,
      counts: { excluded: 0, preferred: 0, neutral: candidates.length }
    };
  }

  const counts: FilterCounts = { excluded: 0, preferred: 0, neutral: 0 };
  const ranked: { item: T; rank: 0 | 1 }[] = [];

  for (const c of candidates) {
    const r = rankTitle(getTitle(c), prefs);
    if (r === 2) {
      counts.excluded += 1;
      continue;
    }
    if (r === 1) counts.preferred += 1;
    else counts.neutral += 1;
    // Preferred (1) sorts before neutral (0) — invert so JS default ASC works.
    ranked.push({ item: c, rank: r === 1 ? 0 : 1 });
  }
  ranked.sort((a, b) => a.rank - b.rank);
  return { kept: ranked.map((r) => r.item), counts };
}
