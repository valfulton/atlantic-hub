/**
 * HubNavStrip  (val 2026-06-17, #693 — "use what we've built")
 *
 * The connective tissue from the dashboard out to the rest of John's hub.
 *
 * The dashboard had become an isolated demo: race tracker + approvals strip +
 * drafts + a panel for opponent + endorsements, and then a dead end. John
 * couldn't tell from the surface that the rest of the engine was wired —
 * /client/campaigns (narrative-lines spine), /client/calendar (his approved
 * publish dates), /client/social/review (the pre-publish queue), /client/pr
 * (his press desk), /client/notes (notes back to val), /newsroom (his public
 * channel) — they were all there, but nothing on the dashboard pointed at
 * them as part of one platform.
 *
 * This strip is six cream pill cards with a small eyebrow, a Fraunces title,
 * and a one-line "why you'd go there." Honest empty-state at the per-route
 * level is each page's job; the strip's job is just to say: this is your hub,
 * and these are the rooms in it.
 *
 * Reusable per engagement_kind:
 *   - political_campaign — the political route set (campaigns / calendar /
 *     social / press desk / notes / newsroom)
 *   - defense_pr — press-forward set (campaigns / calendar / press desk /
 *     notes / newsroom)
 *   - luxury_hospitality — voice-forward set (campaigns / calendar / social /
 *     press desk / notes / newsroom)
 *   - book_pr — launch set (campaigns / calendar / press desk / notes /
 *     newsroom)
 *
 * Tokens only — no inline hex (HARD RULE all_color_via_tokens).
 */
import Link from 'next/link';
import type { EngagementKind } from '@/lib/client/engagement_kind';

interface HubLink {
  /** Stable id used for the React key. */
  id: string;
  /** Eyebrow over the title — small uppercase brand voice. */
  eyebrow: string;
  /** Fraunces serif title. */
  title: string;
  /** One-line "why you'd go there" — second-person, no engine vocab. */
  why: string;
  /** Internal app href. */
  href: string;
}

/** Per-kind route sets. Keep the political/defense/hospitality/book voices
 *  candidate / case / chapter / launch respectively. NO "narrative lines",
 *  "watchlist", or other engine words on the surface. */
