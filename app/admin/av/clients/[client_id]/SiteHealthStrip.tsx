/**
 * SiteHealthStrip  (#512, val 2026-06-08)
 *
 * Renders the latest website audit's 7-axis scores as a KPI strip on the
 * operator client page. Server-rendered (no useState/useEffect) — pulls the
 * snapshot in the parent server component and passes it in.
 *
 * Renders nothing when there's no snapshot (clean empty state — the strip
 * appears the moment val runs her first "Read & suggest" against this client).
 */
import type { AuditScores } from '@/lib/client/audit_snapshots';
import { AUDIT_AXES, AXIS_LABEL, WEAK_AXIS_THRESHOLD } from '@/lib/client/audit_snapshots';

interface Props {
  scores: AuditScores | null;
  lastAuditAt: Date | null;
  homepageUrl: string | null;
  industryHint: string | null;
  pagesReached: number | null;
  pagesFlagged: number | null;
}

function relTime(d: Date): string {
  const now = Date.now();
  const t = new Date(d).getTime();
  const diff = Math.max(0, now - t);
  const days = Math.floor(diff / 86_400_000);
  if (days === 0) {
    const hours = Math.floor(diff / 3_600_000);
    if (hours === 0) return 'just now';
    return `${hours}h ago`;
  }
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function colorFor(n: number | null): string {
  if (n === null) return 'text-white/35';
  if (n >= 8) return 'text-emerald-300';
  if (n >= WEAK_AXIS_THRESHOLD) return 'text-amber-300/85';
  return 'text-rose-300';
}

function bgFor(n: number | null): string {
  if (n === null) return 'bg-black/20 border-white/10';
  if (n >= 8) return 'bg-emerald-500/10 border-emerald-400/30';
  if (n >= WEAK_AXIS_THRESHOLD) return 'bg-amber-500/10 border-amber-400/30';
  return 'bg-rose-500/10 border-rose-400/30';
}

export default function SiteHealthStrip({
  scores,
  lastAuditAt,
  homepageUrl,
  industryHint,
  pagesReached,
  pagesFlagged
}: Props) {
  if (!scores || !lastAuditAt) return null;
  const overall = scores.overall_avg;
  const weakCount = AUDIT_AXES.filter((a) => {
    const v = scores[a];
    return typeof v === 'number' && v < WEAK_AXIS_THRESHOLD;
  }).length;

  return (
    <div id="site-health" className="rounded-xl border border-white/10 bg-black/15 p-4 mb-4">
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-3">
        <div className="flex items-baseline gap-2.5">
          <div className="text-[10px] uppercase tracking-[0.14em] text-[color-mix(in_srgb,var(--gold-bright)_75%,transparent)]">
            Site health
          </div>
          {overall !== null && (
            <div className={`text-[14px] font-medium ${colorFor(overall)}`}>
              {overall.toFixed(1)} / 10
            </div>
          )}
          {weakCount > 0 && (
            <div className="text-[11px] text-rose-300/85">
              · {weakCount} weak axis{weakCount === 1 ? '' : 'es'}
            </div>
          )}
        </div>
        <div className="text-[10.5px] text-white/45 flex items-center gap-2 flex-wrap">
          {homepageUrl && (
            <span title={homepageUrl} className="truncate max-w-[260px]">
              {homepageUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')}
            </span>
          )}
          {industryHint && <span className="text-white/55">· {industryHint}</span>}
          {pagesReached !== null && (
            <span>
              · {pagesReached} pages
              {pagesFlagged && pagesFlagged > 0 ? (
                <span className="text-amber-300/85"> ({pagesFlagged} flagged)</span>
              ) : null}
            </span>
          )}
          <span>· {relTime(lastAuditAt)}</span>
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-9 gap-2">
        {AUDIT_AXES.map((axis) => {
          const v = scores[axis];
          return (
            <div
              key={axis}
              className={`rounded-md border px-2.5 py-2 text-center ${bgFor(v)}`}
              title={`${AXIS_LABEL[axis]} — last audit`}
            >
              <div className={`text-[18px] font-medium leading-none ${colorFor(v)}`}>
                {v === null ? '—' : v}
                {v !== null && <span className="text-[10px] text-white/45 ml-0.5">/10</span>}
              </div>
              <div className="text-[9.5px] uppercase tracking-wider text-white/60 mt-1 leading-tight">
                {AXIS_LABEL[axis]}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-2.5 flex items-center justify-between gap-2 text-[10.5px] text-white/40">
        <span className="italic">
          Run a website scrape to refresh these scores.
        </span>
        <a
          href="#fill-intake"
          className="hover:text-[var(--gold-bright)] transition"
        >
          Re-audit ↓
        </a>
      </div>
    </div>
  );
}
