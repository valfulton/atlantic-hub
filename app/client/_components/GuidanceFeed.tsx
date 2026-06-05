/**
 * GuidanceFeed -- the calm, ranked "what matters most right now, and why" feed
 * that is the FIRST thing a client sees on their dashboard. Server component
 * (renders the final state instantly -- no welcome animation, per
 * docs/COSMETIC_BASELINE.md "animate change, not state").
 *
 * It surfaces the deterministic guidance composed by lib/client/guidance.ts.
 * Each item shows a headline, why-it-matters, why-now/timing (with decay where a
 * real deadline exists), and an honest value frame. NO vanity metrics, NO
 * urgency theatrics, NO per-unit cost or pricing (CLIENT_FACING_GUARDRAILS.md).
 *
 * Accessibility: semantic list, every status communicated by TEXT label as well
 * as color (color is never the only indicator), AA-minded contrast.
 */
import type { ClientGuidance, GuidanceItem, GuidanceKind } from '@/lib/client/guidance';

interface KindMeta {
  label: string;
  /** Tailwind classes for the small chip; text label always present. */
  chip: string;
  dot: string;
}

const KIND_META: Record<GuidanceKind, KindMeta> = {
  deadline_window: {
    label: 'Time-sensitive',
    chip: 'text-[var(--gold-bright)] border-[color-mix(in_srgb,var(--gold-bright)_40%,transparent)] bg-[color-mix(in_srgb,var(--gold-bright)_10%,transparent)]',
    dot: 'bg-[var(--gold-bright)]'
  },
  momentum: {
    label: 'Momentum',
    chip: 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10',
    dot: 'bg-emerald-400'
  },
  authority: {
    label: 'Your strength',
    chip: 'text-brand border-border bg-surface',
    dot: 'bg-brand'
  },
  focus: {
    label: 'Focus',
    chip: 'text-blue-300 border-blue-500/40 bg-blue-500/10',
    dot: 'bg-blue-400'
  },
  format: {
    label: 'What is working',
    chip: 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10',
    dot: 'bg-emerald-400'
  }
};

function MomentumBadge({ guidance }: { guidance: ClientGuidance }) {
  const m = guidance.momentum;
  if (!m.summary || m.direction === 'unknown') return null;
  const tone =
    m.direction === 'rising'
      ? 'text-emerald-300'
      : m.direction === 'cooling'
        ? 'text-blue-300'
        : 'text-muted';
  const word =
    m.direction === 'rising' ? 'Rising' : m.direction === 'cooling' ? 'Re-engage' : 'Steady';
  return (
    <div className="mt-1 flex items-center gap-2 text-xs">
      <span className={`font-medium ${tone}`}>{word}</span>
      <span className="text-muted">{m.summary}</span>
    </div>
  );
}

function GuidanceCard({ item }: { item: GuidanceItem }) {
  const meta = KIND_META[item.kind] ?? KIND_META.focus;
  return (
    <li className="rounded-2xl border border-border bg-surface p-5">
      <div className="flex items-start gap-3">
        <div
          aria-hidden="true"
          className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs font-semibold text-ink"
        >
          {item.rank}
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] ${meta.chip}`}
            >
              <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
              {meta.label}
            </span>
            {typeof item.decayDays === 'number' && (
              <span className="text-[10px] uppercase tracking-[0.12em] text-[var(--gold-bright)]">
                {item.decayDays <= 0
                  ? 'Closes today'
                  : item.decayDays === 1
                    ? 'Closes tomorrow'
                    : `${item.decayDays} days left`}
              </span>
            )}
          </div>

          <h3 className="text-base font-semibold leading-snug text-ink">{item.headline}</h3>

          <p className="mt-2 text-sm leading-relaxed text-muted">{item.whyItMatters}</p>

          <div className="mt-3 grid gap-1.5">
            <div className="flex gap-2 text-sm">
              <span className="shrink-0 text-[11px] font-medium uppercase tracking-[0.1em] text-muted/80">
                Why now
              </span>
              <span className="text-ink/90">{item.whyNow}</span>
            </div>
            <div className="flex gap-2 text-sm">
              <span className="shrink-0 text-[11px] font-medium uppercase tracking-[0.1em] text-muted/80">
                Worth
              </span>
              <span className="text-ink/90">{item.valueFrame}</span>
            </div>
          </div>
        </div>
      </div>
    </li>
  );
}

export default function GuidanceFeed({
  guidance,
  firstName
}: {
  guidance: ClientGuidance;
  firstName?: string;
}) {
  const hasItems = guidance.items.length > 0;

  return (
    <section aria-labelledby="guidance-h" className="mb-8 sm:mb-10">
      <div className="mb-3">
        <div className="text-[10px] uppercase tracking-[0.16em] text-muted">
          What matters most right now
        </div>
        <h2 id="guidance-h" className="mt-1 text-xl font-semibold text-ink">
          {firstName ? `Here's where to focus, ${firstName}.` : "Here's where to focus."}
        </h2>
        <MomentumBadge guidance={guidance} />
      </div>

      {hasItems ? (
        <ol className="grid gap-3">
          {guidance.items.map((item) => (
            <GuidanceCard key={item.key} item={item} />
          ))}
        </ol>
      ) : (
        <div className="rounded-2xl border border-border bg-surface p-6 text-sm text-muted">
          Your guidance will appear here as we learn more about your business. As your audit,
          content, and engagement build up, this space fills with the highest-leverage move to
          make next -- and why it matters.
        </div>
      )}
    </section>
  );
}