function linksFor(kind: EngagementKind): HubLink[] {
  switch (kind) {
    case 'political_campaign':
      return [
        {
          id: 'campaigns',
          eyebrow: 'Your stories',
          title: 'Campaigns',
          why: 'The handful of stories your race is built on. Each one feeds press, social, and the calendar.',
          href: '/client/campaigns'
        },
        {
          id: 'calendar',
          eyebrow: 'On the schedule',
          title: 'Calendar',
          why: 'See when every approved piece is set to land. Drag to reschedule the ones you own.',
          href: '/client/calendar'
        },
        {
          id: 'social',
          eyebrow: 'Waiting on you',
          title: 'Social review',
          why: 'Posts your team drafted for your green-light, ready to go out the door.',
          href: '/client/social/review'
        },
        {
          id: 'pr',
          eyebrow: 'Press desk',
          title: 'In the press',
          why: 'Every journalist outreach, op-ed and quote on the record — the trail of coverage we are building.',
          href: '/client/pr'
        },
        {
          id: 'notes',
          eyebrow: 'Two-way',
          title: 'Notes',
          why: 'Send notes back on any draft. Your team reads every one and responds here.',
          href: '/client/notes'
        },
        {
          id: 'newsroom',
          eyebrow: 'Out in the world',
          title: 'Newsroom',
          why: 'Your public channel — what we have published under your name, ready to share.',
          href: '/newsroom'
        }
      ];
    case 'defense_pr':
      return [
        {
          id: 'campaigns',
          eyebrow: 'Your stories',
          title: 'Campaigns',
          why: 'The angles we are telling around your case. Each one feeds press, social, and the calendar.',
          href: '/client/campaigns'
        },
        {
          id: 'calendar',
          eyebrow: 'On the schedule',
          title: 'Calendar',
          why: 'See when every approved piece is set to land.',
          href: '/client/calendar'
        },
        {
          id: 'social',
          eyebrow: 'Waiting on you',
          title: 'Social review',
          why: 'Posts your team drafted for your green-light — your case story carried into your feed.',
          href: '/client/social/review'
        },
        {
          id: 'pr',
          eyebrow: 'Press desk',
          title: 'In the press',
          why: 'Every journalist outreach and quote on the record around your case.',
          href: '/client/pr'
        },
        {
          id: 'notes',
          eyebrow: 'Two-way',
          title: 'Notes',
          why: 'Send notes back on any draft. Your team reads every one and responds here.',
          href: '/client/notes'
        },
        {
          id: 'newsroom',
          eyebrow: 'Out in the world',
          title: 'Newsroom',
          why: 'Your public channel — what we have published, ready to share.',
          href: '/newsroom'
        }
      ];
    case 'luxury_hospitality':
      return [
        {
          id: 'campaigns',
          eyebrow: 'Your chapters',
          title: 'Campaigns',
          why: 'The handful of stories the season is built on. Each one feeds press, social, and the calendar.',
          href: '/client/campaigns'
        },
        {
          id: 'calendar',
          eyebrow: 'On the schedule',
          title: 'Calendar',
          why: 'See when every approved piece is set to land. Drag to reschedule the ones you own.',
          href: '/client/calendar'
        },
        {
          id: 'social',
          eyebrow: 'Waiting on you',
          title: 'Social review',
          why: 'Posts your team drafted for your green-light, ready to go out the door.',
          href: '/client/social/review'
        },
        {
          id: 'pr',
          eyebrow: 'Press desk',
          title: 'In the press',
          why: 'Every journalist outreach and quote on the record — the trail of coverage we are building.',
          href: '/client/pr'
        },
        {
          id: 'notes',
          eyebrow: 'Two-way',
          title: 'Notes',
          why: 'Send notes back on any draft. Your team reads every one and responds here.',
          href: '/client/notes'
        },
        {
          id: 'newsroom',
          eyebrow: 'Out in the world',
          title: 'Newsroom',
          why: 'Your public channel — what we have published, ready to share.',
          href: '/newsroom'
        }
      ];
    case 'book_pr':
      return [
        {
          id: 'campaigns',
          eyebrow: 'Your arcs',
          title: 'Campaigns',
          why: 'The handful of stories the launch is built on. Each one feeds press, social, and the calendar.',
          href: '/client/campaigns'
        },
        {
          id: 'calendar',
          eyebrow: 'On the schedule',
          title: 'Calendar',
          why: 'See when every approved piece is set to land.',
          href: '/client/calendar'
        },
        {
          id: 'social',
          eyebrow: 'Waiting on you',
          title: 'Social review',
          why: 'Posts your team drafted for your green-light, ready to go out the door.',
          href: '/client/social/review'
        },
        {
          id: 'pr',
          eyebrow: 'Press desk',
          title: 'In the press',
          why: 'Every journalist outreach and quote on the record around your launch.',
          href: '/client/pr'
        },
        {
          id: 'notes',
          eyebrow: 'Two-way',
          title: 'Notes',
          why: 'Send notes back on any draft. Your team reads every one and responds here.',
          href: '/client/notes'
        },
        {
          id: 'newsroom',
          eyebrow: 'Out in the world',
          title: 'Newsroom',
          why: 'Your public channel — what we have published, ready to share.',
          href: '/newsroom'
        }
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
    <section
      aria-label="Your hub"
      style={{
        margin: '28px 0 12px'
      }}
    >
      <div
        className="app-sh"
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 12,
          marginBottom: 12
        }}
      >
        <h3 style={{ margin: 0 }}>
          Your <em>hub</em>
        </h3>
        <span
          className="ct"
          style={{ fontSize: 12, color: 'var(--ink-mute, #5F5E5A)' }}
        >
          Six rooms — keep exploring
        </span>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 12
        }}
      >
        {links.map((link) => (
          <Link
            key={link.id}
            href={link.href}
            style={{
              display: 'block',
              padding: '14px 16px',
              background: 'var(--paper)',
              border: '1px solid var(--card-border)',
              borderLeft: '3px solid var(--emerald-deep)',
              borderRadius: 12,
              textDecoration: 'none',
              color: 'var(--ink)',
              boxShadow: '0 2px 8px var(--card-shadow)',
              transition: 'transform 0.18s ease, box-shadow 0.18s ease'
            }}
          >
            <div
              style={{
                fontFamily: 'var(--sans)',
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: 'var(--gold-deep, #7A5A18)',
                marginBottom: 4
              }}
            >
              {link.eyebrow}
            </div>
            <div
              style={{
                fontFamily: 'var(--serif)',
                fontSize: 18,
                fontWeight: 500,
                color: 'var(--emerald-deep)',
                marginBottom: 6,
                lineHeight: 1.2
              }}
            >
              {link.title}
            </div>
            <div
              style={{
                fontFamily: 'var(--sans)',
                fontSize: 13,
                lineHeight: 1.45,
                color: 'var(--ink-mute, #5F5E5A)'
              }}
            >
              {link.why}
            </div>
            <div
              style={{
                marginTop: 10,
                fontFamily: 'var(--sans)',
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--emerald-deep)'
              }}
            >
              Open →
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
