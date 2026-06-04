/**
 * components/LeadOfTheDay.tsx
 *
 * "Your hottest lead this morning" card. Server component.
 *
 * Renders above the leads table on /admin/av. The card is the primary
 * brand-color cue on the dashboard, so we want it visible almost every
 * day -- not just the ~3% of mornings where a hot lead landed in the
 * last 24h. Three-tier fallback:
 *
 *   Tier 1  "today"          new hot/warm lead from the last 24h
 *   Tier 2  "this week"      new hot/warm lead from the last 7 days
 *   Tier 3  "top overall"    any unactioned lead with ai_score >= 60
 *
 * Only renders null if the dashboard has literally nothing scored above
 * 60 yet -- which is genuine empty-state territory for a brand-new pipeline.
 *
 * Why widen: the original 24h-only filter caused the dashboard to go
 * silent ~22 hours out of every 24, defeating the visual-cue purpose.
 * The copy variant adapts so the card never lies about how fresh the
 * lead is.
 */

import Link from 'next/link';
import { serverFetch } from '@/lib/server-fetch';
import type { AvLead } from '@/app/admin/av/AvLeadsTable';

interface LeadWithReason extends AvLead {
  aiScoreReason?: string | null;
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const ONE_WEEK_MS = 7 * ONE_DAY_MS;
const TOP_OVERALL_MIN_SCORE = 60;

type CopyVariant = 'today' | 'this_week' | 'top_overall';

function bandStyles(band: string | null) {
  if (band === 'hot') return 'from-rose-500/20 to-rose-500/5 border-rose-500/40';
  if (band === 'warm') return 'from-[#EBCB6B]/16 to-[#EBCB6B]/5 border-[#EBCB6B]/40';
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
  if (hrs < 48) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

function variantCopy(variant: CopyVariant): string {
  switch (variant) {
    case 'today':       return 'your hottest lead this morning';
    case 'this_week':   return 'top of your pipeline this week';
    case 'top_overall': return 'best lead in your queue right now';
  }
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

  // Tier 1: hot/warm new lead from the last 24 hours.
  const dayCutoff = Date.now() - ONE_DAY_MS;
  let candidate = leads.find((l) => {
    if (l.aiScore === null) return false;
    if (l.aiScoreBand !== 'hot' && l.aiScoreBand !== 'warm') return false;
    const ts = new Date(l.submissionDate).getTime();
    return !Number.isNaN(ts) && ts >= dayCutoff;
  });
  let variant: CopyVariant = 'today';

  // Tier 2: hot/warm new lead from the last 7 days.
  if (!candidate) {
    const weekCutoff = Date.now() - ONE_WEEK_MS;
    candidate = leads.find((l) => {
      if (l.aiScore === null) return false;
      if (l.aiScoreBand !== 'hot' && l.aiScoreBand !== 'warm') return false;
      const ts = new Date(l.submissionDate).getTime();
      return !Number.isNaN(ts) && ts >= weekCutoff;
    });
    if (candidate) variant = 'this_week';
  }

  // Tier 3: any unactioned lead with score >= 60 -- the best thing in the queue right now.
  if (!candidate) {
    candidate = leads.find((l) => l.aiScore !== null && l.aiScore >= TOP_OVERALL_MIN_SCORE);
    if (candidate) variant = 'top_overall';
  }

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
            {candidate.aiCombinedScore ?? candidate.aiScore}
          </div>
          <div className="text-[9px] uppercase tracking-wider text-muted -mt-0.5">
            AI score
          </div>
          {candidate.aiEngagementScore !== undefined && candidate.aiEngagementScore !== 0 && (
            <div
              className={
                candidate.aiEngagementScore > 0
                  ? 'text-[10px] tabular-nums text-emerald-300'
                  : 'text-[10px] tabular-nums text-rose-300'
              }
              title={`Engagement ${candidate.aiEngagementScore > 0 ? '+' : ''}${candidate.aiEngagementScore}`}
            >
              {candidate.aiEngagementScore > 0 ? '+' : ''}{candidate.aiEngagementScore}
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-[10px] uppercase tracking-wider font-medium text-muted">
              {bandLabel(candidate.aiScoreBand)} - {variantCopy(variant)}
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
