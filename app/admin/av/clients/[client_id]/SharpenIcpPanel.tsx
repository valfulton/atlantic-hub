'use client';

/**
 * SharpenIcpPanel  (#239)
 *
 * Operator-side panel on the client page: "Sharpen ICP from intake." Reads
 * the client's brief, runs an LLM, and shows suggestions for industries[],
 * geographies[], excludedIndustries[], and company size range. Val edits or
 * removes anything she doesn't like, then applies in one of two modes:
 *
 *   - "Fill blanks only" (default, safer): write only the fields the current
 *     ICP doesn't have values for. Val's curated values stay untouched.
 *   - "Replace": overwrite everything with the suggestions (fresh start).
 *
 * Provenance is tagged 'ai_intake' on each newly-written item, so the
 * IcpEditor's color chips distinguish AI-sharpened from operator-curated.
 *
 * Closes the loop:
 *   - Operator fills intake
 *   - Operator clicks "Sharpen ICP from intake"
 *   - ICP table is now populated
 *   - "Find new leads" with destination=this client auto-fills from ICP
 *   - Discovery brings back actual matches, not Saint Croix defaults
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface PreviewResponse {
  ok: true;
  industries: string[];
  geographies: string[];
  excludedIndustries: string[];
  companySizeMin: number | null;
  companySizeMax: number | null;
  reasoning: string;
  tokensUsed: number;
  model: string;
  currentSnapshot: {
    industries: string[];
    geographies: string[];
    excludedIndustries: string[];
    companySizeMin: number | null;
    companySizeMax: number | null;
  };
}

interface ApplyResponse {
  ok: true;
  merge: 'fill_blanks' | 'replace';
  writtenCounts: {
    industries: number;
    geographies: number;
    excludedIndustries: number;
    companySize: boolean;
  };
}

export default function SharpenIcpPanel({
  clientId,
  clientName
}: {
  clientId: number;
  clientName: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<'idle' | 'previewing' | 'applying'>('idle');
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [applied, setApplied] = useState<ApplyResponse | null>(null);

  // Editable working copy of the suggested ICP.
  const [editIndustries, setEditIndustries] = useState('');
  const [editGeographies, setEditGeographies] = useState('');
  const [editExcluded, setEditExcluded] = useState('');
  const [editMin, setEditMin] = useState<string>('');
  const [editMax, setEditMax] = useState<string>('');
  const [mergeMode, setMergeMode] = useState<'fill_blanks' | 'replace'>('fill_blanks');

  async function runPreview() {
    setBusy('previewing');
    setErr(null);
    setApplied(null);
    try {
      const res = await fetch(`/api/admin/av/clients/${clientId}/sharpen-icp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'preview' })
      });
      const raw = await res.text();
      let data: PreviewResponse | { error?: string; detail?: string } | null = null;
      try { data = JSON.parse(raw); } catch { throw new Error(`HTTP ${res.status} (non-JSON)`); }
      if (!res.ok || !data || !('ok' in data)) {
        const detail = data && 'detail' in data ? data.detail : null;
        throw new Error((data && 'error' in data && data.error) || detail || `HTTP ${res.status}`);
      }
      setPreview(data);
      setEditIndustries(data.industries.join(', '));
      setEditGeographies(data.geographies.join(', '));
      setEditExcluded(data.excludedIndustries.join(', '));
      setEditMin(data.companySizeMin == null ? '' : String(data.companySizeMin));
      setEditMax(data.companySizeMax == null ? '' : String(data.companySizeMax));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy('idle');
    }
  }

  function csvToArray(s: string): string[] {
    return s.split(',').map((x) => x.trim()).filter(Boolean);
  }

  async function runApply() {
    if (!preview) return;
    setBusy('applying');
    setErr(null);
    try {
      const res = await fetch(`/api/admin/av/clients/${clientId}/sharpen-icp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'apply',
          industries: csvToArray(editIndustries),
          geographies: csvToArray(editGeographies),
          excludedIndustries: csvToArray(editExcluded),
          companySizeMin: editMin.trim() ? Number(editMin) : null,
          companySizeMax: editMax.trim() ? Number(editMax) : null,
          mergeMode
        })
      });
      const raw = await res.text();
      let data: ApplyResponse | { error?: string; detail?: string } | null = null;
      try { data = JSON.parse(raw); } catch { throw new Error(`HTTP ${res.status} (non-JSON)`); }
      if (!res.ok || !data || !('ok' in data)) {
        const detail = data && 'detail' in data ? data.detail : null;
        throw new Error((data && 'error' in data && data.error) || detail || `HTTP ${res.status}`);
      }
      setApplied(data);
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy('idle');
    }
  }

  function discard() {
    setPreview(null);
    setApplied(null);
    setErr(null);
    setEditIndustries('');
    setEditGeographies('');
    setEditExcluded('');
    setEditMin('');
    setEditMax('');
  }

  const inputCls =
    'w-full rounded-md bg-black/30 border border-white/10 px-2.5 py-1.5 text-[12px] text-white/90 ' +
    'placeholder-white/30 focus:outline-none focus:border-amber-400/50';

  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="text-[11px] uppercase tracking-[0.12em] text-muted mb-1">
        Sharpen {clientName}&apos;s ICP from their intake
      </div>
      <div className="text-[12.5px] text-white/70 mb-3 leading-relaxed">
        Reads their brief (ideal client, audience insights, geo, excludes) and proposes a structured
        ICP — industries, locations, excluded categories, and company-size range — that the discovery
        engine uses directly. Eliminates the &ldquo;intake is rich but ICP is empty&rdquo; gap.
      </div>

      {!preview && !applied && (
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={runPreview}
            disabled={busy !== 'idle'}
            className={
              'rounded-md px-3 py-1.5 text-[11.5px] font-medium transition ' +
              (busy !== 'idle'
                ? 'bg-white/10 text-white/40 cursor-not-allowed'
                : 'bg-amber-400/90 text-black hover:bg-amber-300')
            }
          >
            {busy === 'previewing' ? 'Reading their brief…' : 'Sharpen from intake'}
          </button>
          <span className="text-[10.5px] text-white/40">
            One LLM call · ~5-10s · preview first, apply second.
          </span>
          {err && <span className="text-[10.5px] text-rose-300 ml-1">{err}</span>}
        </div>
      )}

      {preview && !applied && (
        <div className="space-y-3">
          {preview.reasoning && (
            <div className="rounded-md border border-white/10 bg-black/15 p-3 text-[12px] text-white/80 leading-relaxed italic">
              <span className="not-italic text-amber-300/85 text-[10px] uppercase tracking-wider mr-1.5">
                How I read it
              </span>
              {preview.reasoning}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <div className="text-[10px] uppercase tracking-[0.12em] text-white/55 mb-1">
                Target industries / keyword tags
              </div>
              <input
                className={inputCls}
                value={editIndustries}
                onChange={(e) => setEditIndustries(e.target.value)}
                placeholder="e.g. luxury estate, wellness spa, longevity clinic"
              />
              <div className="text-[10px] text-white/40 mt-0.5">
                Currently in their ICP: {preview.currentSnapshot.industries.length || 'none'}.
              </div>
            </div>

            <div className="sm:col-span-2">
              <div className="text-[10px] uppercase tracking-[0.12em] text-white/55 mb-1">
                Target geographies
              </div>
              <input
                className={inputCls}
                value={editGeographies}
                onChange={(e) => setEditGeographies(e.target.value)}
                placeholder="e.g. Los Angeles California, Southern California, United States"
              />
              <div className="text-[10px] text-white/40 mt-0.5">
                Currently: {preview.currentSnapshot.geographies.length || 'none'}.
              </div>
            </div>

            <div className="sm:col-span-2">
              <div className="text-[10px] uppercase tracking-[0.12em] text-white/55 mb-1">
                Excluded industries (never return)
              </div>
              <input
                className={inputCls}
                value={editExcluded}
                onChange={(e) => setEditExcluded(e.target.value)}
                placeholder="(rare — only when the brief explicitly excludes a category)"
              />
              <div className="text-[10px] text-white/40 mt-0.5">
                Currently: {preview.currentSnapshot.excludedIndustries.length || 'none'}.
              </div>
            </div>

            <div>
              <div className="text-[10px] uppercase tracking-[0.12em] text-white/55 mb-1">
                Company size (min)
              </div>
              <input
                className={inputCls}
                type="number"
                min="1"
                value={editMin}
                onChange={(e) => setEditMin(e.target.value)}
                placeholder="e.g. 1"
              />
            </div>

            <div>
              <div className="text-[10px] uppercase tracking-[0.12em] text-white/55 mb-1">
                Company size (max)
              </div>
              <input
                className={inputCls}
                type="number"
                min="1"
                value={editMax}
                onChange={(e) => setEditMax(e.target.value)}
                placeholder="e.g. 50"
              />
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap pt-2 border-t border-white/5">
            <span className="text-[10.5px] uppercase tracking-[0.12em] text-white/55">
              Merge mode
            </span>
            <label className="flex items-center gap-1.5 text-[11px] text-white/75 cursor-pointer">
              <input
                type="radio"
                name="merge"
                checked={mergeMode === 'fill_blanks'}
                onChange={() => setMergeMode('fill_blanks')}
                className="h-3 w-3"
              />
              Fill blanks only (safer)
            </label>
            <label className="flex items-center gap-1.5 text-[11px] text-white/75 cursor-pointer">
              <input
                type="radio"
                name="merge"
                checked={mergeMode === 'replace'}
                onChange={() => setMergeMode('replace')}
                className="h-3 w-3"
              />
              Replace existing
            </label>
          </div>

          <div className="flex items-center gap-2 flex-wrap pt-2">
            <button
              onClick={runApply}
              disabled={busy !== 'idle'}
              className={
                'rounded-md px-3 py-1 text-[11.5px] font-medium transition ' +
                (busy !== 'idle'
                  ? 'bg-white/10 text-white/40 cursor-not-allowed'
                  : 'bg-amber-400/90 text-black hover:bg-amber-300')
              }
            >
              {busy === 'applying' ? 'Saving…' : 'Apply to their ICP'}
            </button>
            <button
              onClick={discard}
              disabled={busy !== 'idle'}
              className="text-[10.5px] uppercase tracking-wider text-white/50 hover:text-white/85 px-2"
            >
              Discard
            </button>
            <span className="text-[10.5px] text-white/40">
              AI-applied items render with a distinct chip on the IcpEditor.
            </span>
          </div>

          {err && <div className="text-[10.5px] text-rose-300">{err}</div>}
        </div>
      )}

      {applied && (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 space-y-2">
          <div className="text-[12px] text-emerald-200 font-medium">
            ✓ Applied to {clientName}&apos;s ICP ({applied.merge === 'replace' ? 'replaced' : 'filled blanks'}).
          </div>
          <div className="text-[11px] text-white/65">
            Wrote {applied.writtenCounts.industries} industries,{' '}
            {applied.writtenCounts.geographies} geographies,{' '}
            {applied.writtenCounts.excludedIndustries} excludes
            {applied.writtenCounts.companySize ? ' + size range' : ''}.
          </div>
          <div className="text-[10.5px] text-white/55 italic">
            Try &ldquo;Find new leads&rdquo; → destination {clientName} now — auto-fill will pull from the ICP.
          </div>
          <button
            onClick={discard}
            className="text-[10.5px] uppercase tracking-wider text-white/50 hover:text-white/85"
          >
            Run again
          </button>
        </div>
      )}
    </div>
  );
}
