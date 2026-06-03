'use client';

/**
 * DailySpendChip  (#367, val 2026-06-02)
 *
 * Tenant-wide LLM spend over the last 24 hours, surfaced in the operator
 * sidebar so val sees the burn rate without leaving the page she's on.
 * Refreshes on mount + every 5 minutes (cheap aggregate query, no LLM calls).
 *
 * Auto-hides under Presentation Mode because CostBadge does — same as every
 * other cost surface in the hub. Cache hit count is shown separately and
 * also goes silent under Presentation Mode.
 */
import { useEffect, useState } from 'react';
import { CostBadge } from './CostBadge';
import { isPresentationModeClient } from '@/lib/ui/presentation_mode';

interface SpendResponse {
  ok: boolean;
  liveMicrocents: number;
  liveCallCount: number;
  cacheHitCount: number;
}

export default function DailySpendChip() {
  const [data, setData] = useState<SpendResponse | null>(null);
  const [presentation, setPresentation] = useState(false);

  useEffect(() => {
    setPresentation(isPresentationModeClient());
  }, []);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const r = await fetch('/api/admin/llm/spend-today', { cache: 'no-store' });
        if (!r.ok) return;
        const j = (await r.json()) as SpendResponse;
        if (alive) setData(j);
      } catch {
        /* non-fatal — chip just stays empty */
      }
    }
    load();
    const id = setInterval(load, 5 * 60 * 1000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  if (presentation) return null;
  if (!data) return null;
  // Don't render an empty chip on a fresh tenant with zero spend yet.
  if (data.liveMicrocents === 0 && data.cacheHitCount === 0) return null;

  return (
    <div className="flex items-center gap-1.5 text-[10.5px] text-muted">
      <span className="uppercase tracking-[0.12em]">Today</span>
      <CostBadge microcents={data.liveMicrocents} />
      {data.cacheHitCount > 0 && (
        <span className="text-emerald-300/85">· {data.cacheHitCount} cache</span>
      )}
    </div>
  );
}
