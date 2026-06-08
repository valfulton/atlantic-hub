'use client';

/**
 * BrandKitPanel  (#208)
 *
 * Operator-side panel on the client page. Paste the client's website URL,
 * we fetch + extract a structured brand kit (colors + logo + aesthetic +
 * typography). Operator reviews — adjust hex codes, pick a different logo
 * from the candidate list, edit the aesthetic — then Apply. Writes to
 * creative_briefs as brand_colors / logo_url / has_logo / brand_aesthetic /
 * brand_typography (canonical intake keys + a new logo_url key).
 *
 * Pairs with FillIntakeFromWebPanel (#235): same URL, different signal.
 * Run both for a complete onboard from a single website.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface PreviewResponse {
  ok: true;
  colors: string[];
  logoUrl: string | null;
  logoCandidates: string[];
  aesthetic: string | null;
  typography: string | null;
  reasoning: string;
  /** (#509) Opinionated operator-facing verdict — empty string if the LLM
   *  didn't produce one (e.g. older preview before the prompt update). */
  verdict?: string;
  fetchedUrl: string;
  htmlBytes: number;
  tokensUsed: number;
  model: string;
}

interface ApplyResponse {
  ok: true;
  writtenKeys: string[];
  skippedNonBlank: string[];
  note?: string;
}

