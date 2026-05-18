/**
 * components/LeadOfTheDay.tsx
 *
 * "Your hottest lead this morning" card. Server component.
 *
 * Renders above the leads table on /admin/av. Shows the single highest-
 * scored NEW lead from the last 24 hours. If nothing qualifies, renders
 * NOTHING -- no empty state, silence is fine. The card should feel like
 * a payoff, not a placeholder.
 *
 * Eligibility:
 *   - lead_status = 'new'
 *   - aiScore is populated
 *   - submissionDate within the last 24 hours
 *   - aiScoreBand in ('hot', 'warm') -- skip 'cool' so this card always
 *     points to a lead worth chasing
 */

import Link from 'next/link';
import { serverFetch } from '@/lib/server-fetch';
import type { AvLead } from '@/app/admin/av/AvLeadsTable';

interface LeadWithReason extends AvLead {
  aiScoreReason?: string | null;
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function bandStyles(band: string | null) {
  if (band === 'hot') return 'from-rose-500/20 to-rose-500/5 border-rose-500/40';
  if (band === 'warm') return 'from-amber-500/20 to-amber-500/5 border-amber-500/40';
  return 'from-sky-500/20 to-sky-500/5 border-sky-500/40';
}

function bandLabel(band: string | null) {
  if (band === 'hot') return 'Hot lead';
  if (band === 'warm') return 'Warm lead';
  return 'New lead';
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diffMs = Date.now() - then;
  const mins = Math.round(diffMs / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  return `${hrs}h ago`;
}

export async function LeadOfTheDay() {
  const res = await serverFetch(
    '/api/admin/av/leads?stage=new&sort=score&direction=desc'
  );
  if (!res.ok) return null;
  let data: { leads?: LeadWithReason[] };
  try {
    data = await res.json();
  } catch {
    return null;
  }
  const leads = data.leads ?? [];

  // Pick the highest-scored new lead from the last 24h that is hot or warm.
  const cutoff = Date.now() - ONE_DAY_MS;
  const candidate = leads.find((l) => {
    if (l.aiScore === null) return false;
    if (l.aiScoreBand !== 'hot' && l.aiScoreBand !== 'warm') return false;
    const ts = new Date(l.submissionDate).getTime();
    if (Number.isNaN(ts)) return false;
    return ts >= cutoff;
  });
  if (!candidate) return null;

  return (
    <Link
      href={`/admin/av/${candidate.auditId}`}
      className={[
        'group relative block mb-6 rounded-xl border bg-gradient-to-r p-4 transition-all',
        'hover:scale-[1.005] hover:shadow-[0_8px_32px_rgba(0,0,0,0.35)]',
        bandStyles(candidate.aiScoreBand)
      ].join(' ')}
    >
      <div className="flex items-center gap-4">
        <div className="shrink-0 flex flex-col items-center justify-center w-16">
          <div className="text-3xl font-bold tabular-nums text-ink">
            {candidate.aiScore}
          </div>
          <div className="text-[9px] uppercase tracking-wider text-muted -mt-0.5">
            AI score
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-[10px] uppercase tracking-wider font-medium text-muted">
              {bandLabel(candidate.aiScoreBand)} - your hottest lead this morning
            </span>
            <span className="text-[10px] text-muted">{timeAgo(candidate.submissionDate)}</span>
          </div>
          <div className="text-base font-semibold text-ink truncate">{candidate.company}</div>
          {candidate.aiScoreReason ? (
            <div className="text-xs text-muted line-clamp-1 mt-0.5">
              {candidate.aiScoreReason}
            </div>
          ) : (
            <div className="text-xs text-muted mt-0.5">
              {[candidate.industry, candidate.contactName].filter(Boolean).join(' - ') ||
                'Tap to see the full audit'}
            </div>
          )}
        </div>
        <div className="shrink-0 text-muted group-hover:text-ink transition-colors">
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <path
              d="M9 6l6 6-6 6"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </div>
    </Link>
  );
}
