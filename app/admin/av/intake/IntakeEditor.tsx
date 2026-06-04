'use client';

/**
 * IntakeEditor — the FULL operator-side client intake (every question, grouped).
 * This is the superset of the Creative Brief: it edits the SAME payload (so the
 * brief's strategic fields and the intake's richer fields coexist in one record),
 * via the existing /api/admin/av/brief endpoint, which merges over stored keys.
 *
 * val prefills a client's intake here, then sends the magic link. Whatever she
 * (or the client) enters is what "Extract intelligence" turns into the spine.
 */
import { useCallback, useEffect, useState } from 'react';
import { INTAKE_GROUPS, INTAKE_KEYS } from '@/lib/client/intake_fields';

interface Customer { key: string; label: string; kind: 'brand' | 'client'; tenantId: string; clientId: number | null }

const BRAND_FALLBACK: Customer[] = [
  { key: 'av:house', label: 'Atlantic & Vine', kind: 'brand', tenantId: 'av', clientId: null }
];

export function IntakeEditor({ customers, initialKey }: { customers: Customer[]; initialKey?: string }) {
  const scopes = customers.length ? customers : BRAND_FALLBACK;
  const defaultKey = (initialKey && scopes.some((s) => s.key === initialKey) ? initialKey : null) ?? scopes[0]?.key ?? 'av:house';
  const [activeKey, setActiveKey] = useState<string>(defaultKey);
  const active = scopes.find((s) => s.key === activeKey) ?? scopes[0];

  const [payload, setPayload] = useState<Record<string, string>>({});
  const [rawPayload, setRawPayload] = useState<Record<string, unknown>>({});
  const [brandName, setBrandName] = useState<string>(active?.label ?? '');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async (scope: Customer) => {
    setLoading(true); setMsg(null);
    try {
      const params = new URLSearchParams({ tenantId: scope.tenantId });
      if (scope.clientId != null) params.set('clientId', String(scope.clientId));
      const res = await fetch(`/api/admin/av/brief?${params.toString()}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Could not load this intake.');
      const src = (data.payload ?? {}) as Record<string, unknown>;
      const incoming: Record<string, string> = {};
      for (const k of INTAKE_KEYS) incoming[k] = typeof src[k] === 'string' ? (src[k] as string) : '';
      setPayload(incoming);
      setRawPayload(src);
      setBrandName(typeof data.brandName === 'string' ? data.brandName : scope.label);
      setDirty(false);
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (active) load(active); /* eslint-disable-next-line */ }, [activeKey]);

  const setField = (k: string, v: string) => { setPayload((p) => ({ ...p, [k]: v })); setDirty(true); setMsg(null); };

  const save = async () => {
    if (!active) return;
    setSaving(true); setMsg(null);
    try {
      const merged: Record<string, unknown> = { ...rawPayload, ...payload };
      const res = await fetch('/api/admin/av/brief', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: active.tenantId, clientId: active.clientId, payload: merged })
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data?.error || 'Save failed.');
      setMsg({ ok: true, text: 'Saved. Next: extract intelligence on the client page, then send their magic link.' });
      setDirty(false);
      setRawPayload(merged);
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const filled = INTAKE_KEYS.filter((k) => (payload[k] || '').trim()).length;
  const ta = 'w-full rounded-md bg-black/20 border border-white/10 px-3 py-2 text-sm text-white/90 placeholder-white/30 focus:outline-none focus:border-[#EBCB6B]/50';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {scopes.map((s) => {
          const on = s.key === activeKey;
          return (
            <button
              key={s.key}
              onClick={() => setActiveKey(s.key)}
              className={'rounded-full px-3 py-1 text-xs border transition ' + (on ? 'bg-[#EBCB6B]/20 border-[#EBCB6B]/60 text-[#EBCB6B]/95' : 'bg-white/5 border-white/10 text-white/60 hover:text-white/90')}
            >
              {s.kind === 'brand' ? '★ ' : ''}{s.label}
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between">
        <div className="text-sm text-white/70">Full intake for <span className="font-semibold text-white/90">{brandName}</span></div>
        <span className="text-[11px] rounded-full px-2 py-0.5 border border-white/15 text-white/50">{filled} of {INTAKE_KEYS.length} answered</span>
      </div>

      {loading ? (
        <div className="text-sm text-white/40">Loading intake…</div>
      ) : (
        <>
          {INTAKE_GROUPS.map((grp) => (
            <div key={grp.group} className="rounded-md border border-white/10 bg-black/20 p-4">
              <div className="text-xs uppercase tracking-wide text-[#EBCB6B]/75 mb-3">{grp.group}</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {grp.fields.map((f) => (
                  <label key={f.key} className={f.area ? 'block sm:col-span-2' : 'block'}>
                    <span className="text-[13px] text-white/80">{f.label}</span>
                    {f.hint && <span className="block text-[11px] text-white/40">{f.hint}</span>}
                    {f.area ? (
                      <textarea
                        className={ta + ' mt-1'}
                        rows={f.example && f.example.length > 80 ? 3 : 2}
                        placeholder={f.example ?? ''}
                        value={payload[f.key] ?? ''}
                        onChange={(e) => setField(f.key, e.target.value)}
                      />
                    ) : (
                      <input
                        className={ta + ' mt-1'}
                        placeholder={f.example ?? ''}
                        value={payload[f.key] ?? ''}
                        onChange={(e) => setField(f.key, e.target.value)}
                      />
                    )}
                    {f.why && (
                      <span className="block text-[10.5px] text-[#EBCB6B]/55 mt-1 italic">
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
              className={'rounded-md px-5 py-2.5 text-sm font-medium transition ' + (saving || !dirty ? 'bg-white/10 text-white/40 cursor-not-allowed' : 'border border-[#EBCB6B]/40 text-[#EBCB6B] hover:bg-[#EBCB6B]/10')}
            >
              {saving ? 'Saving…' : dirty ? 'Save intake' : 'Saved'}
            </button>
            {msg && <span className={'text-xs ' + (msg.ok ? 'text-emerald-300' : 'text-rose-300')}>{msg.text}</span>}
          </div>
        </>
      )}
    </div>
  );
}
