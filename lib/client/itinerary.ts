/**
 * lib/client/itinerary.ts
 *
 * Itinerary parser + next-stops resolver for luxury_hospitality engagement (#550 v2).
 *
 * Reads brief.itinerary as a JSON array of stops. Pure functions, no DB.
 * Tolerant of string OR array input and bad date formats — returns [] cleanly.
 *
 * Shape (loose; missing fields default to undefined):
 *   {
 *     port: 'Cap d\'Antibes',
 *     arrival: '2026-07-12',
 *     departure: '2026-07-19',
 *     local_press_outlets: ['Nice Matin', 'BoatInternational'],
 *     notes: 'Lyons wedding anniversary stop'
 *   }
 */

export interface ItineraryStop {
  port: string;
  arrival: string | null;          // ISO date string (YYYY-MM-DD) or null
  departure: string | null;        // ISO date string or null
  localPressOutlets: string[];
  notes: string | null;
}

interface RawStop {
  port?: string;
  arrival?: string;
  departure?: string;
  local_press_outlets?: string[] | string;
  localPressOutlets?: string[] | string;
  notes?: string;
}

function normalizeStop(r: unknown): ItineraryStop | null {
  if (!r || typeof r !== 'object') return null;
  const o = r as RawStop;
  const port = typeof o.port === 'string' ? o.port.trim() : '';
  if (!port) return null;
  const arrival = typeof o.arrival === 'string' && o.arrival.trim() ? o.arrival.trim() : null;
  const departure = typeof o.departure === 'string' && o.departure.trim() ? o.departure.trim() : null;
  const rawOutlets = o.local_press_outlets ?? o.localPressOutlets;
  const localPressOutlets: string[] = Array.isArray(rawOutlets)
    ? rawOutlets.map(String).map((s) => s.trim()).filter(Boolean)
    : typeof rawOutlets === 'string'
      ? rawOutlets.split(/[,;]/).map((s) => s.trim()).filter(Boolean)
      : [];
  const notes = typeof o.notes === 'string' && o.notes.trim() ? o.notes.trim() : null;
  return { port, arrival, departure, localPressOutlets, notes };
}

/**
 * Parse brief.itinerary into a typed array. Accepts:
 *   - actual array (preferred)
 *   - JSON-string array
 *   - newline-separated `port — arrival → departure` rows (fallback for hand-typed briefs)
 *   - undefined / null / empty → []
 */
export function parseItinerary(brief: Record<string, unknown> | null | undefined): ItineraryStop[] {
  if (!brief) return [];
  const raw = (brief as Record<string, unknown>).itinerary;
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw.map(normalizeStop).filter((s): s is ItineraryStop => !!s);
  if (typeof raw !== 'string') return [];
  const t = raw.trim();
  if (!t) return [];
  if (t.startsWith('[')) {
    try {
      const arr = JSON.parse(t) as unknown;
      if (Array.isArray(arr)) return arr.map(normalizeStop).filter((s): s is ItineraryStop => !!s);
    } catch {
      /* fall through to plain text parse */
    }
  }
  // Hand-typed fallback: one stop per line, port — arrival → departure
  return t.split(/\n+/).map((line) => {
    const port = line.split(/[—\-→]/)[0]?.trim();
    if (!port) return null;
    const dates = line.match(/\d{4}-\d{2}-\d{2}/g) ?? [];
    return normalizeStop({
      port,
      arrival: dates[0],
      departure: dates[1]
    });
  }).filter((s): s is ItineraryStop => !!s);
}

function dateValue(d: string | null): number {
  if (!d) return 0;
  const t = Date.parse(d);
  return Number.isFinite(t) ? t : 0;
}

/**
 * Return the next N stops whose arrival or departure is >= now, sorted by
 * arrival ascending. Falls back to including dateless stops at the end.
 */
export function nextStops(stops: ItineraryStop[], n = 3, now: Date = new Date()): ItineraryStop[] {
  const nowT = now.getTime();
  const upcoming = stops.filter((s) => {
    const a = dateValue(s.arrival);
    const d = dateValue(s.departure);
    return (a && a >= nowT) || (d && d >= nowT) || (!a && !d);
  });
  upcoming.sort((a, b) => dateValue(a.arrival) - dateValue(b.arrival));
  return upcoming.slice(0, Math.max(1, Math.min(20, Math.floor(n))));
}

/** Days from now to a stop's arrival; negative if arrival is past. */
export function daysToArrival(stop: ItineraryStop, now: Date = new Date()): number | null {
  const a = dateValue(stop.arrival);
  if (!a) return null;
  return Math.round((a - now.getTime()) / 86_400_000);
}
