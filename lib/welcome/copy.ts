/**
 * lib/welcome/copy.ts  (#408, val 2026-06-03)
 *
 * Operator-editable copy for the WelcomePopover slides. val edits the
 * strings at /admin/av/popups; this lib loads the override or falls back
 * to the hardcoded defaults.
 *
 * Defaults are KEPT here intentionally so that a broken DB row or a fresh
 * deploy never crashes the popover — there's always a sane string.
 */
import { getAvDb } from '@/lib/db/av';
import type { RowDataPacket } from 'mysql2';
import { getCopyMap } from '@/lib/copy/store';
import { ENGAGEMENT_KIND_CONFIG, type EngagementKind } from '@/lib/client/engagement_kind';

export interface WelcomeSlide {
  eyebrow: string;
  title: string;
  body: string;
  /** Optional inline link. Both fields must be set for the link to render. */
  hrefLabel?: string;
  href?: string;
  /** Slide only renders when the client's tier is in this list. Omit = always show. */
  tiers?: Array<'audit_only' | 'sprint' | 'momentum' | 'scale'>;
}

/** The factory defaults shown if no override row exists. Edit these in
 *  /admin/av/popups instead of touching this file for a one-off copy
 *  tweak — but keep them honest as a safety net. */
export const DEFAULT_SLIDES: WelcomeSlide[] = [
  {
    eyebrow: 'Welcome',
    title: 'Hi {firstName}.',
    body: "This is {brandName}'s home at Atlantic & Vine. Leads, audits, press, content — all in one place."
  },
  {
    eyebrow: 'Your pipeline',
    title: 'Prospects, scored for fit.',
    body: 'Businesses that match your ideal customer profile, scored against your brief, ranked highest-fit first.',
    hrefLabel: 'See your leads →',
    href: '/client/leads'
  },
  {
    eyebrow: 'Your press queue',
    title: 'Press opportunities in your voice.',
    body: 'When a journalist asks for an expert on something you cover, a drafted pitch lands here. You approve before anything goes out.',
    hrefLabel: 'See your press queue →',
    href: '/client/pr',
    tiers: ['sprint', 'momentum', 'scale']
  },
  {
    eyebrow: 'Your rhythm',
    title: "You'll hear from us each Friday.",
    body: 'A short summary of what moved that week — new leads, hot fits, press matches. Open the hub any time between.'
  }
];

const POPUP_ID = 'welcome_popover';

interface CopyRow extends RowDataPacket { payload: string }

export async function getWelcomePopupSlides(): Promise<WelcomeSlide[]> {
  try {
    const db = getAvDb();
    const [rows] = await db.execute<CopyRow[]>(
      'SELECT payload FROM popup_copy WHERE popup_id = ? LIMIT 1',
      [POPUP_ID]
    );
    if (!rows[0]) return DEFAULT_SLIDES;
    const parsed = JSON.parse(rows[0].payload);
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_SLIDES;
    // Trust the editor's shape — it validates server-side on save.
    return parsed as WelcomeSlide[];
  } catch {
    return DEFAULT_SLIDES;
  }
}

export async function saveWelcomePopupSlides(slides: WelcomeSlide[], updatedBy?: string): Promise<void> {
  const db = getAvDb();
  const payload = JSON.stringify(slides);
  await db.execute(
    `INSERT INTO popup_copy (popup_id, payload, updated_by)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE payload = VALUES(payload), updated_by = VALUES(updated_by)`,
    [POPUP_ID, payload, updatedBy ?? null]
  );
}

/* ------------------------------------------------------------------ *
 * Per-engagement-kind welcome popover (#551)
 *
 * Non-lead_gen engagements get a kind-specific welcome: the slide TITLES are
 * editable per client at /admin/av/copy (keys welcome.<kind>.sN), while the
 * eyebrow / supporting body / link are fixed frames below. Three slides per
 * kind, matched positionally to the three welcome.<kind>.s1..s3 keys in
 * lib/copy/store.ts. lead_gen continues to use getWelcomePopupSlides() (the
 * legacy /admin/av/popups popover) — its frames are defined here only for
 * symmetry / future migration.
 * ------------------------------------------------------------------ */
type WelcomeFrame = Omit<WelcomeSlide, 'title'>;

