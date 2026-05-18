/**
 * lib/ui/once_per_day.ts
 *
 * Daily gate for one-time-per-day UI effects (confetti, sounds, etc.).
 * Backed by localStorage. SSR-safe -- returns false / no-ops on the server.
 *
 * Pattern:
 *   if (!hasFiredToday('hot_lead_confetti')) {
 *     fireConfetti();
 *     markFiredToday('hot_lead_confetti');
 *   }
 *
 * Day boundary uses the user's local timezone via the Date YYYY-MM-DD
 * string, so "today" matches what the operator sees on their wall clock.
 * No need to coordinate with UTC -- this is a UX concern, not data.
 */

const PREFIX = 'ah_once_per_day:';

function todayKey(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function hasFiredToday(key: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const stored = window.localStorage.getItem(PREFIX + key);
    return stored === todayKey();
  } catch {
    // localStorage can throw in private-browsing on some browsers
    return false;
  }
}

export function markFiredToday(key: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PREFIX + key, todayKey());
  } catch {
    // swallow -- worst case the effect fires again next page load
  }
}

/**
 * Manual reset (useful for QA / "fire it again" buttons in dev mode).
 */
export function resetToday(key: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(PREFIX + key);
  } catch {
    // swallow
  }
}
