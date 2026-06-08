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
  /** Current stored value for each overwrite key (truncated to ~800 chars).
   *  Surfaced inline so val can compare current vs suggested before applying. */
  existing: Record<string, string>;
  /** (val 2026-06-07) Multi-page run: every URL actually fetched + blended. */
  pagesFetched?: string[];
  /** Discovered URLs that fetch-failed or were too thin to include. */
  pagesSkipped?: Array<{ url: string; reason: string }>;
  /** Per-page health (status, bytes, ok/thin/redirected/broken). */
  pageHealth?: Array<{
    url: string;
    finalUrl: string;
    status: number;
    bytes: number;
    textChars: number;
    health: 'ok' | 'thin' | 'redirected' | 'broken';
    note: string | null;
  }>;
  /** Plain-English website readout (weaknesses + opportunities). */
  websiteNotes?: string;
  /** How subpages were picked. 'llm' = adaptive, 'regex' = fallback, 'none' = no subpages. */
  discoveryMode?: 'llm' | 'regex' | 'none';
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
      // (#518, val 2026-06-08) The preview path inserts a new website_audit_
      // snapshot via lib/client/intake_web_filler.ts line ~781. Without a
      // router.refresh(), the SiteHealthStrip on the parent server component
      // stays frozen at the OLD snapshot's timestamp ("5h ago" even though
      // val just ran a fresh audit). Refresh AFTER setting preview state so
      // the panel keeps its preview UI while the surrounding page re-renders
      // with the new snapshot.
      router.refresh();
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
    // (#518, val 2026-06-08) If val has checked ANY overwrite row, treat that
    // as her explicit "yes overwrite" — sending blanksOnly:true here would
    // silently drop those keys server-side (return 200 OK with skippedNonBlank,
    // looking to val like "save was rejected"). The opt-in IS the consent.
    const overwriteSet = new Set(preview.overwriteKeys);
    const picksContainOverwrite = applyKeys.some((k) => overwriteSet.has(k));
    const effectiveBlanksOnly = blanksOnly && !picksContainOverwrite;
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
          blanksOnly: effectiveBlanksOnly
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
    'placeholder-white/30 focus:outline-none focus:border-[color-mix(in_srgb,var(--gold-bright)_50%,transparent)]';

  const previewKeyCount = preview ? Object.keys(preview.suggestions).length : 0;
  const pickedCount = Object.values(picked).filter(Boolean).length;

  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="text-[11px] uppercase tracking-[0.12em] text-muted mb-1">
        Fill {clientName}&apos;s intake from the web
      </div>
      <div className="text-[12.5px] text-white/70 mb-3 leading-relaxed">
        Paste their homepage URL — we auto-discover same-origin pages (about, services, contact,
        team, products) and blend their text into one LLM read. One click captures the whole site
        instead of forcing you to paste each page. Blank intake fields are picked by default;
        overwrite is opt-in.
      </div>

      {/* URL + preview button */}
      <div className="rounded-md border border-[color-mix(in_srgb,var(--gold-bright)_20%,transparent)] bg-[var(--gold-bright)]/[0.03] p-2.5 mb-3 space-y-1.5">
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
                : 'border border-[color-mix(in_srgb,var(--gold-bright)_40%,transparent)] text-[var(--gold-bright)] hover:bg-[color-mix(in_srgb,var(--gold-bright)_10%,transparent)]')
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
          {/* (#509) Pages-read card — lifted out of the meta line so it's
              impossible to miss. Counts good/flagged pages, lists each page
              by path with a color-coded status tag, and shows a top banner
              when any page is broken/thin/redirected. */}
          {preview.pageHealth && preview.pageHealth.length > 0 && (() => {
            const flagged = preview.pageHealth.filter((p) => p.health !== 'ok');
            const okCount = preview.pageHealth.length - flagged.length;
            return (
              <div className="rounded-md border border-white/10 bg-black/15 p-3 space-y-2">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="text-[10px] uppercase tracking-[0.12em] text-[color-mix(in_srgb,var(--gold-bright)_75%,transparent)]">
                    Pages read · {preview.pageHealth.length} reached
                    {okCount === preview.pageHealth.length
                      ? <span className="text-emerald-300/85"> · all clean</span>
                      : <span className="text-amber-300/85"> · {flagged.length} flagged</span>}
                  </div>
                  <div className="text-[10px] text-white/40">
                    {preview.discoveryMode === 'llm' && 'discovery: LLM-picked'}
                    {preview.discoveryMode === 'regex' && 'discovery: regex fallback'}
                    {preview.discoveryMode === 'none' && 'discovery: homepage only'}
                  </div>
                </div>
                {flagged.length > 0 && (
                  <div className="rounded-md border border-amber-300/30 bg-amber-300/[0.06] px-2.5 py-1.5 text-[11px] text-amber-100/95 leading-snug">
                    <span className="font-medium">Heads up:</span> {flagged.length} page
                    {flagged.length === 1 ? '' : 's'} returned with issues — your audit will be
                    weaker for these. Worth mentioning on the call (they may not know).
                  </div>
                )}
                <ul className="space-y-0.5 text-[11.5px] font-mono leading-snug">
                  {preview.pageHealth.map((p, i) => {
                    const path = (() => { try { return new URL(p.url).pathname || '/'; } catch { return p.url; } })();
                    const color =
                      p.health === 'ok' ? 'text-emerald-300/90' :
                      p.health === 'thin' ? 'text-amber-300/90' :
                      p.health === 'redirected' ? 'text-sky-300/90' :
                      'text-rose-300/90';
                    const tag =
                      p.health === 'ok' ? '✓ clean read' :
                      p.health === 'thin' ? 'JS-only / thin body' :
                      p.health === 'redirected' ? `→ redirected` :
                      p.status === 404 ? '404 not found' : `broken (HTTP ${p.status})`;
                    return (
                      <li key={i} className="flex items-baseline gap-2">
                        <span className={`${color} w-[150px] truncate`} title={p.url}>{path}</span>
                        <span className={`${color}`}>{tag}</span>
                        {p.textChars > 0 && (
                          <span className="text-white/35">· {p.textChars.toLocaleString()} chars</span>
                        )}
                        {p.note && (
                          <span className="text-white/45 truncate" title={p.note}>· {p.note}</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
                {preview.pagesSkipped && preview.pagesSkipped.length > 0 && (
                  <div className="text-[10.5px] text-white/45">
                    {preview.pagesSkipped.length} subpage{preview.pagesSkipped.length === 1 ? '' : 's'} skipped (too thin or unreachable).
                  </div>
                )}
              </div>
            );
          })()}

          <div className="rounded-md border border-white/10 bg-black/15 p-3">
            <div className="text-[10px] uppercase tracking-[0.12em] text-[color-mix(in_srgb,var(--gold-bright)_75%,transparent)] mb-1">
              What this page is about
            </div>
            <div className="text-[12px] text-white/85 leading-relaxed">
              {preview.summary || '(no summary available)'}
            </div>
            <div className="text-[10.5px] text-white/40 mt-1.5">
              {preview.fetchedUrl} · {Math.round(preview.htmlBytes / 1024)}KB read ·{' '}
              {preview.textChars.toLocaleString()} chars · {preview.tokensUsed.toLocaleString()} tokens
            </div>
            {preview.websiteNotes && preview.websiteNotes.trim().length > 0 && (
              <details className="mt-3 rounded-md border border-emerald-300/30 bg-emerald-300/[0.05] p-2.5" open>
                <summary className="cursor-pointer text-[10.5px] uppercase tracking-[0.12em] text-emerald-300/85 flex items-center gap-2">
                  <span>Website audit — sales ammo</span>
                  <span className="text-white/40 italic normal-case tracking-normal text-[10px]">(operator-only · markdown · industry-aware)</span>
                </summary>
                <div className="mt-2 text-[12px] text-white/90 leading-relaxed whitespace-pre-wrap font-[var(--font-sans,inherit)]">
                  {preview.websiteNotes}
                </div>
              </details>
            )}
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
              const currentValue = !isBlank ? preview.existing?.[k] : null;
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
                      <span className="text-[9.5px] uppercase tracking-wider font-medium text-[color-mix(in_srgb,var(--gold-bright)_85%,transparent)]">
                        edited
                      </span>
                    )}
                  </div>
                  {/* Show the existing value for overwrite keys so val can see what's
                      about to be replaced. Strikethrough to read as "currently this
                      → becomes the textarea below". High-contrast rose tint over the
                      card so it can't be missed. */}
                  {!isBlank && (
                    <div className="mb-2 rounded-md border border-rose-400/30 bg-rose-500/[0.12] px-2.5 py-2">
                      <div className="flex items-center justify-between gap-2 flex-wrap text-[9.5px] uppercase tracking-[0.14em] text-rose-200/80 mb-1 font-medium">
                        <div className="flex items-center gap-1.5">
                          <span>Currently</span>
                          <span className="text-rose-200/50">→</span>
                          <span className="text-[color-mix(in_srgb,var(--gold-bright)_85%,transparent)]">replaced with the value below</span>
                        </div>
                        {/* (#515, val 2026-06-08) One-click merge — appends the
                            current value into the new-value textarea so val can
                            keep both phrases and edit the combined result before
                            saving. Solves the "OPHORA Water has 4 patents on
                            oxygenating water" + "We help health-conscious consumers
                            achieve optimal hydration" dilemma where both phrases
                            are valuable for the ICP. */}
                        {currentValue && (
                          <button
                            type="button"
                            onClick={() => setEdits((p) => {
                              const cur = (currentValue || '').trim();
                              const incoming = (p[k] ?? '').trim();
                              if (!cur) return p;
                              const merged = incoming
                                ? `${cur}\n\n${incoming}`
                                : cur;
                              return { ...p, [k]: merged };
                            })}
                            className="rounded-md border border-emerald-400/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] tracking-wider text-emerald-200/95 hover:bg-emerald-500/20 transition normal-case"
                            title="Prepends the current value above the new one in the editable box below — combine, edit, then save."
                          >
                            ← Keep current + add this
                          </button>
                        )}
                      </div>
                      {currentValue ? (
                        <div className="text-[11.5px] text-rose-100/85 leading-snug whitespace-pre-wrap break-words line-through decoration-rose-300/60">
                          {currentValue}
                        </div>
                      ) : (
                        <div className="text-[11px] text-rose-200/55 italic">
                          (existing value not available — re-read to refresh)
                        </div>
                      )}
                    </div>
                  )}
                  {/* (#515) Hint that the textarea is editable — val didn't realize
                      she could type into it directly to merge / rephrase. */}
                  <div className="text-[10px] text-white/40 italic mb-1 leading-tight">
                    Type to edit before saving. Combine, rephrase, or move text to a different field — operator wins, always.
                  </div>
                  <textarea
                    value={edits[k] ?? ''}
                    onChange={(e) => setEdits((p) => ({ ...p, [k]: e.target.value }))}
                    rows={Math.min(6, Math.max(2, Math.ceil((edits[k] || '').length / 70)))}
                    className="w-full bg-black/30 border border-white/10 rounded px-2 py-1 text-[12px] text-white/90 placeholder-white/30 focus:outline-none focus:border-[color-mix(in_srgb,var(--gold-bright)_35%,transparent)] resize-y"
                  />
                </li>
              );
            })}
          </ul>

          {/* (#514) Save button bedazzled — was a thin outline pill that
              val missed. Now: solid gold filled, larger, prefixed with ✓
              and the active verb "Save". Pulses with gold glow on hover so
              it reads unambiguously as the save control. */}
          <div className="flex items-center gap-3 pt-3 border-t border-white/10 flex-wrap mt-1">
            <button
              onClick={runApply}
              disabled={busy !== 'idle' || pickedCount === 0}
              className={
                'rounded-lg px-5 py-2 text-[13px] font-semibold transition shadow-[0_0_0_1px_color-mix(in_srgb,var(--gold-bright)_60%,transparent)] ' +
                (busy !== 'idle' || pickedCount === 0
                  ? 'bg-white/10 text-white/40 cursor-not-allowed shadow-none'
                  : 'bg-[var(--gold-bright)] text-black hover:brightness-110 hover:shadow-[0_0_22px_color-mix(in_srgb,var(--gold-bright)_45%,transparent)]')
              }
            >
              {busy === 'applying'
                ? 'Applying…'
                : `✓ Apply ${pickedCount} field${pickedCount === 1 ? '' : 's'} to intake`}
            </button>
            <button
              onClick={discard}
              disabled={busy !== 'idle'}
              className="text-[11px] uppercase tracking-wider text-white/45 hover:text-white/80 px-2"
            >
              Discard
            </button>
            <span className="text-[10.5px] text-white/40">
              Reversible from the brief versions tab.
            </span>
          </div>
        </div>
      )}

      {/* Applied state — (#518) when 0 fields landed val needs to see WHY
          loudly, not as a "Saved 0 fields" line that reads like a glitch. */}
      {applied && (
        <div className={
          'rounded-md p-3 space-y-2 ' +
          (applied.writtenKeys.length > 0
            ? 'border border-emerald-500/30 bg-emerald-500/5'
            : 'border border-rose-400/30 bg-rose-500/5')
        }>
          <div className={
            'text-[12px] font-medium ' +
            (applied.writtenKeys.length > 0 ? 'text-emerald-200' : 'text-rose-200')
          }>
            {applied.writtenKeys.length > 0
              ? <>✓ Saved {applied.writtenKeys.length} field{applied.writtenKeys.length === 1 ? '' : 's'} to {clientName}&apos;s intake.</>
              : <>Nothing landed. {applied.skippedNonBlank.length > 0
                  ? `All ${applied.skippedNonBlank.length} fields you picked were already filled and "blanks only" was on.`
                  : 'No fields were applied.'}</>}
          </div>
          {applied.writtenKeys.length > 0 && (
            <div className="text-[11px] text-white/65 leading-relaxed">
              Updated: {applied.writtenKeys.map((k) => <code key={k} className="bg-black/30 px-1 rounded mr-1">{k}</code>)}
            </div>
          )}
          {applied.skippedNonBlank.length > 0 && (
            <div className="text-[11px] text-[color-mix(in_srgb,var(--gold-bright)_80%,transparent)] leading-relaxed">
              <strong className="text-rose-200">Skipped {applied.skippedNonBlank.length}</strong>: {applied.skippedNonBlank.map((k) => <code key={k} className="bg-black/30 px-1 rounded mr-1">{k}</code>)}
              <div className="mt-1 text-white/55">
                These already had values + &ldquo;blanks only&rdquo; was on. Uncheck the blanks-only toggle above OR check the row checkbox again — the panel will auto-allow overwrite for any row you opt in to.
              </div>
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
