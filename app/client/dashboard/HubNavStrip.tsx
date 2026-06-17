/**
 * HubNavStrip  (val 2026-06-17, #696 — single source of nav labels)
 *
 * Flat row of pill links reading from `client_nav_items.ts`, the SAME
 * source ClientV3TopNav reads from. There is no per-room label or href in
 * this file — only a list of ids to show for each engagement kind. Rename
 * a room in one place and every surface follows; the drift from earlier
 * today ("Press" vs "Press queue" vs "Press desk" vs "In the press" — same
 * route, four made-up names) can't repeat.
 *
 * Per-kind subset: rooms relevant to the kind, minus 'home' (we're on it).
 * lead_gen returns [] so its existing surface stays untouched.
 */
import Link from 'next/link';
import { NAV_ITEMS, type ClientNavItem } from '@/app/client/_components/client_nav_items';
import type { EngagementKind } from '@/lib/client/engagement_kind';

/** Which canonical room ids to surface for each engagement kind. Labels +
 *  hrefs are NEVER hardcoded here — they live in client_nav_items.ts. */
function idsForKind(kind: EngagementKind): ClientNavItem['id'][] {
  switch (kind) {
    case 'political_campaign':
    case 'defense_pr':
    case 'luxury_hospitality':
    case 'book_pr':
      return ['campaigns', 'calendar', 'content', 'press', 'notes', 'newsroom'];
    case 'lead_gen':
    default:
      return [];
  }
}

export default function HubNavStrip({ kind }: { kind: EngagementKind }) {
  const ids = idsForKind(kind);
  if (ids.length === 0) return null;
  const items = ids
    .map((id) => NAV_ITEMS.find((n) => n.id === id))
    .filter((n): n is ClientNavItem => !!n);

  return (
    <nav
      aria-label="Your hub"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 8,
        margin: '20px 0 4px'
      }}
    >
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          style={{
            fontFamily: 'var(--sans)',
            fontSize: 13,
            fontWeight: 500,
            color: 'var(--emerald-deep)',
            background: 'var(--paper)',
            border: '1px solid var(--card-border)',
            padding: '6px 14px',
            borderRadius: 999,
            textDecoration: 'none',
            whiteSpace: 'nowrap'
          }}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
