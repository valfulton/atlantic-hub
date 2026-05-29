'use client';

/**
 * FillIntakeFromWebPanel  (#235)
 *
 * Operator panel on the client page. Paste a public URL (usually their own
 * website's home or about page); we fetch it, run an LLM that drafts as many
 * of the 51 canonical intake fields as the page supports, and show val the
 * suggestions before they hit the DB. She picks which fields to keep, then
 * clicks Apply.
 *
 * Two-step UX:
 *   1. Preview  -> POST mode='preview'. Costs one LLM call.
 *   2. Apply    -> POST mode='apply' with the suggestions object + chosen
 *                  keys. No LLM call; pure merge.
 *
 * Safety:
 *   - "Apply blanks only" is the default: keys with stored values are
 *     untouched.
 *   - Operator can edit any suggested value in-line before applying.
 *   - The brief versioner snapshots on save, so this is reversible from the
 *     brief versions tab.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface PreviewResponse {
  ok: true;
  suggestions: Record<string, string>;
  summary: string;
  fetchedUrl: string;
  htmlBytes: number;
  textChars: number;
  tokensUsed: number;
  model: string;
  blankKeys: string[];
  overwriteKeys: string[];
}

interface ApplyResponse {
  ok: true;
  writtenKeys: string[];
  skippedNonBlank: string[];
  note?: string;
}

export default function FillIntakeFromWebPanel({
  clientId,
  clientName,
  defaultUrl
}: {
  clientId: number;
  clientName: string;
  /** Prefill the URL field with the client's saved website_url. */
  defaultUrl?: string | null;
}) {
  const router = useRouter();
  const [url, setUrl] = useState(defaultUrl || '');
  const [busy, setBusy] = useState<'idle' | 'previewing' | 'applying'>('idle');
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  // Per-field edited values + checked state. Initialized from preview; the
  // operator can override any value or uncheck any key before applying.
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [blanksOnly, setBlanksOnly] = useState(true);
  const [applied, setApplied] = useState<ApplyResponse | null>(null);

  async function runPreview() {
    if (!url.trim()) {
      setErr('Paste a URL first.');
      return;
    }
    setBusy('previewing');
    setErr(null);
    setApplied(null);
    try {
      const res = await fetch(`/api/admin/av/clients/${clientId}/fill-intake-from-web`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'preview', url: url.trim() })
      });
      const raw = await res.text();
      let data: PreviewResponse | { error?: string; detail?: string } | null = null;
      try { data = JSON.parse(raw); } catch { throw new Error(`HTTP ${res.status} (non-JSON)`); }
      if (!res.ok || !data || !('ok' in data)) {
        const detail = data && 'detail' in data ? data.detail : null;
        throw new Error((data && 'error' in data && data.error) || detail || `HTTP ${res.status}`);
      }
      setPreview(data);
      // Seed editable values from the suggestions; default-pick the BLANK keys
      // only (overwrites are unchecked by default so val opts in deliberately).
      const seedEdits: Record<string, string> = {};
      const seedPicks: Record<string, boolean> = {};
      const blankSet = new Set(data.blankKeys);
      for (const [k, v] of Object.entries(data.suggestions)) {
        seedEdits[k] = v;
        seedPicks[k] = blankSet.has(k); // blanks pre-checked, overwrites unchecked
      }
      setEdits(seedEdits);
      setPicked(seedPicks);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy('idle');
    }
  }

  async function runApply() {
    if (!preview) return;
    const applyKeys = Object.keys(picked).filter((k) => picked[k] && (edits[k] || '').trim());
    if (applyKeys.length === 0) {
      setErr('Pick at least one field to apply.');
      return;
    }
    setBusy('applying');
    setErr(null);
    try {
      const res = await fetch(`/api/admin/av/clients/${clientId}/fill-intake-from-web`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'apply',
          suggestions: edits,
          applyKeys,
          blanksOnly
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
    setEdits({});
    setPicked({});
    setApplied(null);
    setErr(null);
  }

  const inputCls =
    'w-full rounded-md bg-black/30 border border-white/10 px-2.5 py-1.5 text-[12px] text-white/90 ' +
    'placeholder-white/30 focus:outline-none focus:border-amber-400/50';

  const previewKeyCount = preview ? Object.keys(preview.suggestions).length : 0;
  const pickedCount = Object.values(picked).filter(Boolean).length;

  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="text-[11px] uppercase tracking-[0.12em] text-muted mb-1">
        Fill {clientName}&apos;s intake from the web
      </div>
      <div className="text-[12.5px] text-white/70 mb-3 leading-relaxed">
        Paste a public URL — usually their home or about page. We read it, draft as many intake
        fields as the page actually supports, and show you the suggestions before anything is
        saved. Blank fields are picked by default; overwrite is opt-in.
      </div>

      {/* URL + preview button */}
      <div className="rounded-md border border-amber-400/20 bg-amber-400/[0.04] p-2.5 mb-3 space-y-1.5">
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 items-stretch">
          <input
            className={inputCls}
            placeholder="https://example.com/about"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={busy !== 'idle'}
          />
          <button
            onClick={runPreview}
            disabled={busy !== 'idle' || !url.trim()}
            className={
              'rounded-md px-3 py-1 text-[11.5px] font-medium transition ' +
              (busy !== 'idle' || !url.trim()
                ? 'bg-white/10 text-white/40 cursor-not-allowed'
                : 'bg-amber-400/90 text-black hover:bg-amber-300')
            }
          >
            {busy === 'previewing' ? 'Reading…' : preview ? 'Re-read' : 'Read & suggest'}
          </button>
        </div>
        {err && <div className="text-[10.5px] text-rose-300">{err}</div>}
      </div>

      {/* Preview state */}
      {preview && !applied && (
        <div className="space-y-3">
          <div className="rounded-md border border-white/10 bg-black/15 p-3">
            <div className="text-[10px] uppercase tracking-[0.12em] text-amber-300/75 mb-1">
              What this page is about
            </div>
            <div className="text-[12px] text-white/85 leading-relaxed">
              {preview.summary || '(no summary available)'}
            </div>
            <div className="text-[10.5px] text-white/40 mt-1.5">
              {preview.fetchedUrl} · {Math.round(preview.htmlBytes / 1024)}KB read ·{' '}
              {preview.textChars.toLocaleString()} chars · {preview.tokensUsed.toLocaleString()} tokens
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="text-[12px] text-white/75">
              Suggested values for <span className="text-white">{previewKeyCount}</span> field
              {previewKeyCount === 1 ? '' : 's'} — <span className="text-emerald-300">{preview.blankKeys.length}</span> blank,{' '}
              <span className="text-rose-300/85">{preview.overwriteKeys.length}</span> would overwrite.
            </div>
            <label className="flex items-center gap-1.5 text-[11px] text-white/65 cursor-pointer">
              <input
                type="checkbox"
                checked={blanksOnly}
                onChange={(e) => setBlanksOnly(e.target.checked)}
                className="h-3 w-3"
              />
              Only write blank fields (safer)
            </label>
          </div>

          <ul className="space-y-1.5 max-h-[420px] overflow-y-auto pr-1">
            {Object.entries(preview.suggestions).map(([k, original]) => {
              const isBlank = preview.blankKeys.includes(k);
              return (
                <li
                  key={k}
                  className={
                    'rounded-md border px-2.5 py-1.5 ' +
                    (isBlank
                      ? 'border-emerald-500/25 bg-emerald-500/5'
                      : 'border-rose-500/25 bg-rose-500/5')
                  }
                >
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={!!picked[k]}
                        onChange={(e) => setPicked((p) => ({ ...p, [k]: e.target.checked }))}
                        className="h-3 w-3"
                      />
                      <code className="text-[11px] text-white/85 font-mono">{k}</code>
                    </label>
                    {isBlank ? (
                      <span className="text-[9.5px] uppercase tracking-wider font-medium text-emerald-300/85">
                        currently blank
                      </span>
                    ) : (
                      <span className="text-[9.5px] uppercase tracking-wider font-medium text-rose-300/85">
                        would overwrite
                      </span>
                    )}
                    {edits[k] !== original && (
                      <span className="text-[9.5px] uppercase tracking-wider font-medium text-amber-300/85">
                        edited
                      </span>
                    )}
                  </div>
                  <textarea
                    value={edits[k] ?? ''}
                    onChange={(e) => setEdits((p) => ({ ...p, [k]: e.target.value }))}
                    rows={Math.min(4, Math.max(1, Math.ceil((edits[k] || '').length / 70)))}
                    className="w-full bg-black/30 border border-white/10 rounded px-2 py-1 text-[12px] text-white/90 placeholder-white/30 focus:outline-none focus:border-amber-400/40"
                  />
                </li>
              );
            })}
          </ul>

          <div className="flex items-center gap-2 pt-2 border-t border-white/5 flex-wrap">
            <button
              onClick={runApply}
              disabled={busy !== 'idle' || pickedCount === 0}
              className={
                'rounded-md px-3 py-1 text-[11.5px] font-medium transition ' +
                (busy !== 'idle' || pickedCount === 0
                  ? 'bg-white/10 text-white/40 cursor-not-allowed'
                  : 'bg-amber-400/90 text-black hover:bg-amber-300')
              }
            >
              {busy === 'applying' ? 'Saving…' : `Apply ${pickedCount} field${pickedCount === 1 ? '' : 's'}`}
            </button>
            <button
              onClick={discard}
              disabled={busy !== 'idle'}
              className="text-[10.5px] uppercase tracking-wider text-white/50 hover:text-white/85 px-2"
            >
              Discard
            </button>
            <span className="text-[10.5px] text-white/40">
              Reversible from the brief versions tab.
            </span>
          </div>
        </div>
      )}

      {/* Applied state */}
      {applied && (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 space-y-2">
          <div className="text-[12px] text-emerald-200 font-medium">
            ✓ Saved {applied.writtenKeys.length} field{applied.writtenKeys.length === 1 ? '' : 's'} to {clientName}&apos;s intake.
          </div>
          {applied.writtenKeys.length > 0 && (
            <div className="text-[11px] text-white/65 leading-relaxed">
              Updated: {applied.writtenKeys.map((k) => <code key={k} className="bg-black/30 px-1 rounded mr-1">{k}</code>)}
            </div>
          )}
          {applied.skippedNonBlank.length > 0 && (
            <div className="text-[11px] text-amber-300/80 leading-relaxed">
              Skipped {applied.skippedNonBlank.length} that already had values (uncheck &ldquo;blanks only&rdquo; above to overwrite).
            </div>
          )}
          {applied.note && (
            <div className="text-[11px] text-white/55 italic">{applied.note}</div>
          )}
          <button
            onClick={discard}
            className="text-[10.5px] uppercase tracking-wider text-white/50 hover:text-white/85"
          >
            Read another page
          </button>
        </div>
      )}
    </div>
  );
}
