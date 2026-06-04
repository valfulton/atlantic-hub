'use client';

/**
 * EditableField (#275 "leads that dont suck ass")
 *
 * Click-to-edit field that saves on blur or Enter. The whole point of this
 * component vs. what we had: it is LEGIBLE.
 *
 * Sizing rules — these are deliberate departures from the rest of the hub's
 * tiny defaults. val's vision struggles with the existing 10-12px labels and
 * dimmed (white/90, white/85) text. So:
 *   - Labels: text-sm (14px), uppercase letter-spacing kept readable, full
 *     muted token color but no opacity dimming.
 *   - Values: text-base (16px), full ink token (no opacity).
 *   - Inputs: text-base (16px), high-contrast border, the focused border is
 *     the brand color so val can SEE which field she is editing.
 *   - Generous padding so click targets are real, not 12px slivers.
 *
 * Wires to PATCH /api/admin/av/leads/[audit_id]. Same field-key whitelist
 * the existing PATCH already supports (company, contactName, contactTitle,
 * email, phone, website, industry, notes). No new server endpoint needed.
 *
 * Provenance chip: when an enrichment source filled this value (Smart enrich,
 * Places, IG, WHOIS, Apollo) the caller passes `provenance="places"` and we
 * render a small "via Google Places" chip in the source's color so val knows
 * where the data came from. The colors match EnrichFromSourcesMenu so they
 * are consistent across the app.
 */
import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';

type Provenance = 'smart' | 'places' | 'instagram' | 'whois' | 'apollo' | null;

const PROVENANCE_LABEL: Record<NonNullable<Provenance>, string> = {
  smart: 'via Smart enrich',
  places: 'via Google Places',
  instagram: 'via Instagram',
  whois: 'via WHOIS',
  apollo: 'via Apollo'
};

const PROVENANCE_CLASS: Record<NonNullable<Provenance>, string> = {
  smart: 'text-[#EBCB6B] bg-[#EBCB6B]/10 border-[#EBCB6B]/35',
  places: 'text-emerald-300 bg-emerald-400/10 border-emerald-400/40',
  instagram: 'text-pink-300 bg-pink-400/10 border-pink-400/40',
  whois: 'text-violet-300 bg-violet-400/10 border-violet-400/40',
  apollo: 'text-sky-300 bg-sky-400/10 border-sky-400/40'
};

export function EditableField({
  auditId,
  fieldKey,
  label,
  value,
  multiline = false,
  provenance = null,
  placeholder = 'Not set — click to add'
}: {
  auditId: string;
  fieldKey: string;
  label: string;
  value: string | null;
  multiline?: boolean;
  provenance?: Provenance;
  placeholder?: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  useEffect(() => { setDraft(value ?? ''); }, [value]);
  useEffect(() => { if (editing && inputRef.current) inputRef.current.focus(); }, [editing]);

  async function save() {
    const next = draft.trim();
    const prev = (value ?? '').trim();
    if (next === prev) { setEditing(false); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/av/leads/${auditId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [fieldKey]: next === '' ? null : next })
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError((j as { error?: string }).error || `Save failed (${res.status})`);
        setSaving(false);
        return;
      }
      setSaving(false);
      setEditing(false);
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 1800);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }

  function cancel() {
    setDraft(value ?? '');
    setEditing(false);
    setError(null);
  }

  return (
    <div className="min-w-0">
      {/* Label row — readable size, the design token muted color, no dimming. */}
      <div className="flex items-center flex-wrap gap-2 mb-1.5">
        <span className="text-sm font-medium text-muted">{label}</span>
        {provenance && (
          <span
            className={`text-xs px-2 py-0.5 rounded-full border ${PROVENANCE_CLASS[provenance]}`}
            title={`This value was filled ${PROVENANCE_LABEL[provenance]}`}
          >
            {PROVENANCE_LABEL[provenance]}
          </span>
        )}
        {savedFlash && (
          <span className="text-xs font-medium text-emerald-300">Saved</span>
        )}
      </div>

      {editing ? (
        <div className="flex flex-col gap-1.5">
          {multiline ? (
            <textarea
              ref={(el) => { inputRef.current = el; }}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') cancel();
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save();
              }}
              onBlur={save}
              rows={5}
              className="w-full bg-surface border-2 border-border focus:border-brand rounded-md px-3 py-2 text-base text-ink outline-none resize-y"
            />
          ) : (
            <input
              ref={(el) => { inputRef.current = el; }}
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') cancel();
                if (e.key === 'Enter') save();
              }}
              onBlur={save}
              className="w-full bg-surface border-2 border-border focus:border-brand rounded-md px-3 py-2 text-base text-ink outline-none"
            />
          )}
          {saving && <span className="text-sm text-muted">Saving…</span>}
          {error && <span className="text-sm text-rose-300">{error}</span>}
          <div className="text-sm text-muted">
            {multiline ? 'Cmd/Ctrl-Enter to save · Esc to cancel · click outside to save' : 'Enter to save · Esc to cancel · click outside to save'}
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="w-full text-left text-base text-ink hover:bg-surface rounded-md px-3 py-2 -mx-3 transition-colors break-words"
          title="Click to edit"
        >
          {value && value.trim()
            ? (multiline ? <span className="whitespace-pre-wrap">{value}</span> : value)
            : <span className="text-muted italic">{placeholder}</span>}
        </button>
      )}
    </div>
  );
}
