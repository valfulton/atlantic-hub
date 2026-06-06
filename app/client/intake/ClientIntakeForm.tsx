'use client';

/**
 * ClientIntakeForm — the client reviews + perfects the details Atlantic & Vine
 * prefilled for them, then saves. Warm + encouraging (not a cold form): they're
 * approving/tweaking, not starting from scratch. Saves to /api/client/intake-update,
 * which snapshots a restore point first so nothing they change is lost irreversibly.
 *
 * Edits merge over the full stored payload so any fields this form doesn't render
 * (operator-only knobs) are preserved.
 *
 * (#200) Now reads from the canonical CLIENT_INTAKE_GROUPS in
 * lib/client/intake_fields.ts -- previously this file carried its own local
 * 12-question list which silently drifted from the canonical 50-field set,
 * which is the root cause of why Skip + Mike's intake_payload was missing
 * every Tier 1/2/3 field. They never saw those questions on the form they
 * filled. Forcing-function labels (Fix 1), example placeholders (Fix 2), and
 * "Used for:" why-captions (Fix 3) are all driven from the same source now.
 *
 * (#236) "Your turn" treatment: when val pre-fills the intake from research,
 * the blank fields are the ones the client MUST answer. The form now:
 *   - shows a sticky "Still need you (n)" header counter
 *   - tags each blank field with a soft amber "Your turn" pill
 *   - per-group counter shows "All in" or "n left for you"
 *   - "Jump to the next field that needs you" link scrolls them through
 *     the blanks one at a time -- so a busy client doesn't have to scan
 *     all 51 questions to find the 5 we couldn't infer.
 */
import { useMemo, useState, useRef, useCallback } from 'react';
import { CLIENT_INTAKE_GROUPS, CLIENT_INTAKE_KEYS } from '@/lib/client/intake_fields';

