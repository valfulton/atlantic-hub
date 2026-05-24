/**
 * lib/calendar/holidays.ts
 *
 * Fun, marketing-relevant US holidays for the calendar — so the grid is never
 * barren and reps/clients see seasonal hooks to plan around. Pure + dateless of
 * any external data; computes any year on the fly. Important client dates
 * (birthdays, busy seasons) layer on top of these later (see task #69).
 */
export interface Holiday {
  iso: string;   // YYYY-MM-DD
  name: string;
  emoji: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m0: number, d: number) => `${y}-${pad(m0 + 1)}-${pad(d)}`;

/** The date of the Nth given weekday in a month. weekday: 0=Sun..6=Sat. */
function nthWeekday(year: number, month0: number, weekday: number, n: number): number {
  const first = new Date(year, month0, 1).getDay();
  const offset = (weekday - first + 7) % 7;
  return 1 + offset + (n - 1) * 7;
}
/** The date of the LAST given weekday in a month. */
function lastWeekday(year: number, month0: number, weekday: number): number {
  const days = new Date(year, month0 + 1, 0).getDate();
  const last = new Date(year, month0, days).getDay();
  return days - ((last - weekday + 7) % 7);
}

/** All holidays for a single calendar year. */
export function holidaysForYear(year: number): Holiday[] {
  const thanksgiving = nthWeekday(year, 10, 4, 4); // 4th Thursday of Nov
  const list: Holiday[] = [
    { iso: iso(year, 0, 1), name: "New Year's Day", emoji: '🎉' },
    { iso: iso(year, 1, 14), name: "Valentine's Day", emoji: '💝' },
    { iso: iso(year, 2, 17), name: "St. Patrick's Day", emoji: '☘️' },
    { iso: iso(year, 3, 22), name: 'Earth Day', emoji: '🌎' },
    { iso: iso(year, 4, 5), name: 'Cinco de Mayo', emoji: '🎊' },
    { iso: iso(year, 4, nthWeekday(year, 4, 0, 2)), name: "Mother's Day", emoji: '💐' },
    { iso: iso(year, 4, lastWeekday(year, 4, 1)), name: 'Memorial Day', emoji: '🇺🇸' },
    { iso: iso(year, 5, nthWeekday(year, 5, 0, 3)), name: "Father's Day", emoji: '👔' },
    { iso: iso(year, 5, 19), name: 'Juneteenth', emoji: '✊' },
    { iso: iso(year, 6, 4), name: 'Independence Day', emoji: '🎆' },
    { iso: iso(year, 8, nthWeekday(year, 8, 1, 1)), name: 'Labor Day', emoji: '🛠️' },
    { iso: iso(year, 9, 31), name: 'Halloween', emoji: '🎃' },
    { iso: iso(year, 10, 11), name: 'Singles Day', emoji: '🛒' },
    { iso: iso(year, 10, thanksgiving), name: 'Thanksgiving', emoji: '🦃' },
    { iso: iso(year, 10, thanksgiving + 1), name: 'Black Friday', emoji: '🛍️' },
    { iso: iso(year, 10, thanksgiving + 2), name: 'Small Business Saturday', emoji: '🏪' },
    { iso: iso(year, 10, thanksgiving + 4), name: 'Cyber Monday', emoji: '💻' },
    { iso: iso(year, 11, 24), name: 'Christmas Eve', emoji: '🎄' },
    { iso: iso(year, 11, 25), name: 'Christmas', emoji: '🎁' },
    { iso: iso(year, 11, 31), name: "New Year's Eve", emoji: '🥂' }
  ];
  return list;
}

/** Map of iso-date -> holiday across the given years (covers a calendar window). */
export function holidayMap(years: number[]): Map<string, Holiday> {
  const m = new Map<string, Holiday>();
  for (const y of new Set(years)) {
    for (const h of holidaysForYear(y)) m.set(h.iso, h);
  }
  return m;
}
