/**
 * lib/ui/presentation_mode.ts  (#361, val 2026-06-02)
 *
 * Operator setting that hides "engineering reality" surfaces (model names,
 * dollar costs, technical failure reasons) when val is showing the hub to
 * investors / clients / press. Persists in a cookie so it survives navigation
 * and works for server-rendered surfaces too.
 *
 * Flipping it ON does NOT change any underlying behavior — it's purely a
 * display filter via the `usePresentationMode()` hook (client) or
 * `getPresentationMode()` helper (server components).
 */

export const PRESENTATION_COOKIE = 'av_presentation_mode';

/** Server-side reader. Pass next/headers cookies(). */
export function getPresentationMode(cookies: { get(name: string): { value: string } | undefined }): boolean {
  const v = cookies.get(PRESENTATION_COOKIE)?.value;
  return v === '1' || v === 'true';
}

/**
 * Client-side check for client components. Reads document.cookie directly.
 * Returns false during SSR (server-rendered surfaces should use the server
 * helper above; the client hook is for inline filtering inside use-client).
 */
export function isPresentationModeClient(): boolean {
  if (typeof document === 'undefined') return false;
  const match = document.cookie.split('; ').find((row) => row.startsWith(`${PRESENTATION_COOKIE}=`));
  if (!match) return false;
  const v = decodeURIComponent(match.split('=')[1] ?? '');
  return v === '1' || v === 'true';
}
