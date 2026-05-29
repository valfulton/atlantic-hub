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
 */
import { useMemo, useState } from 'react';
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

  const filled = CLIENT_INTAKE_KEYS.filter((k) => (fields[k] || '').trim()).length;

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

  const input =
    'w-full rounded-lg border border-border bg-black/20 px-3 py-2 text-sm text-ink ' +
    'placeholder-muted/50 focus:outline-none focus:border-brand';

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-border bg-surface p-5">
        <div className="text-[10px] uppercase tracking-[0.18em] text-brand mb-1">✦ Your details</div>
        <h1 className="text-2xl font-semibold text-ink">Let&apos;s make {brandName} shine.</h1>
        <p className="text-sm text-muted mt-2 leading-relaxed">
          We&apos;ve filled in what we already know — just review it, fix anything that&apos;s off,
          and add what we missed. The more you share, the sharper everything we create for you will be.
          You can come back and update this any time.
        </p>
        <div className="mt-3 text-xs text-muted">{filled} of {CLIENT_INTAKE_KEYS.length} answered</div>
      </div>

      {CLIENT_INTAKE_GROUPS.map((grp) => (
        <div key={grp.group} className="rounded-2xl border border-border bg-surface p-5">
          <div className="text-[10px] uppercase tracking-[0.18em] text-brand/80 mb-3">{grp.group}</div>
          <div className="grid sm:grid-cols-2 gap-4">
            {grp.fields.map((f) => (
              <label key={f.key} className={f.area ? 'block sm:col-span-2' : 'block'}>
                <span className="text-sm text-ink font-medium">{f.label}</span>
                {f.hint && <span className="block text-[11px] text-muted mb-1">{f.hint}</span>}
                {f.area ? (
                  <textarea
                    className={input}
                    rows={f.example && f.example.length > 80 ? 3 : 2}
                    placeholder={f.example ?? ''}
                    value={fields[f.key] ?? ''}
                    onChange={(e) => set(f.key, e.target.value)}
                  />
                ) : (
                  <input
                    className={input}
                    placeholder={f.example ?? ''}
                    value={fields[f.key] ?? ''}
                    onChange={(e) => set(f.key, e.target.value)}
                  />
                )}
                {f.why && (
                  <span className="block text-[11px] text-brand/70 mt-1 italic">
                    Used for: {f.why}
                  </span>
                )}
              </label>
            ))}
          </div>
        </div>
      ))}

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
        {msg && <span className={'text-sm ' + (msg.ok ? 'text-emerald-300' : 'text-rose-300')}>{msg.text}</span>}
      </div>
    </div>
  );
}
