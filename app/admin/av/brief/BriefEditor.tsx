'use client';

import { useCallback, useEffect, useState } from 'react';

interface Customer {
  key: string;
  label: string;
  kind: 'brand' | 'client';
  tenantId: string;
  clientId: number | null;
}

const BRAND_FALLBACK: Customer[] = [
  { key: 'av:house', label: 'Atlantic & Vine', kind: 'brand', tenantId: 'av', clientId: null },
  { key: 'ebw:house', label: 'Events by Water', kind: 'brand', tenantId: 'ebw', clientId: null },
  { key: 'hh:house', label: 'Hunter Honey', kind: 'brand', tenantId: 'hh', clientId: null }
];

// The canonical 6 questions (val's creative-brief structure). Keys match the
// canonical names extractBriefSeedFromIntake() reads first.
const QUESTIONS: { key: string; q: string; label: string; placeholder: string }[] = [
  { key: 'why_advertise', q: 'Q1', label: 'Why advertise?', placeholder: 'Why put this brand in front of people right now?' },
  { key: 'goals', q: 'Q2', label: 'What should it accomplish?', placeholder: 'The concrete outcome — bookings, leads, authority, a launch...' },
  { key: 'target_audience', q: 'Q3', label: 'Who are we talking to?', placeholder: 'The ideal client / audience, in their own terms' },
  { key: 'audience_insights', q: 'Q4', label: 'What do we know about them?', placeholder: 'Insights, pains, what they already believe or feel' },
  { key: 'key_message', q: 'Q5', label: 'Single most important message', placeholder: 'The one thing they must take away (seeds the thesis)' },
  { key: 'message_support', q: 'Q6', label: 'Why should they believe it?', placeholder: 'Proof, results, awards, credentials' }
];

const EXTRAS: { key: string; label: string; placeholder: string }[] = [
  { key: 'brand_voice', label: 'Brand voice', placeholder: 'e.g. warm + nautical, plural "our team", never salesy' },
  { key: 'differentiators', label: 'Differentiators', placeholder: 'What only this brand can credibly claim' },
  { key: 'competitors', label: 'Competitors', placeholder: 'Who they are measured against' },
  { key: 'preferred_channels', label: 'Preferred channels', placeholder: 'LinkedIn, newsroom, email...' },
  { key: 'timeline', label: 'Seasonality / key dates', placeholder: 'Busy seasons, launch windows, key dates' },
  { key: 'brand_colors', label: 'Brand colors', placeholder: 'e.g. dark navy + amber' }
];

const ALL_KEYS = [...QUESTIONS.map((q) => q.key), ...EXTRAS.map((e) => e.key)];

// How this brand uses the PR / news intel — drives matching + default pitch voice.
const POSTURE_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Not set' },
  { value: 'self_promotion', label: 'Win PR for this brand (speak as them)' },
  { value: 'work_leads', label: "Use intel to work their own leads (reach out to prospects)" },
  { value: 'both', label: 'Both' }
];
const VOICE_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Auto (safe default — advisory)' },
  { value: 'client_voice', label: 'Speak AS the brand (client voice)' },
  { value: 'advisory', label: 'Reach out TO a prospect (advisory)' },
  { value: 'congratulatory', label: 'Warm congratulations note' }
];

type Payload = Record<string, string>;

