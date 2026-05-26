'use client';

/**
 * ClientIntakeForm — the client reviews + perfects the details Atlantic & Vine
 * prefilled for them, then saves. Warm + encouraging (not a cold form): they're
 * approving/tweaking, not starting from scratch. Saves to /api/client/intake-update,
 * which snapshots a restore point first so nothing they change is lost irreversibly.
 *
 * Edits merge over the full stored payload so any fields this form doesn't render
 * (operator-only knobs) are preserved.
 */
import { useMemo, useState } from 'react';

const QUESTIONS: { key: string; label: string; hint: string; area?: boolean }[] = [
  { key: 'key_message', label: 'If a customer remembers one thing about you, what should it be?', hint: 'Your single most important message', area: true },
  { key: 'target_audience', label: 'Who are your ideal customers?', hint: 'The people you most want to reach', area: true },
  { key: 'audience_insights', label: 'What do you know about them?', hint: 'What they want, worry about, or already believe', area: true },
  { key: 'why_advertise', label: 'What are you hoping to achieve right now?', hint: 'Why this matters to you today' },
  { key: 'goals', label: 'What would success look like in 90 days?', hint: 'Bookings, leads, awareness, a launch…' },
  { key: 'message_support', label: 'Why should customers believe it?', hint: 'Results, reviews, awards, credentials' },
  { key: 'differentiators', label: 'What makes you different?', hint: 'What only you can credibly claim' },
  { key: 'competitors', label: 'Who else do customers consider?', hint: 'Your main competitors' },
  { key: 'brand_voice', label: 'How should your brand sound?', hint: 'e.g. warm, confident, playful, refined' },
  { key: 'preferred_channels', label: 'Where do your customers spend time?', hint: 'LinkedIn, email, Instagram…' },
  { key: 'brand_colors', label: 'Brand colors', hint: 'If you have them' },
  { key: 'timeline', label: 'Busy seasons or key dates?', hint: 'When timing matters for you' }
];

const KEYS = QUESTIONS.map((q) => q.key);

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
    for (const k of KEYS) o[k] = typeof initial[k] === 'string' ? (initial[k] as string) : '';
    return o;
  }, [initial]);

  const [fields, setFields] = useState<Record<string, string>>(seeded);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const filled = KEYS.filter((k) => (fields[k] || '').trim()).length;

  function set(k: string, v: string) {
    setFields((p) => ({ ...p, [k]: v }));
    setDirty(true);
    setMsg(null);
  }

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      // Merge over the full stored payload so unrendered keys survive.
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
    'placeholder-muted/60 focus:outline-none focus:border-brand';

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
        <div className="mt-3 text-xs text-muted">{filled} of {KEYS.length} answered</div>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        {QUESTIONS.map((q) => (
          <label key={q.key} className={q.area ? 'block sm:col-span-2' : 'block'}>
            <span className="text-sm text-ink font-medium">{q.label}</span>
            <span className="block text-[11px] text-muted mb-1">{q.hint}</span>
            {q.area ? (
              <textarea className={input} rows={2} value={fields[q.key]} onChange={(e) => set(q.key, e.target.value)} />
            ) : (
              <input className={input} value={fields[q.key]} onChange={(e) => set(q.key, e.target.value)} />
            )}
          </label>
        ))}
      </div>

      <div className="flex items-center gap-3">
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
