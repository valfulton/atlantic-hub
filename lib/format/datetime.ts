/**
 * lib/format/datetime.ts
 *
 * Hydration-safe date/time formatting.
 *
 * `new Date(x).toLocaleString()` with no timeZone uses the RUNTIME's zone —
 * UTC on the server (Netlify), local in the browser. That makes a client
 * component render different text on the server vs. the client, which trips
 * React hydration errors (#418 / #423 / #425). Pinning an explicit timeZone
 * makes the output identical in both places, so there's nothing to mismatch.
 *
 * ET matches the team's home zone (Washington, D.C.). Change DISPLAY_TZ here
 * and every timestamp in the app updates.
 */
const DISPLAY_TZ = 'America/New_York';

function toDate(v: string | number | Date | null | undefined): Date | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Date + time, e.g. "May 23, 2026, 6:35 PM". Empty string for null/invalid. */
export function fmtDateTime(v: string | number | Date | null | undefined): string {
  const d = toDate(v);
  if (!d) return '';
  return d.toLocaleString('en-US', { timeZone: DISPLAY_TZ, dateStyle: 'medium', timeStyle: 'short' });
}

/** Date only, e.g. "May 23, 2026". Empty string for null/invalid. */
export function fmtDate(v: string | number | Date | null | undefined): string {
  const d = toDate(v);
  if (!d) return '';
  return d.toLocaleDateString('en-US', { timeZone: DISPLAY_TZ, dateStyle: 'medium' });
}