export default function ClientIntakeForm({
  initial,
  brandName,
  shareToken
}: {
  initial: Record<string, unknown>;
  brandName: string;
  /** When set, this is the no-login SHARE flow: submit via the public token
   *  endpoint and show a thank-you (no session, no set-password redirect). */
  shareToken?: string;
}) {
  const seeded = useMemo(() => {
    const o: Record<string, string> = {};
    for (const k of CLIENT_INTAKE_KEYS) o[k] = typeof initial[k] === 'string' ? (initial[k] as string) : '';
    return o;
  }, [initial]);

  const [fields, setFields] = useState<Record<string, string>>(seeded);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // (#236) Refs to each field's wrapper so "Jump to next blank" can smooth-scroll
  // the client straight to the field that needs them. One ref per intake key.
  const fieldRefs = useRef<Record<string, HTMLLabelElement | null>>({});

  // (#236) Per-field blank check, derived from the current edit state so the
  // amber "Your turn" treatment lifts the moment they fill the field.
  const isBlank = useCallback((k: string) => !(fields[k] || '').trim(), [fields]);

  // Totals + per-group blank counts power the sticky header + group meters.
  const totals = useMemo(() => {
    let filled = 0;
    let blank = 0;
    for (const k of CLIENT_INTAKE_KEYS) {
      if ((fields[k] || '').trim()) filled += 1;
      else blank += 1;
    }
    return { filled, blank, total: CLIENT_INTAKE_KEYS.length };
  }, [fields]);

  const groupCounts = useMemo(() => {
    const out: Record<string, { blank: number; total: number }> = {};
    for (const g of CLIENT_INTAKE_GROUPS) {
      let b = 0;
      for (const f of g.fields) if (!(fields[f.key] || '').trim()) b += 1;
      out[g.group] = { blank: b, total: g.fields.length };
    }
    return out;
  }, [fields]);

  /**
   * Scroll the client to the next blank field. If a scope is passed (group
   * name) only blanks in that group count; otherwise it walks all groups in
   * order. Skips any field they already filled this session.
   */
  function jumpToNextBlank(scopeGroup?: string) {
    const ordered: string[] = [];
    for (const g of CLIENT_INTAKE_GROUPS) {
      if (scopeGroup && g.group !== scopeGroup) continue;
      for (const f of g.fields) ordered.push(f.key);
    }
    const nextKey = ordered.find((k) => isBlank(k));
    if (!nextKey) return;
    const el = fieldRefs.current[nextKey];
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    // Focus the underlying input after the scroll settles so they can type.
    setTimeout(() => {
      const input = el.querySelector('input, textarea') as HTMLElement | null;
      input?.focus();
    }, 350);
  }

  function set(k: string, v: string) {
    setFields((p) => ({ ...p, [k]: v }));
    setDirty(true);
    setMsg(null);
  }

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      // Merge over the full stored payload so unrendered (operator-only) keys survive.
      const merged: Record<string, unknown> = { ...initial, ...fields };
      const res = await fetch(shareToken ? '/api/client/intake-form' : '/api/client/intake-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(shareToken ? { token: shareToken, payload: merged } : { payload: merged })
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data?.error || 'Could not save.');
      setDirty(false);
      if (shareToken) {
        // No-login share flow: no session, so just confirm — don't redirect.
        setMsg({ ok: true, text: 'Thank you — your details are saved. We’ll take it from here!' });
      } else {
        // Logged-in flow: details saved — return them to their dashboard.
        // (Password is handled by the magic-link flow before the portal, so no
        // set-password detour here.)
        window.location.href = '/client/dashboard';
      }
      return;
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setSaving(false);
    }
  }

  const inputBase =
    'w-full rounded-lg border bg-white px-3 py-2 text-sm text-ink ' +
    'placeholder-muted/50 focus:outline-none focus:border-brand transition-colors';
  // (#236) Blank fields get a soft amber border so the client's eye finds them.
  const inputBlank = 'border-[color-mix(in_srgb,var(--gold-bright)_45%,transparent)]';
  const inputFilled = 'border-border';

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-border bg-[var(--paper)] p-5">
        <div className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--emerald-deep)] mb-1">✦ Your details</div>
        <h1 className="text-2xl font-semibold text-ink">Let&apos;s make {brandName} shine.</h1>
        <p className="text-sm text-muted mt-2 leading-relaxed">
          We&apos;ve filled in what we already know — just review it, fix anything that&apos;s off,
          and add what we missed. The more you share, the sharper everything we create for you will be.
          You can come back and update this any time.
        </p>

        {/* (#236) Progress + "still need you" pill + jump affordance. The pill
            is the load-bearing element — it tells the client exactly how many
            questions remain for them, so they don't have to scan all 51. */}
        <div className="mt-4 flex items-center gap-3 flex-wrap">
          <span className="text-xs text-muted">
            {totals.filled} of {totals.total} answered
          </span>
          {totals.blank > 0 ? (
            <>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[color-mix(in_srgb,var(--gold-bright)_45%,transparent)] bg-[color-mix(in_srgb,var(--gold-bright)_10%,transparent)] px-2.5 py-0.5 text-[11px] font-medium text-[color:var(--amber-deep)]">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--gold-bright)]" aria-hidden="true" />
                Still need you on {totals.blank}
              </span>
              <button
                type="button"
                onClick={() => jumpToNextBlank()}
                className="text-[11.5px] font-medium text-[color:var(--amber-deep)] hover:text-[color:var(--emerald-deep)] underline-offset-2 hover:underline"
              >
                Jump to the next one →
              </button>
            </>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--emerald-deep)]/30 bg-[var(--emerald-mist)] px-2.5 py-0.5 text-[11px] font-medium text-[color:var(--emerald-deep)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--emerald)]" aria-hidden="true" />
              Everything is in — ready to save
            </span>
          )}
        </div>
      </div>

      {CLIENT_INTAKE_GROUPS.map((grp) => {
        const count = groupCounts[grp.group];
        const groupBlank = count?.blank ?? 0;
        return (
          <div key={grp.group} className="rounded-2xl border border-border bg-[var(--paper)] p-5">
            {/* (#236) Per-group header now shows the same blank count + a
                scoped "jump to next in this section" link so the client can
                fix one section at a time. */}
            <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
              <div className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--emerald-deep)]/80">{grp.group}</div>
              {groupBlank > 0 ? (
                <button
                  type="button"
                  onClick={() => jumpToNextBlank(grp.group)}
                  className="inline-flex items-center gap-1.5 text-[10.5px] uppercase tracking-[0.14em] font-medium text-[color:var(--amber-deep)] hover:text-[color:var(--emerald-deep)]"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--gold-bright)]" aria-hidden="true" />
                  {groupBlank} left for you →
                </button>
              ) : (
                <span className="text-[10.5px] uppercase tracking-[0.14em] font-medium text-[color:var(--emerald-deep)]">
                  ✓ All in
                </span>
              )}
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              {grp.fields.map((f) => {
                const blank = isBlank(f.key);
                return (
                  <label
                    key={f.key}
                    ref={(el) => {
                      fieldRefs.current[f.key] = el;
                    }}
                    className={f.area ? 'block sm:col-span-2' : 'block'}
                  >
                    <span className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm text-ink font-medium">{f.label}</span>
                      {/* (#236) "Your turn" pill on every blank field — soft
                          amber so it points the eye without nagging. Drops the
                          moment the field has any non-whitespace content. */}
                      {blank && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-[color-mix(in_srgb,var(--gold-bright)_45%,transparent)] bg-[color-mix(in_srgb,var(--gold-bright)_10%,transparent)] px-1.5 py-0 text-[10px] uppercase tracking-[0.12em] font-medium text-[color:var(--amber-deep)]">
                          <span className="h-1 w-1 rounded-full bg-[var(--gold-bright)]" aria-hidden="true" />
                          Your turn
                        </span>
                      )}
                    </span>
                    {f.hint && <span className="block text-[11px] text-muted mb-1">{f.hint}</span>}
                    {f.area ? (
                      <textarea
                        className={`${inputBase} ${blank ? inputBlank : inputFilled}`}
                        rows={f.example && f.example.length > 80 ? 3 : 2}
                        placeholder={f.example ?? ''}
                        value={fields[f.key] ?? ''}
                        onChange={(e) => set(f.key, e.target.value)}
                      />
                    ) : (
                      <input
                        className={`${inputBase} ${blank ? inputBlank : inputFilled}`}
                        placeholder={f.example ?? ''}
                        value={fields[f.key] ?? ''}
                        onChange={(e) => set(f.key, e.target.value)}
                      />
                    )}
                    {f.why && (
                      <span className="block text-[11px] text-[color:var(--emerald-deep)]/70 mt-1 italic">
                        Used for: {f.why}
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
          </div>
        );
      })}

      <div className="flex items-center gap-3 sticky bottom-4">
        <button
          onClick={save}
          disabled={saving || !dirty}
          className={
            'rounded-lg px-5 py-2.5 text-sm font-medium transition ' +
            (saving || !dirty ? 'bg-surface-2 text-muted cursor-not-allowed' : 'bg-brand text-brand-fg hover:opacity-90')
          }
        >
          {saving ? 'Saving…' : dirty ? 'Save my details' : 'Saved'}
        </button>
        {/* (#236) Bottom shortcut for the busy client who's scrolled all the
            way down and still has blanks — keeps them in the form. */}
        {totals.blank > 0 && (
          <button
            type="button"
            onClick={() => jumpToNextBlank()}
            className="text-[11.5px] font-medium text-[color:var(--amber-deep)] hover:text-[color:var(--emerald-deep)]"
          >
            Jump to next blank ↑
          </button>
        )}
        {msg && <span className={'text-sm ' + (msg.ok ? 'text-[color:var(--emerald-deep)]' : 'text-muted italic')}>{msg.text}</span>}
      </div>
    </div>
  );
}
