'use client';

/**
 * LineBackfillButton  (#46 spine Inc 6)
 *
 * Small one-off button on the narrative cockpit header that walks every
 * un-threaded lead and links it to the best-fit narrative line by keyword
 * overlap. Catches legacy leads (everything created before Inc 2 wired
 * auto-thread into discovery). The lib helper caps the batch and skips
 * low-confidence fits, so the worst case is a fast no-op.
 *
 * Standalone client component so it doesn't bloat the big NarrativeCockpit
 * file. After a successful run it nudges the user to refresh — the outcomes
 * strips and link counts are server-rendered, so a fresh load is the
 * cheapest way to see what just landed.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface BackfillResponse {
  ok: boolean;
  scanned?: number;
  linked?: number;
  skipped?: number;
  cappedAt?: number;
  error?: string;
}

export function LineBackfillButton() {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<BackfillResponse | null>(null);

  async function run() {
    setRunning(true);
    setResult(null);
    try {
      const r = await fetch('/api/admin/av/narrative/backfill-leads', { method: 'POST' });
      const j: BackfillResponse = await r.json().catch(() => ({ ok: false }));
      if (!r.ok) {
        setResult({ ok: false, error: j.error ?? `HTTP ${r.status}` });
      } else {
        setResult(j);
        if ((j.linked ?? 0) > 0) router.refresh();
      }
    } catch (e) {
      setResult({ ok: false, error: (e as Error).message });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="inline-flex items-center gap-3">
      <button
        type="button"
        onClick={run}
        disabled={running}
        title="Walk un-threaded leads, link each to the best-fit narrative line (capped batch). Skips low-confidence fits."
        className={
          'text-[11px] px-2.5 py-1 rounded-md border transition ' +
          (running
            ? 'border-white/10 text-white/30 cursor-not-allowed'
            : 'border-amber-400/30 text-amber-200 hover:border-amber-400/60 bg-amber-400/5')
        }
      >
        {running ? '✨ threading…' : '✨ Backfill un-threaded leads'}
      </button>
      {result && result.ok && (
        <span className="text-[11px]" style={{ color: '#86efac' }}>
          {result.linked === 0 && result.scanned === 0
            ? 'Nothing to backfill — every lead already links to a line.'
            : `Linked ${result.linked} of ${result.scanned} un-threaded leads${result.skipped ? ` · ${result.skipped} had no clear fit` : ''}.`}
        </span>
      )}
      {result && !result.ok && (
        <span className="text-[11px]" style={{ color: '#fca5a5' }}>{result.error ?? 'Backfill failed.'}</span>
      )}
    </div>
  );
}