export default function BrandKitPanel({
  clientId,
  clientName,
  defaultUrl
}: {
  clientId: number;
  clientName: string;
  defaultUrl?: string | null;
}) {
  const router = useRouter();
  const [url, setUrl] = useState(defaultUrl || '');
  const [busy, setBusy] = useState<'idle' | 'previewing' | 'applying'>('idle');
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [applied, setApplied] = useState<ApplyResponse | null>(null);

  // Editable working copy.
  const [editColors, setEditColors] = useState('');
  const [editLogoUrl, setEditLogoUrl] = useState('');
  const [editAesthetic, setEditAesthetic] = useState('');
  const [editTypography, setEditTypography] = useState('');
  const [blanksOnly, setBlanksOnly] = useState(true);

  async function runPreview() {
    if (!url.trim()) { setErr('Paste a URL first.'); return; }
    setBusy('previewing');
    setErr(null);
    setApplied(null);
    try {
      const res = await fetch(`/api/admin/av/clients/${clientId}/extract-brand-kit`, {
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
      setEditColors(data.colors.join(', '));
      setEditLogoUrl(data.logoUrl || '');
      setEditAesthetic(data.aesthetic || '');
      setEditTypography(data.typography || '');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy('idle');
    }
  }

  async function runApply() {
    if (!preview) return;
    const colors = editColors.split(',').map((c) => c.trim()).filter(Boolean);
    setBusy('applying');
    setErr(null);
    try {
      const res = await fetch(`/api/admin/av/clients/${clientId}/extract-brand-kit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'apply',
          colors,
          logoUrl: editLogoUrl.trim() || null,
          aesthetic: editAesthetic.trim() || null,
          typography: editTypography.trim() || null,
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
    setApplied(null);
    setErr(null);
    setEditColors('');
    setEditLogoUrl('');
    setEditAesthetic('');
    setEditTypography('');
  }

  const inputCls =
    'w-full rounded-md bg-black/30 border border-white/10 px-2.5 py-1.5 text-[12px] text-white/90 ' +
    'placeholder-white/30 focus:outline-none focus:border-[color-mix(in_srgb,var(--gold-bright)_50%,transparent)]';

  // Parse the colors string back into a swatch preview.
  const swatches = editColors.split(',').map((c) => c.trim()).filter((c) => /^#[0-9a-fA-F]{6}$/.test(c));

  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="text-[11px] uppercase tracking-[0.12em] text-muted mb-1">
        Extract {clientName}&apos;s brand kit from the web
      </div>
      <div className="text-[12.5px] text-white/70 mb-3 leading-relaxed">
        Pulls brand colors, a logo candidate, typography, and aesthetic from their site so
        commercials / social cards / blog headers ship in their real visual identity — no manual
        color picking.
      </div>

      <div className="rounded-md border border-[color-mix(in_srgb,var(--gold-bright)_20%,transparent)] bg-[var(--gold-bright)]/[0.03] p-2.5 mb-3 space-y-1.5">
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 items-stretch">
          <input
            className={inputCls}
            placeholder="https://example.com"
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
            {busy === 'previewing' ? 'Reading…' : preview ? 'Re-read' : 'Extract brand kit'}
          </button>
        </div>
        {err && <div className="text-[10.5px] text-rose-300">{err}</div>}
      </div>

      {preview && !applied && (
        <div className="space-y-3">
          {preview.reasoning && (
            <div className="rounded-md border border-white/10 bg-black/15 p-3 text-[12px] text-white/80 leading-relaxed italic">
              <span className="not-italic text-[color-mix(in_srgb,var(--gold-bright)_85%,transparent)] text-[10px] uppercase tracking-wider mr-1.5">
                How I read it
              </span>
              {preview.reasoning}
            </div>
          )}

          {preview.verdict && (
            <div className="rounded-md border border-rose-400/30 bg-rose-500/[0.06] p-3 text-[12px] text-white/90 leading-relaxed">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-[10px] uppercase tracking-wider text-rose-200">
                  Verdict — sales ammo
                </span>
                <span className="text-[10px] text-white/40 italic">(operator-only · not shown to client)</span>
              </div>
              <div className="whitespace-pre-line">{preview.verdict}</div>
            </div>
          )}

          {/* Colors with swatches */}
          <div>
            <div className="text-[10px] uppercase tracking-[0.12em] text-white/55 mb-1">
              Brand colors (hex, most-prominent first)
            </div>
            <input
              className={inputCls}
              value={editColors}
              onChange={(e) => setEditColors(e.target.value)}
              placeholder="e.g. #0a1f3d, #d4a253, #ffffff"
            />
            {swatches.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {swatches.map((hex) => (
                  <span
                    key={hex}
                    className="inline-flex items-center gap-1.5 rounded-md border border-white/15 bg-black/30 px-2 py-1 text-[10.5px] font-mono text-white/85"
                  >
                    <span
                      aria-hidden="true"
                      className="inline-block h-3.5 w-3.5 rounded-sm border border-white/20"
                      style={{ background: hex }}
                    />
                    {hex}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Logo picker */}
          <div>
            <div className="text-[10px] uppercase tracking-[0.12em] text-white/55 mb-1">Logo URL</div>
            <input
              className={inputCls}
              value={editLogoUrl}
              onChange={(e) => setEditLogoUrl(e.target.value)}
              placeholder="https://…"
            />
            {preview.logoCandidates.length > 1 && (
              <div className="mt-2">
                <div className="text-[9.5px] uppercase tracking-wider text-white/45 mb-1">Other candidates from the page:</div>
                <div className="flex flex-wrap gap-1.5">
                  {preview.logoCandidates.map((u) => (
                    <button
                      key={u}
                      type="button"
                      onClick={() => setEditLogoUrl(u)}
                      className={
                        'text-[10px] px-2 py-0.5 rounded border transition ' +
                        (editLogoUrl === u
                          ? 'border-[color-mix(in_srgb,var(--gold-bright)_55%,transparent)] bg-[color-mix(in_srgb,var(--gold-bright)_10%,transparent)] text-[var(--gold-bright)]'
                          : 'border-white/15 bg-black/20 text-white/65 hover:text-white hover:border-white/30')
                      }
                    >
                      {u.length > 60 ? `${u.slice(0, 60)}…` : u}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {editLogoUrl && (
              <div className="mt-2 inline-flex items-center gap-2 rounded-md border border-white/10 bg-black/20 px-2 py-1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={editLogoUrl}
                  alt="logo preview"
                  className="h-8 w-auto max-w-[120px] object-contain bg-white/95 rounded p-0.5"
                />
                <span className="text-[10px] text-white/50">preview</span>
              </div>
            )}
          </div>

          {/* Aesthetic + typography */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <div className="text-[10px] uppercase tracking-[0.12em] text-white/55 mb-1">Aesthetic</div>
              <input
                className={inputCls}
                value={editAesthetic}
                onChange={(e) => setEditAesthetic(e.target.value)}
                placeholder="e.g. premium-wellness biohacker"
              />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-[0.12em] text-white/55 mb-1">Typography</div>
              <input
                className={inputCls}
                value={editTypography}
                onChange={(e) => setEditTypography(e.target.value)}
                placeholder="e.g. Inter sans-serif"
              />
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap pt-2 border-t border-white/5">
            <label className="flex items-center gap-1.5 text-[11px] text-white/75 cursor-pointer">
              <input
                type="checkbox"
                checked={blanksOnly}
                onChange={(e) => setBlanksOnly(e.target.checked)}
                className="h-3 w-3"
              />
              Only fill blank brief fields (safer)
            </label>
          </div>

          {/* (#514, val 2026-06-08) Save button bedazzled — was 11.5px thin
              outline that val didn't recognize as a save. Now: filled gold
              pill, larger, with the action prefix "Save →" so it's
              unambiguously the click-to-persist control. */}
          <div className="flex items-center gap-3 flex-wrap pt-2 border-t border-white/10 mt-1">
            <button
              onClick={runApply}
              disabled={busy !== 'idle'}
              className={
                'rounded-lg px-5 py-2 text-[13px] font-semibold transition shadow-[0_0_0_1px_color-mix(in_srgb,var(--gold-bright)_60%,transparent)] ' +
                (busy !== 'idle'
                  ? 'bg-white/10 text-white/40 cursor-not-allowed shadow-none'
                  : 'bg-[var(--gold-bright)] text-black hover:brightness-110 hover:shadow-[0_0_22px_color-mix(in_srgb,var(--gold-bright)_45%,transparent)]')
              }
            >
              {busy === 'applying' ? 'Saving…' : '✓ Save brand kit to brief'}
            </button>
            <button
              onClick={discard}
              disabled={busy !== 'idle'}
              className="text-[11px] uppercase tracking-wider text-white/45 hover:text-white/80 px-2"
            >
              Discard
            </button>
            <span className="text-[10.5px] text-white/40">
              Writes to brief: brand_colors, logo_url, has_logo, brand_aesthetic, brand_typography.
            </span>
          </div>

          {err && <div className="text-[10.5px] text-rose-300">{err}</div>}
        </div>
      )}

      {applied && (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 space-y-2">
          <div className="text-[12px] text-emerald-200 font-medium">
            ✓ Saved {applied.writtenKeys.length} brand-kit field{applied.writtenKeys.length === 1 ? '' : 's'} to {clientName}&apos;s brief.
          </div>
          {applied.writtenKeys.length > 0 && (
            <div className="text-[11px] text-white/65 leading-relaxed">
              Updated: {applied.writtenKeys.map((k) => <code key={k} className="bg-black/30 px-1 rounded mr-1">{k}</code>)}
            </div>
          )}
          {applied.skippedNonBlank.length > 0 && (
            <div className="text-[11px] text-[color-mix(in_srgb,var(--gold-bright)_80%,transparent)] leading-relaxed">
              Skipped {applied.skippedNonBlank.length} key{applied.skippedNonBlank.length === 1 ? '' : 's'} that already had values (uncheck &ldquo;blanks only&rdquo; to overwrite).
            </div>
          )}
          {applied.note && (
            <div className="text-[11px] text-white/55 italic">{applied.note}</div>
          )}
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
