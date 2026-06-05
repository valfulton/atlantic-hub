'use client';

/**
 * PopupCopyEditor  (#408)
 *
 * Edit the WelcomePopover slide copy. Per-slide eyebrow / title / body /
 * optional inline link + tier gating. Save POSTs to /api/admin/av/popups.
 * Add / remove slides live; live preview on the right.
 */
import { useState } from 'react';
import type { WelcomeSlide } from '@/lib/welcome/copy';

const TIER_OPTIONS: Array<'audit_only' | 'sprint' | 'momentum' | 'scale'> = [
  'audit_only', 'sprint', 'momentum', 'scale'
];

export default function PopupCopyEditor({
  initialSlides,
  defaults
}: {
  initialSlides: WelcomeSlide[];
  defaults: WelcomeSlide[];
}) {
  const [slides, setSlides] = useState<WelcomeSlide[]>(initialSlides);
  const [activeIdx, setActiveIdx] = useState(0);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function updateActive(patch: Partial<WelcomeSlide>) {
    setSlides((arr) => arr.map((s, i) => (i === activeIdx ? { ...s, ...patch } : s)));
  }

  function addSlide() {
    setSlides((arr) => [
      ...arr,
      { eyebrow: 'New slide', title: 'New headline.', body: 'New body copy.' }
    ]);
    setActiveIdx(slides.length);
  }

  function deleteActive() {
    if (slides.length <= 1) return;
    setSlides((arr) => arr.filter((_, i) => i !== activeIdx));
    setActiveIdx(Math.max(0, activeIdx - 1));
  }

  function resetToDefaults() {
    if (!confirm('Replace current slides with the factory defaults? Your edits will be lost.')) return;
    setSlides(defaults);
    setActiveIdx(0);
  }

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch('/api/admin/av/popups', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slides })
      });
      const j = await res.json();
      if (!res.ok || !j.ok) {
        setMsg({ ok: false, text: j.error || 'Save failed.' });
        return;
      }
      setMsg({ ok: true, text: 'Saved. Live for new sign-ins immediately.' });
    } catch {
      setMsg({ ok: false, text: 'Network error. Try again.' });
    } finally {
      setSaving(false);
    }
  }

  const slide = slides[activeIdx];
  if (!slide) return null;

  const toggleTier = (t: 'audit_only' | 'sprint' | 'momentum' | 'scale') => {
    const current = new Set(slide.tiers ?? TIER_OPTIONS);
    if (current.has(t)) current.delete(t);
    else current.add(t);
    updateActive({ tiers: current.size === TIER_OPTIONS.length ? undefined : Array.from(current) as WelcomeSlide['tiers'] });
  };

  const previewTitle = slide.title
    .replace(/\{firstName\}/g, 'Adriana')
    .replace(/\{brandName\}/g, 'Central Business Bureau');
  const previewBody = slide.body
    .replace(/\{firstName\}/g, 'Adriana')
    .replace(/\{brandName\}/g, 'Central Business Bureau');

  return (
    <div className="grid lg:grid-cols-[1fr_440px] gap-8 items-start">
      {/* LEFT — editor */}
      <div>
        {/* Slide tabs */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          {slides.map((s, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setActiveIdx(i)}
              className={
                'inline-flex items-center px-3 py-1.5 rounded-md border text-xs ' +
                (i === activeIdx
                  ? 'border-[color-mix(in_srgb,var(--gold-bright)_40%,transparent)] bg-[color-mix(in_srgb,var(--gold-bright)_10%,transparent)] text-[var(--gold-bright)] font-medium'
                  : 'border-border bg-surface text-muted hover:text-ink hover:border-[color-mix(in_srgb,var(--gold-bright)_30%,transparent)]')
              }
            >
              Step {i + 1}{s.eyebrow ? ` · ${s.eyebrow}` : ''}
            </button>
          ))}
          <button
            type="button"
            onClick={addSlide}
            className="inline-flex items-center px-3 py-1.5 rounded-md border border-dashed border-border text-xs text-muted hover:text-ink"
          >
            + Add slide
          </button>
        </div>

        {/* Slide form */}
        <div className="rounded-2xl border border-border bg-surface p-6 space-y-4">
          <Field
            label="Eyebrow (small caps over the headline)"
            value={slide.eyebrow}
            onChange={(v) => updateActive({ eyebrow: v })}
          />
          <Field
            label="Headline"
            value={slide.title}
            onChange={(v) => updateActive({ title: v })}
          />
          <Field
            label="Body"
            value={slide.body}
            onChange={(v) => updateActive({ body: v })}
            textarea
          />
          <div className="grid sm:grid-cols-2 gap-4">
            <Field
              label="Link label (optional)"
              value={slide.hrefLabel ?? ''}
              onChange={(v) => updateActive({ hrefLabel: v || undefined })}
              placeholder="e.g. See your leads →"
            />
            <Field
              label="Link href (optional)"
              value={slide.href ?? ''}
              onChange={(v) => updateActive({ href: v || undefined })}
              placeholder="e.g. /client/leads"
            />
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-[0.16em] text-muted mb-2">
              Show this slide to tiers
            </div>
            <div className="flex flex-wrap gap-2">
              {TIER_OPTIONS.map((t) => {
                const on = !slide.tiers || slide.tiers.includes(t);
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => toggleTier(t)}
                    className={
                      'inline-flex items-center px-2.5 py-1 rounded-md border text-[11px] uppercase tracking-[0.12em] ' +
                      (on
                        ? 'border-[color-mix(in_srgb,var(--gold-bright)_40%,transparent)] text-[var(--gold-bright)] bg-[color-mix(in_srgb,var(--gold-bright)_8%,transparent)]'
                        : 'border-border text-muted')
                    }
                  >
                    {t.replace('_', ' ')}
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-muted mt-2">
              Leave all on to show this slide to everyone. Deselect a tier to hide it for that plan.
            </p>
          </div>

          <div className="pt-4 flex flex-wrap items-center justify-between gap-4 border-t border-border">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={deleteActive}
                disabled={slides.length <= 1}
                className="px-3 py-1.5 text-xs text-muted hover:text-rose-300 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Delete slide
              </button>
              <button
                type="button"
                onClick={resetToDefaults}
                className="px-3 py-1.5 text-xs text-muted hover:text-ink"
              >
                Reset to defaults
              </button>
            </div>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="px-5 py-2 rounded-md border border-[var(--gold-bright)] text-[var(--gold-bright)] hover:bg-[color-mix(in_srgb,var(--gold-bright)_10%,transparent)] text-sm font-medium disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Save all slides'}
            </button>
          </div>

          {msg && (
            <div
              className={
                'text-sm ' + (msg.ok ? 'text-emerald-300' : 'text-rose-300')
              }
            >
              {msg.text}
            </div>
          )}
        </div>
      </div>

      {/* RIGHT — preview */}
      <aside className="sticky top-4">
        <p className="text-[10px] uppercase tracking-[0.22em] text-muted mb-3">
          Live preview · Step {activeIdx + 1} of {slides.length}
        </p>
        <div
          style={{
            borderRadius: 24,
            border: '1px solid rgba(235, 203, 107, 0.25)',
            background:
              'radial-gradient(140% 160% at 0% 0%, rgba(235, 203, 107, 0.10), transparent 55%), linear-gradient(180deg, #0e1525 0%, #0a1120 100%)',
            padding: '28px 28px 22px',
            color: '#e2e8f0'
          }}
        >
          <div style={{ fontSize: 10, letterSpacing: '0.22em', textTransform: 'uppercase', color: 'var(--gold-bright)', marginBottom: 8 }}>
            {slide.eyebrow}
          </div>
          <h2 style={{ margin: '0 0 10px', fontSize: 22, lineHeight: 1.25, color: '#f8fafc', fontWeight: 600 }}>
            {previewTitle}
          </h2>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: '#cbd5e1' }}>{previewBody}</p>
          {slide.href && slide.hrefLabel && (
            <span style={{ display: 'inline-block', marginTop: 14, fontSize: 13, color: 'var(--gold-bright)', fontWeight: 500 }}>
              {slide.hrefLabel}
            </span>
          )}
          <div style={{ display: 'flex', gap: 6, marginTop: 22 }}>
            {slides.map((_, i) => (
              <span
                key={i}
                style={{
                  display: 'inline-block',
                  width: i === activeIdx ? 18 : 6,
                  height: 6,
                  borderRadius: 3,
                  background: i === activeIdx ? 'var(--gold-bright)' : 'rgba(255,255,255,0.18)'
                }}
              />
            ))}
          </div>
        </div>
        <p className="text-[11px] text-muted mt-3">
          Tokens substituted with sample values (Adriana / Central Business Bureau) for preview.
        </p>
      </aside>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  textarea,
  placeholder
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  textarea?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="block text-[10px] uppercase tracking-[0.16em] text-muted mb-1.5">{label}</span>
      {textarea ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={4}
          placeholder={placeholder}
          className="w-full bg-bg/40 border border-border rounded-md px-3 py-2 text-[14px] text-ink focus:border-[color-mix(in_srgb,var(--gold-bright)_50%,transparent)] focus:outline-none"
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full bg-bg/40 border border-border rounded-md px-3 py-2 text-[14px] text-ink focus:border-[color-mix(in_srgb,var(--gold-bright)_50%,transparent)] focus:outline-none"
        />
      )}
    </label>
  );
}
