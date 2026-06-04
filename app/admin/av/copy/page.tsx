/**
 * /admin/av/copy — site copy editor (newsroom team, 2026-06-04)
 *
 * The general-purpose sibling of /admin/av/popups. Edit any client-facing
 * string, per global default / per client / per stage. Mobile-first; every
 * input is a ≥44px tap target; saves debounced (600ms) straight to site_copy.
 * Operator-gated by middleware (x-ah-user-role). No new design tokens —
 * functional operator styling only (conductor owns final CSS).
 */
'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type Key = { key: string; group: string; def: string; value: string };
type Client = { id: number; name: string };
const STAGES = ['', 'onboarding', 'intake_done', 'first_signal', 'active'];
const GROUP_ORDER = ['Newsroom', 'Channel', 'Dashboard', 'Leads', 'Watchlist', 'Press', 'Audit', 'Intake', 'Login', 'Footer', 'Other'];

function friendly(key: string): string {
  const parts = key.split('.');
  return parts.slice(1).join(' · ').replace(/\b\w/g, (c) => c.toUpperCase()) || key;
}

export default function CopyEditorPage() {
  const [clientId, setClientId] = useState(0);
  const [stage, setStage] = useState('');
  const [clients, setClients] = useState<Client[]>([]);
  const [keys, setKeys] = useState<Key[]>([]);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [showExport, setShowExport] = useState(false);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const load = useCallback(async () => {
    setStatus('Loading…');
    const r = await fetch(`/api/admin/av/copy?clientId=${clientId}&stage=${encodeURIComponent(stage)}`, { cache: 'no-store' });
    if (r.status === 403) { setStatus('Forbidden — owner/staff only.'); return; }
    const d = await r.json();
    setClients(d.clients || []);
    setKeys(d.keys || []);
    setStatus('');
  }, [clientId, stage]);

  useEffect(() => { load(); }, [load]);

  const onEdit = (key: string, value: string) => {
    setKeys((ks) => ks.map((k) => (k.key === key ? { ...k, value } : k)));
    clearTimeout(timers.current[key]);
    timers.current[key] = setTimeout(async () => {
      setStatus('Saving…');
      await fetch('/api/admin/av/copy', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value, clientId: clientId || undefined, stage: stage || undefined }),
      });
      setStatus('Saved ✓'); setTimeout(() => setStatus(''), 1200);
    }, 600);
  };

  const onReset = async (key: string) => {
    await fetch('/api/admin/av/copy', {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, clientId: clientId || undefined, stage: stage || undefined }),
    });
    setKeys((ks) => ks.map((k) => (k.key === key ? { ...k, value: '' } : k)));
    setStatus('Reset to fallback'); setTimeout(() => setStatus(''), 1200);
  };

  const filtered = useMemo(() => {
    const f = q.trim().toLowerCase();
    const list = !f ? keys : keys.filter((k) => k.key.toLowerCase().includes(f) || k.def.toLowerCase().includes(f) || (k.value || '').toLowerCase().includes(f));
    const byGroup: Record<string, Key[]> = {};
    for (const k of list) (byGroup[k.group] ||= []).push(k);
    return GROUP_ORDER.filter((g) => byGroup[g]?.length).map((g) => [g, byGroup[g]] as const);
  }, [keys, q]);

  const exportJson = useMemo(() => {
    const o: Record<string, string> = {};
    for (const k of keys) o[k.key] = k.value || k.def;
    return JSON.stringify(o, null, 2);
  }, [keys]);

  const ctxLabel = clientId ? (clients.find((c) => c.id === clientId)?.name || `client ${clientId}`) : 'All clients (global defaults)';

  return (
    <div style={{ minHeight: '100vh', background: '#0B1B2D', color: '#E7ECF3', fontFamily: 'Inter, system-ui, sans-serif' }}>
      {/* sticky header */}
      <div style={{ position: 'sticky', top: 0, zIndex: 10, background: 'rgba(11,27,45,.96)', backdropFilter: 'blur(8px)', borderBottom: '1px solid rgba(255,255,255,.1)', padding: '14px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Site copy</h1>
          <span style={{ fontSize: 12, color: '#9FB0C7' }}>editing: <b style={{ color: '#EBCB6B' }}>{ctxLabel}</b>{stage ? ` · stage: ${stage}` : ''}</span>
          <span style={{ marginLeft: 'auto', fontSize: 12, color: '#7ED3A1', minHeight: 16 }}>{status}</span>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <select value={clientId} onChange={(e) => setClientId(Number(e.target.value))} style={sel}>
            <option value={0}>All clients (global defaults)</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select value={stage} onChange={(e) => setStage(e.target.value)} style={sel}>
            <option value="">Any stage</option>
            {STAGES.filter(Boolean).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <button onClick={() => setShowExport((v) => !v)} style={btn}>Export JSON</button>
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search copy…"
          style={{ ...field, marginTop: 8, width: '100%' }} />
      </div>

      {showExport && (
        <div style={{ padding: '12px 16px' }}>
          <textarea readOnly value={exportJson} onFocus={(e) => e.currentTarget.select()}
            style={{ ...field, width: '100%', height: 160, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12 }} />
        </div>
      )}

      <div style={{ padding: '8px 16px 96px', maxWidth: 760, margin: '0 auto' }}>
        {filtered.map(([group, rows]) => (
          <section key={group} style={{ marginTop: 18 }}>
            <h2 style={{ fontSize: 11, letterSpacing: '.18em', textTransform: 'uppercase', color: '#EBCB6B', borderBottom: '1px solid rgba(255,255,255,.12)', paddingBottom: 6, marginBottom: 10 }}>{group}</h2>
            {rows.map((k) => {
              const overridden = !!k.value;
              const long = (k.value || k.def).length > 44;
              return (
                <div key={k.key} style={{ marginBottom: 14 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: '#C7D3E2', marginBottom: 4 }}>
                    <span style={{ fontWeight: 600 }}>{friendly(k.key)}</span>
                    <code style={{ fontSize: 10, color: '#6E829B' }}>{k.key}</code>
                    {overridden && <button onClick={() => onReset(k.key)} style={resetBtn}>reset ×</button>}
                  </label>
                  {long ? (
                    <textarea value={k.value} placeholder={k.def} onChange={(e) => onEdit(k.key, e.target.value)} style={{ ...field, width: '100%', minHeight: 64 }} />
                  ) : (
                    <input value={k.value} placeholder={k.def} onChange={(e) => onEdit(k.key, e.target.value)} style={{ ...field, width: '100%' }} />
                  )}
                </div>
              );
            })}
          </section>
        ))}
        {!filtered.length && <p style={{ color: '#9FB0C7', marginTop: 24 }}>No copy keys match “{q}”.</p>}
      </div>
    </div>
  );
}

const field: React.CSSProperties = { background: '#0E2236', color: '#E7ECF3', border: '1px solid rgba(255,255,255,.16)', borderRadius: 8, padding: '11px 12px', fontSize: 15, fontFamily: 'inherit', minHeight: 44 };
const sel: React.CSSProperties = { ...field, minWidth: 150 };
const btn: React.CSSProperties = { background: '#EBCB6B', color: '#0B1B2D', border: 0, borderRadius: 8, padding: '0 16px', fontWeight: 700, fontSize: 13, minHeight: 44, cursor: 'pointer' };
const resetBtn: React.CSSProperties = { marginLeft: 'auto', background: 'transparent', border: '1px solid rgba(255,255,255,.2)', color: '#9FB0C7', borderRadius: 6, padding: '3px 8px', fontSize: 11, cursor: 'pointer' };
