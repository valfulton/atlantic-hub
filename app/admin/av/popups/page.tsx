/**
 * /admin/av/popups  (#408, val 2026-06-03)
 *
 * Operator-only editor for the WelcomePopover slide copy. val edits the
 * eyebrow/title/body for each of the onboarding slides without touching
 * code. Save persists to popup_copy.payload (JSON). Defaults stay in
 * lib/welcome/copy.ts as a safety net.
 */
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getWelcomePopupSlides, DEFAULT_SLIDES } from '@/lib/welcome/copy';
import PopupCopyEditor from './PopupCopyEditor';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function PopupsPage() {
  const role = headers().get('x-ah-user-role') as 'owner' | 'staff' | 'client_user' | null;
  if (role !== 'owner' && role !== 'staff') redirect('/admin');

  const slides = await getWelcomePopupSlides();

  return (
    <div className="max-w-5xl">
      <header className="mb-8">
        <p className="text-[10px] uppercase tracking-[0.22em] text-muted mb-2">Onboarding</p>
        <h1 className="text-2xl sm:text-3xl font-semibold text-ink tracking-tight">
          Welcome popover copy
        </h1>
        <p className="text-muted text-sm mt-3 max-w-2xl leading-relaxed">
          The three-step card-flip every client sees the first time they log in. Edit the eyebrow,
          headline, and body for each slide. Use <code className="text-ink">{'{firstName}'}</code> and{' '}
          <code className="text-ink">{'{brandName}'}</code> as tokens — they&apos;ll substitute live for the signed-in client.
        </p>
      </header>

      <PopupCopyEditor initialSlides={slides} defaults={DEFAULT_SLIDES} />
    </div>
  );
}
