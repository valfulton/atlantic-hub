/**
 * client_nav_items.ts  (val 2026-06-17, #696 — single source of room labels)
 *
 * The ONE canonical list of /client/* rooms + the label each one renders
 * under. Every client surface that names a room reads from here:
 *
 *   - ClientV3TopNav (desktop top nav)
 *   - BottomTabBar mirror (mobile — when it adopts this constant)
 *   - HubNavStrip (dashboard "keep exploring" pill row)
 *   - any future "where do I go next" strip on a kind-specific surface
 *
 * The drift problem this file fixes: every time a surface hand-typed its
 * own label, the same room collected synonyms ("Press" vs "Press queue" vs
 * "Press desk" vs "In the press" — same /client/pr route, four different
 * names). Now there's one label per href and any UI that wants to name a
 * room must import from here.
 *
 * Adding a room: add it to NAV_ITEMS once. The top nav picks it up
 * automatically; surfaces that opt in via `idsForKind()` get it too.
 *
 * Renaming a room: change the label here. Every surface follows.
 */

/** A single nav-able room in the client portal. */
export interface ClientNavItem {
  /** Stable identifier — used by surfaces that opt into a subset. Never
   *  rename without a sweep. */
  id:
    | 'home'
    | 'matters'
    | 'leads'
    | 'watchlist'
    | 'campaigns'
    | 'calendar'
    | 'content'
    | 'press'
    | 'notes'
    | 'newsroom';
  href: string;
  /** Canonical user-facing label. ONE per room. Do not synonym-pile in any
   *  individual surface — change it here instead. */
  label: string;
}

/** The single source of truth. ClientV3TopNav iterates this directly. */
export const NAV_ITEMS: readonly ClientNavItem[] = [
  { id: 'home',      href: '/client/dashboard',  label: 'Home' },
  // Matters — case-management surface (defense_pr family clients reach
  // Johnson via this link). #433 nav-parity rule: mirror entry in
  // OperatorPreviewChrome TABS must move with this one.
  { id: 'matters',   href: '/client/cases',      label: 'Matters' },
  { id: 'leads',     href: '/client/leads',      label: 'Leads' },
  { id: 'watchlist', href: '/client/watchlist',  label: 'Watchlist' },
  // Campaigns + Calendar — the narrative-line spine + the approval queue.
  { id: 'campaigns', href: '/client/campaigns',  label: 'Campaigns' },
  { id: 'calendar',  href: '/client/calendar',   label: 'Calendar' },
  // Content Studio — generated posts ready to approve.
  { id: 'content',   href: '/client/content',    label: 'Content' },
  // Press desk — journalist outreach + coverage trail.
  { id: 'press',     href: '/client/pr',         label: 'Press' },
  // Notes — two-way thread to the A&V team.
  { id: 'notes',     href: '/client/notes',      label: 'Notes' },
  // Newsroom — public Wire (same URL for client + operator).
  { id: 'newsroom',  href: '/newsroom',          label: 'Newsroom' }
] as const;

/** Look an item up by id. Throws (would be a typo) if missing. */
export function navItem(id: ClientNavItem['id']): ClientNavItem {
  const found = NAV_ITEMS.find((n) => n.id === id);
  if (!found) throw new Error(`[client_nav_items] unknown nav id: ${id}`);
  return found;
}
