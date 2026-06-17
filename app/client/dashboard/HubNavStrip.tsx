/**
 * HubNavStrip  (val 2026-06-17, #695 — naming + visual cleanup of #693)
 *
 * Flat row of pill links that match the EXISTING operator-preview chip nav
 * (Dashboard · Matters · Leads · Watchlist · Campaigns · Calendar · Content ·
 * Press queue · Notes · Newsroom · ...). One canonical label per room — no
 * eyebrows, no synonyms, no second-line descriptions, no card grid.
 *
 * The drift fix from v1: every room had TWO names (eyebrow "Your stories" +
 * title "Campaigns", eyebrow "Two-way" + title "Notes", etc.). Killed both
 * layers. Use the same word the nav uses. One word, one room.
 *
 * Per-kind sets: political/defense/hospitality/book each get the rooms that
 * actually apply; lead_gen renders nothing so the existing surface is
 * untouched.
 */
import Link from 'next/link';
import type { EngagementKind } from '@/lib/client/engagement_kind';

interface HubLink {
  label: string;
  href: string;
}

/** Canonical room sets per kind. Labels match the operator-preview chip nav
 *  (the "SEE WHAT JOHN WHITE SEES" strip) so the client view, the operator
 *  preview, and this hub strip all use the same word for the same room. */
function linksFor(kind: EngagementKind): HubLink[] {
  switch (kind) {
    case 'political_campaign':
      return [
        { label: 'Campaigns',   href: '/client/campaigns' },
        { label: 'Calendar',    href: '/client/calendar' },
        { label: 'Content',     href: '/client/content' },
        { label: 'Press queue', href: '/client/pr' },
        { label: 'Notes',       href: '/client/notes' },
        { label: 'Newsroom',    href: '/newsroom' }
      ];
    case 'defense_pr':
      return [
        { label: 'Campaigns',   href: '/client/campaigns' },
        { label: 'Calendar',    href: '/client/calendar' },
        { label: 'Content',     href: '/client/content' },
        { label: 'Press queue', href: '/client/pr' },
        { label: 'Notes',       href: '/client/notes' },
        { label: 'Newsroom',    href: '/newsroom' }
      ];
    case 'luxury_hospitality':
      return [
        { label: 'Campaigns',   href: '/client/campaigns' },
        { label: 'Calendar',    href: '/client/calendar' },
        { label: 'Content',     href: '/client/content' },
        { label: 'Press queue', href: '/client/pr' },
        { label: 'Notes',       href: '/client/notes' },
        { label: 'Newsroom',    href: '/newsroom' }
      ];
    case 'book_pr':
      return [
        { label: 'Campaigns',   href: '/client/campaigns' },
        { label: 'Calendar',    href: '/client/calendar' },
        { label: 'Content',     href: '/client/content' },
        { label: 'Press queue', href: '/client/pr' },
        { label: 'Notes',       href: '/client/notes' },
        { label: 'Newsroom',    href: '/newsroom' }
      ];
    case 'lead_gen':
    default:
      // lead_gen keeps its current dashboard surface (leads + watchlist do the
      // talking). Returning empty hides the strip entirely.
      return [];
  }
}

export default function HubNavStrip({ kind }: { kind: EngagementKind }) {
  const links = linksFor(kind);
  if (links.length === 0) return null;

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
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
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
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