const WELCOME_FRAMES: Record<EngagementKind, WelcomeFrame[]> = {
  lead_gen: [
    { eyebrow: 'Welcome', body: "This is {brandName}'s home at Atlantic & Vine. Leads, audits, press, content — all in one place." },
    { eyebrow: 'Your pipeline', body: 'Businesses that match your ideal customer profile, scored against your brief, ranked highest-fit first.', hrefLabel: 'See your leads →', href: '/client/leads' },
    { eyebrow: 'Your rhythm', body: 'A short summary of what moved that week — new leads, hot fits, press matches. Open the hub any time between.' }
  ],
  defense_pr: [
    { eyebrow: 'Welcome', body: 'This is your defense desk at Atlantic & Vine. The case, the press window, and the people who tell your story — in one place.' },
    { eyebrow: 'Your desk', body: 'We track the narrative around your case and turn it into press your counsel can stand behind.', hrefLabel: 'See your press →', href: '/client/pr' },
    { eyebrow: 'Your rhythm', body: 'When the news moves, we move — a drafted response lands here for your approval before anything goes out.' }
  ],
  political_campaign: [
    { eyebrow: 'Welcome', body: 'This is your campaign desk at Atlantic & Vine. Your district, your message, and your press — in one place.' },
    { eyebrow: 'Your district', body: 'We read where your district is moving and turn it into talking points and narrative lines.', hrefLabel: 'See your press →', href: '/client/pr' },
    { eyebrow: 'Your green-light', body: 'Nothing ships without your approval. Drafts wait here for your sign-off.' }
  ],
  luxury_hospitality: [
    { eyebrow: 'Welcome', body: 'This is your voyage desk at Atlantic & Vine. Each port, each story, each press hit — in one place.' },
    { eyebrow: 'The next stop', body: 'We turn each port into a chapter worth covering.', hrefLabel: 'See your press →', href: '/client/pr' },
    { eyebrow: 'Your rhythm', body: 'Stories from the next stop land here as the tour unfolds.' }
  ],
  book_pr: [
    { eyebrow: 'Welcome', body: 'This is your launch desk at Atlantic & Vine. The arc, the press, and the launch — in one place.' },
    { eyebrow: 'Your arc', body: "We map your book's story arc to the media moments that sell it.", hrefLabel: 'See your press →', href: '/client/pr' },
    { eyebrow: 'Your launch', body: 'Media wins for the launch land here as we book them.' }
  ]
};

/**
 * Welcome slides for a non-lead_gen engagement. Titles resolve through the
 * site_copy chain (client override → kind global default → hardcoded DEFAULT);
 * eyebrow/body/link come from the fixed frame for that kind + slide position.
 * Token substitution ({firstName}/{brandName}) happens in the popover at
 * render, same as every other slide source.
 */
export async function getWelcomeSlidesForEngagement(args: {
  clientId: number | null;
  kind: EngagementKind;
}): Promise<WelcomeSlide[]> {
  const { clientId, kind } = args;
  const keys = ENGAGEMENT_KIND_CONFIG[kind]?.welcomePopoverKeys ?? [];
  const frames = WELCOME_FRAMES[kind] ?? WELCOME_FRAMES.lead_gen;
  if (keys.length === 0) return DEFAULT_SLIDES;
  // getCopyMap seeds every key with its DEFAULT, so titles are always present.
  const titles = await getCopyMap(keys, { clientId: clientId ?? undefined });
  return keys.map((k, i) => {
    const frame = frames[i] ?? frames[frames.length - 1];
    return { ...frame, title: titles[k] };
  });
}

/** Render-time substitution for the popover. Replaces {firstName} and
 *  {brandName} tokens in title/body/eyebrow with the values from the user's
 *  session. Leaves unknown tokens alone so val can spot typos. */
export function applyTokens(slide: WelcomeSlide, ctx: { firstName: string; brandName: string }): WelcomeSlide {
  const sub = (s: string) =>
    s.replace(/\{firstName\}/g, ctx.firstName).replace(/\{brandName\}/g, ctx.brandName);
  return {
    ...slide,
    eyebrow: sub(slide.eyebrow),
    title: sub(slide.title),
    body: sub(slide.body),
    hrefLabel: slide.hrefLabel ? sub(slide.hrefLabel) : slide.hrefLabel
  };
}
