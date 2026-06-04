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