export function BriefEditor({ customers, initialKey }: { customers: Customer[]; initialKey?: string }) {
  const scopes = customers.length ? customers : BRAND_FALLBACK;
  const defaultKey = (initialKey && scopes.some((s) => s.key === initialKey) ? initialKey : null) ?? scopes[0]?.key ?? 'av:house';
  const [activeKey, setActiveKey] = useState<string>(defaultKey);
  const active = scopes.find((s) => s.key === activeKey) ?? scopes[0];

  const [payload, setPayload] = useState<Payload>({});
  // Full stored payload (incl. keys this editor doesn't render) so a save never drops them.
  const [rawPayload, setRawPayload] = useState<Record<string, unknown>>({});
  const [posture, setPosture] = useState<string>('');
  const [voice, setVoice] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [promptBlock, setPromptBlock] = useState<string>('');
  const [grounded, setGrounded] = useState<boolean>(false);
  const [brandName, setBrandName] = useState<string>(active?.label ?? '');
  const [versions, setVersions] = useState<{ id: number; source: string; changedBy: string | null; createdAt: string }[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const loadBrief = useCallback(async (scope: Customer) => {
    setLoading(true);
    setMsg(null);
    try {
      const params = new URLSearchParams({ tenantId: scope.tenantId });
      if (scope.clientId != null) params.set('clientId', String(scope.clientId));
      const res = await fetch(`/api/admin/av/brief?${params.toString()}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Could not load this brief.');
      const incoming: Payload = {};
      const src = (data.payload ?? {}) as Record<string, unknown>;
      for (const k of ALL_KEYS) incoming[k] = typeof src[k] === 'string' ? (src[k] as string) : '';
      setPayload(incoming);
      setRawPayload(src);
      setPosture(typeof src['intel_posture'] === 'string' ? (src['intel_posture'] as string) : '');
      setVoice(typeof src['default_voice'] === 'string' ? (src['default_voice'] as string) : '');
      setPromptBlock(typeof data.promptBlock === 'string' ? data.promptBlock : '');
      setGrounded(!!data.grounded);
      setBrandName(typeof data.brandName === 'string' ? data.brandName : scope.label);
      setDirty(false);
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (active) loadBrief(active);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey]);

  const setField = (k: string, v: string) => {
    setPayload((p) => ({ ...p, [k]: v }));
    setDirty(true);
    setMsg(null);
  };

  const save = async () => {
    if (!active) return;
    setSaving(true);
    setMsg(null);
    try {
      // Merge edits over the full stored payload so unrendered keys survive.
      const merged: Record<string, unknown> = { ...rawPayload, ...payload, intel_posture: posture, default_voice: voice };
      const res = await fetch('/api/admin/av/brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: active.tenantId, clientId: active.clientId, payload: merged })
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data?.error || 'Save failed.');
      setMsg({ ok: true, text: 'Saved — grounding refreshed below.' });
      setDirty(false);
      await loadBrief(active); // re-pull so the prompt block reflects the new brief
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const loadHistory = async () => {
    if (!active) return;
    setHistoryLoading(true);
    try {
      const params = new URLSearchParams({ tenantId: active.tenantId, history: '1' });
      if (active.clientId != null) params.set('clientId', String(active.clientId));
      const res = await fetch(`/api/admin/av/brief?${params.toString()}`, { cache: 'no-store' });
      const data = await res.json();
      if (res.ok) setVersions(data.versions ?? []);
    } catch {
      /* non-fatal */
    } finally {
      setHistoryLoading(false);
    }
  };

  const restoreVersion = async (versionId: number) => {
    if (!active) return;
    if (!window.confirm('Restore this version? Your current brief is snapshotted first, so you can undo this too.')) return;
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch('/api/admin/av/brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: active.tenantId, clientId: active.clientId, action: 'restore', versionId })
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data?.error || 'Restore failed.');
      setMsg({ ok: true, text: 'Restored — and your previous version was saved as a new restore point.' });
      await loadBrief(active);
      await loadHistory();
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const ta =
    'w-full rounded-md bg-black/20 border border-white/10 px-3 py-2 text-sm ' +
    'text-white/90 placeholder-white/30 focus:outline-none focus:border-amber-400/50';

  return (
    <div className="space-y-6">
      {/* Scope picker */}
      <div className="flex flex-wrap gap-2">
        {scopes.map((s) => {
          const on = s.key === activeKey;
          return (
            <button
              key={s.key}
              onClick={() => setActiveKey(s.key)}
              className={
                'rounded-full px-3 py-1 text-xs border transition ' +
                (on
                  ? 'bg-amber-400/20 border-amber-400/60 text-amber-200'
                  : 'bg-white/5 border-white/10 text-white/60 hover:text-white/90')
              }
            >
              {s.kind === 'brand' ? '★ ' : ''}
              {s.label}
            </button>
          );
        })}
      </div>

      {/* Header line */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-white/70">
          Editing brief for <span className="font-semibold text-white/90">{brandName}</span>
          {active?.kind === 'brand' && <span className="ml-2 text-amber-300/70">(your house brand)</span>}
        </div>
        <span
          className={
            'text-[11px] rounded-full px-2 py-0.5 border ' +
            (grounded
              ? 'border-emerald-400/40 text-emerald-300 bg-emerald-400/10'
              : 'border-white/15 text-white/40')
          }
        >
          {grounded ? 'grounded' : 'no brief yet'}
        </span>
      </div>

      {loading ? (
        <div className="text-sm text-white/40">Loading brief…</div>
      ) : (
        <>
          {/* The 6 canonical questions */}
          <div className="space-y-4">
            {QUESTIONS.map((qq) => (
              <label key={qq.key} className="block">
                <span className="text-xs uppercase tracking-wide text-white/50">
                  <span className="text-amber-300/70">{qq.q}</span> · {qq.label}
                </span>
                <textarea
                  className={ta + ' mt-1'}
                  rows={2}
                  value={payload[qq.key] ?? ''}
                  placeholder={qq.placeholder}
                  onChange={(e) => setField(qq.key, e.target.value)}
                />
              </label>
            ))}
          </div>

          {/* Extras */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {EXTRAS.map((ex) => (
              <label key={ex.key} className="block">
                <span className="text-xs uppercase tracking-wide text-white/50">{ex.label}</span>
                <input
                  className={ta + ' mt-1'}
                  value={payload[ex.key] ?? ''}
                  placeholder={ex.placeholder}
                  onChange={(e) => setField(ex.key, e.target.value)}
                />
              </label>
            ))}
          </div>

          {/* How this brand uses PR — drives matching + default pitch voice. */}
          <div className="rounded-md border border-white/10 bg-black/20 p-3 space-y-3">
            <div className="text-xs uppercase tracking-wide text-amber-300/70">How this brand uses PR / news intel</div>
            <p className="text-[11px] text-white/45">
              Sets the default for matched opportunities. You can change it any time, and still
              override the voice on an individual pitch.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs uppercase tracking-wide text-white/50">Intel posture</span>
                <select
                  className={ta + ' mt-1'}
                  value={posture}
                  onChange={(e) => { setPosture(e.target.value); setDirty(true); setMsg(null); }}
                >
                  {POSTURE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value} className="bg-[#0c1322]">{o.label}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs uppercase tracking-wide text-white/50">Default PR voice</span>
                <select
                  className={ta + ' mt-1'}
                  value={voice}
                  onChange={(e) => { setVoice(e.target.value); setDirty(true); setMsg(null); }}
                >
                  {VOICE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value} className="bg-[#0c1322]">{o.label}</option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          {/* Save + inline feedback (kept next to the button on purpose) */}
          <div className="flex items-center gap-3">
            <button
              onClick={save}
              disabled={saving || !dirty}
              className={
                'rounded-md px-4 py-2 text-sm font-medium transition ' +
                (saving || !dirty
                  ? 'bg-white/10 text-white/40 cursor-not-allowed'
                  : 'bg-amber-400/90 text-black hover:bg-amber-300')
              }
            >
              {saving ? 'Saving…' : dirty ? 'Save brief' : 'Saved'}
            </button>
            {msg && (
              <span className={'text-xs ' + (msg.ok ? 'text-emerald-300' : 'text-rose-300')}>{msg.text}</span>
            )}
          </div>

          {/* The grounding block the prompts actually see — prompt visibility. */}
          <details className="rounded-md border border-white/10 bg-black/20">
            <summary className="cursor-pointer select-none px-3 py-2 text-xs text-white/60">
              What the AI prompts will see (the grounding block) — click to inspect
            </summary>
            <pre className="px-3 pb-3 text-[11px] leading-relaxed text-white/70 whitespace-pre-wrap break-words">
              {promptBlock || '(nothing yet — fill the brief above and save)'}
            </pre>
          </details>

          {/* Version history — restore points. Nothing is ever overwritten beyond recovery. */}
          <details
            className="rounded-md border border-white/10 bg-black/20"
            onToggle={(e) => { if ((e.target as HTMLDetailsElement).open) loadHistory(); }}
          >
            <summary className="cursor-pointer select-none px-3 py-2 text-xs text-white/60">
              Version history &amp; restore points — open to view
            </summary>
            <div className="px-3 pb-3 space-y-2">
              {historyLoading ? (
                <div className="text-[11px] text-white/40">Loading history…</div>
              ) : versions.length === 0 ? (
                <div className="text-[11px] text-white/40">No earlier versions yet. The first save here creates your first restore point.</div>
              ) : (
                versions.map((v) => (
                  <div key={v.id} className="flex items-center justify-between gap-3 rounded border border-white/10 px-3 py-2">
                    <div className="text-[11px] text-white/70">
                      <span className="text-white/90">{new Date(v.createdAt).toLocaleString()}</span>
                      <span className="ml-2 text-white/40">
                        {v.source === 'client_intake' ? 'client edit' : v.source === 'restore' ? 'restore' : 'you'}
                        {v.changedBy ? ` · ${v.changedBy}` : ''}
                      </span>
                    </div>
                    <button
                      onClick={() => restoreVersion(v.id)}
                      disabled={saving}
                      className="shrink-0 rounded border border-white/20 px-2.5 py-1 text-[11px] text-white/80 hover:text-white hover:border-white/40 disabled:opacity-50"
                    >
                      Restore
                    </button>
                  </div>
                ))
              )}
            </div>
          </details>
        </>
      )}
    </div>
  );
}
