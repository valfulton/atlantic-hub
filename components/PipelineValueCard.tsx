'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';

/**
 * Pipeline value rollup card. Sits at the top of /admin/av above the
 * MetricCard grid. Pulls /api/admin/av/pipeline-value once on mount and
 * refreshes every 30 seconds while the tab is visible.
 *
 * Shows:
 *   - Big animated $ value of the live pipeline
 *   - Hot $ subset + warm $ subset chips
 *   - Top opportunity callout (highest-value single lead)
 *   - Nurture pool size (with $ if the operator wants to chase parked leads)
 */

interface PipelineValue {
  liveValueCents: number;
  liveLeadCount: number;
  hotValueCents: number;
  hotLeadCount: number;
  warmValueCents: number;
  warmLeadCount: number;
  nurtureValueCents: number;
  nurtureLeadCount: number;
  topLead: {
    auditId: string;
    company: string;
    estimatedValueCents: number;
    score: number;
  } | null;
}

function usd(cents: number): string {
  const dollars = Math.round(cents / 100);
  return dollars.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

export function PipelineValueCard() {
  const [data, setData] = useState<PipelineValue | null>(null);
  const [displayValue, setDisplayValue] = useState(0);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch('/api/admin/av/pipeline-value', { cache: 'no-store' });
        if (!res.ok) {
          if (!cancelled) setErr(`HTTP ${res.status}`);
          return;
        }
        const json = await res.json();
        if (!cancelled) {
          setData(json);
          setErr(null);
        }
      } catch (e) {
        if (!cancelled) setErr(`Network: ${(e as Error).message}`);
      }
    }
    void load();
    // Auto-refresh PAUSED to cut Netlify usage (until the HostGator move, #73).
    // Loads once on mount; reload the page to refresh the pipeline total.
    return () => { cancelled = true; };
  }, []);

  // Animate the dollar total when it changes.
  useEffect(() => {
    if (!data) return;
    const target = data.liveValueCents;
    if (displayValue === target) return;
    const start = displayValue;
    const startTs = performance.now();
    const dur = 1100;
    let raf: number | null = null;
    function tick(now: number) {
      const t = Math.min(1, (now - startTs) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplayValue(Math.round(start + (target - start) * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => { if (raf !== null) cancelAnimationFrame(raf); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.liveValueCents]);

  if (err && !data) {
    return null; // do not render the card if we cannot load (silence > broken UI)
  }
  if (!data) {
    return (
      <div className="rounded-xl border border-border bg-gradient-to-br from-[#EBCB6B]/8 to-transparent p-5 mb-6">
        <div className="text-[10px] uppercase tracking-[0.14em] text-[#EBCB6B] font-medium mb-2">
          Live pipeline value
        </div>
        <div className="text-3xl font-bold tabular-nums text-muted">$--</div>
      </div>
    );
  }

  return (
    <section
      aria-label="Live pipeline value"
      className="rounded-xl border border-[#EBCB6B]/30 bg-gradient-to-br from-[#EBCB6B]/12 via-rose-500/5 to-transparent p-5 mb-6"
    >
      <div className="flex items-baseline justify-between gap-4 flex-wrap mb-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.14em] text-[#EBCB6B] font-medium mb-1">
            Live pipeline value
          </div>
          <div className="text-3xl md:text-4xl font-bold tabular-nums text-ink">
            {usd(displayValue)}
          </div>
          <div className="text-xs text-muted mt-0.5">
            {data.liveLeadCount} lead{data.liveLeadCount === 1 ? '' : 's'} active
            <span className="opacity-50"> | </span>
            Sprint floor x combined score
          </div>
        </div>
        <div className="flex items-baseline gap-3 flex-wrap text-sm">
          {data.hotLeadCount > 0 && (
            <span className="text-rose-300 tabular-nums">
              <span className="text-[10px] uppercase tracking-wider opacity-80">hot</span>{' '}
              {usd(data.hotValueCents)}
              <span className="text-xs opacity-70 ml-1">({data.hotLeadCount})</span>
            </span>
          )}
          {data.warmLeadCount > 0 && (
            <span className="text-[#EBCB6B] tabular-nums">
              <span className="text-[10px] uppercase tracking-wider opacity-80">warm</span>{' '}
              {usd(data.warmValueCents)}
              <span className="text-xs opacity-70 ml-1">({data.warmLeadCount})</span>
            </span>
          )}
          {data.nurtureLeadCount > 0 && (
            <span className="text-sky-300 tabular-nums">
              <span className="text-[10px] uppercase tracking-wider opacity-80">nurture</span>{' '}
              {usd(data.nurtureValueCents)}
              <span className="text-xs opacity-70 ml-1">({data.nurtureLeadCount})</span>
            </span>
          )}
        </div>
      </div>

      {data.topLead && (
        <Link
          href={`/admin/av/${data.topLead.auditId}`}
          className="block bg-surface border border-border rounded-md px-3 py-2 hover:border-brand transition-colors"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs text-muted">
              <span className="uppercase tracking-wider text-[10px]">Top opportunity</span>
            </div>
            <div className="text-xs text-ink truncate">
              <span className="font-semibold">{data.topLead.company}</span>
              <span className="text-muted ml-2 tabular-nums">{usd(data.topLead.estimatedValueCents)}</span>
              <span className="text-muted ml-2 tabular-nums">score {data.topLead.score}</span>
            </div>
          </div>
        </Link>
      )}
    </section>
  );
}
