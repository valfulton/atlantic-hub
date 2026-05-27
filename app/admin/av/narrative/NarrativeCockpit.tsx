'use client';

/**
 * NarrativeCockpit -- author + steer narrative lines, grouped BY CUSTOMER.
 *
 * Customers (your brands + each client account) are collapsible sections; open
 * one to peek at that customer's lines and their progress. Per line you edit the
 * thesis + intelligence, move it through its lifecycle under a PER-CUSTOMER 2-4
 * active cap, capture engagement (manual now; "Pull from socials" stub later),
 * and see the commercials it has produced. Create a new line for any customer
 * from the header. Talks to /api/admin/campaigns/lanes and
 * /api/admin/campaigns/lines/[id]/{engagement,commercials}.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { StoryMap } from './StoryMap';
import { celebrateConversion } from '@/components/ConversionConfetti';

type LineState = 'candidate' | 'active' | 'reinforcing' | 'retiring';

interface Customer {
  key: string;
  label: string;
  kind: 'brand' | 'client';
  tenantId: string;
  clientId: number | null;
}

interface Line {
  id: number;
  ownerKey: string;
  tenantId: string;
  clientId: number | null;
  name: string;
  state: LineState;
  accent: string | null;
  thesis: string | null;
  audience: string | null;
  emotionalDriver: string | null;
  authorityAngle: string | null;
  seasonality: string | null;
  conversionSignal: string | null;
  proofPoints: string[];
  doSay: string[];
  dontSay: string[];
}

interface EngagementSummary {
  impressions: number; engagements: number; clicks: number; conversions: number;
  entryCount: number; engagementRate: number;
  byChannel: Array<{ channel: string; impressions: number; engagements: number; clicks: number; conversions: number }>;
  recent: Array<{ id: number; channel: string; impressions: number; engagements: number; clicks: number; conversions: number; source: string; createdAt: string }>;
}
interface Commercial { id: number; assetType: string; brandedStatus: string | null; campaignName: string | null; company: string | null; generationStatus: string | null; }
const GEN_STATUS_LABEL: Record<string, { label: string; fg: string }> = {
  running: { label: '⏳ Rendering…', fg: '#fcd34d' },
  queued: { label: '⏳ Queued…', fg: '#fcd34d' },
  succeeded: { label: '✓ Ready', fg: '#6ee7b7' },
  failed: { label: '✕ Failed', fg: '#fca5a5' }
};
interface LineFit {
  totalLeads: number;
  matchedCount: number;
  bands: { hot: number; warm: number; cool: number };
  top: Array<{ leadId: number; company: string; band: string | null; score: number | null; sharedTerms: string[] }>;
  needs: {
    painThemes: Array<{ label: string; count: number }>;
    industries: Array<{ label: string; count: number }>;
    keywords: Array<{ label: string; count: number }>;
  };
}

const STATE_TONE: Record<LineState, { label: string; bg: string; fg: string }> = {
  active: { label: 'Active', bg: 'rgba(16,185,129,0.18)', fg: '#6ee7b7' },
  reinforcing: { label: 'Reinforcing', bg: 'rgba(59,130,246,0.18)', fg: '#93c5fd' },
  candidate: { label: 'Candidate', bg: 'rgba(148,163,184,0.16)', fg: '#cbd5e1' },
  retiring: { label: 'Retiring', bg: 'rgba(245,158,11,0.16)', fg: '#fcd34d' }
};
const CHANNELS = ['linkedin', 'facebook', 'instagram', 'blog', 'newsroom', 'email', 'other'];

// A scored thesis suggestion + the color language that makes the best one pop.
type ThesisBand = 'strong' | 'good' | 'light' | 'loose';
interface ThesisIdea { thesis: string; why: string; fitScore: number; matchedTerms: string[]; band: ThesisBand; }
const BAND_STYLE: Record<ThesisBand, { border: string; bg: string; fg: string; label: string; spark: boolean }> = {
  strong: { border: 'rgba(110,231,183,0.6)', bg: 'rgba(16,185,129,0.10)', fg: '#6ee7b7', label: 'Strong fit', spark: true },
  good: { border: 'rgba(147,197,253,0.5)', bg: 'rgba(59,130,246,0.10)', fg: '#93c5fd', label: 'Good fit', spark: false },
  light: { border: 'rgba(203,213,225,0.4)', bg: 'rgba(148,163,184,0.07)', fg: '#cbd5e1', label: 'Light fit', spark: false },
  loose: { border: 'rgba(252,211,77,0.45)', bg: 'rgba(245,158,11,0.07)', fg: '#fcd34d', label: 'Loose — tighten toward your leads', spark: false }
};

const card: React.CSSProperties = { border: '1px solid rgba(148,163,184,0.16)', borderRadius: 14, background: 'rgba(15,23,42,0.5)', padding: 16, marginBottom: 14 };
const inputStyle: React.CSSProperties = { width: '100%', background: 'rgba(2,6,23,0.6)', border: '1px solid rgba(148,163,184,0.2)', borderRadius: 8, padding: '7px 10px', color: '#e2e8f0', fontSize: 13 };
const labelStyle: React.CSSProperties = { display: 'block', fontSize: 11, color: '#94a3b8', margin: '8px 0 3px' };
const btnPrimary: React.CSSProperties = { background: 'linear-gradient(120deg,#FF9C5B,#FFC73D)', color: '#1a1207', border: 'none', borderRadius: 8, padding: '7px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' };
const btnGhost: React.CSSProperties = { background: 'rgba(148,163,184,0.12)', color: '#cbd5e1', border: '1px solid rgba(148,163,184,0.2)', borderRadius: 8, padding: '6px 12px', fontSize: 12, cursor: 'pointer' };

const linesToText = (a: string[]) => a.join('\n');
const textToLines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);

export function NarrativeCockpit({ customers, initialLines, maxActive }: {
  customers: Customer[];
  initialLines: Line[];
  maxActive: number;
}) {
  const [lines, setLines] = useState<Line[]>(initialLines);
  const [openCustomer, setOpenCustomer] = useState<string | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Record<number, Line>>({});
  const [saving, setSaving] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Per-line save feedback (rendered right next to each line's Save button, so
  // it's never off-screen) + a dirty flag so it's obvious a click registered.
  const [saveMsg, setSaveMsg] = useState<Record<number, { ok: boolean; text: string } | null>>({});
  const [dirty, setDirty] = useState<Record<number, boolean>>({});

  const [eng, setEng] = useState<Record<number, EngagementSummary>>({});
  const [commercials, setCommercials] = useState<Record<number, Commercial[]>>({});
  const [fit, setFit] = useState<Record<number, LineFit>>({});
  const [entry, setEntry] = useState<{ channels: string[]; impressions: string; engagements: string; clicks: string; conversions: string; note: string }>({ channels: ['linkedin'], impressions: '', engagements: '', clicks: '', conversions: '', note: '' });
  const [pullMsg, setPullMsg] = useState<string | null>(null);

  // Editable commercial-prompt draft per line (auto-filled from the line; no generation).
  const [promptDraft, setPromptDraft] = useState<Record<number, { assetType: 'image' | 'video'; duration: string; text: string; loading: boolean }>>({});
  const draftCommercialPrompt = useCallback(async (id: number, assetType: 'image' | 'video', duration: string) => {
    setPromptDraft((p) => ({ ...p, [id]: { assetType, duration, text: p[id]?.text ?? '', loading: true } }));
    try {
      const res = await fetch(`/api/admin/campaigns/lines/${id}/commercial/preview`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ assetType, durationSeconds: assetType === 'video' ? (Number(duration) || 6) : undefined })
      });
      const j = await res.json();
      setPromptDraft((p) => ({ ...p, [id]: { assetType, duration, text: res.ok ? (j.prompt ?? '') : (j.error || 'Could not build prompt'), loading: false } }));
    } catch {
      setPromptDraft((p) => ({ ...p, [id]: { assetType, duration, text: 'Could not build prompt', loading: false } }));
    }
  }, []);
  const setPromptText = useCallback((id: number, text: string) =>
    setPromptDraft((p) => ({ ...p, [id]: { assetType: p[id]?.assetType ?? 'image', duration: p[id]?.duration ?? '6', text, loading: false } })), []);

  const loadLineData = useCallback(async (id: number) => {
    try {
      const [e, c, f] = await Promise.all([
        fetch(`/api/admin/campaigns/lines/${id}/engagement`, { cache: 'no-store' }).then((r) => r.json()),
        fetch(`/api/admin/campaigns/lines/${id}/commercials`, { cache: 'no-store' }).then((r) => r.json()),
        fetch(`/api/admin/campaigns/lines/${id}/fit`, { cache: 'no-store' }).then((r) => r.json())
      ]);
      if (e?.summary) setEng((m) => ({ ...m, [id]: e.summary }));
      if (c?.commercials) setCommercials((m) => ({ ...m, [id]: c.commercials }));
      if (f?.fit) setFit((m) => ({ ...m, [id]: f.fit }));
    } catch { /* ignore */ }
  }, []);

  const [genStatus, setGenStatus] = useState<Record<number, { loading: boolean; msg: string | null }>>({});
  const generateCommercial = useCallback(async (id: number) => {
    const pd = promptDraft[id];
    if (!pd?.text?.trim()) return;
    setGenStatus((s) => ({ ...s, [id]: { loading: true, msg: null } }));
    try {
      const res = await fetch(`/api/admin/campaigns/lines/${id}/commercial/generate`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ assetType: pd.assetType, prompt: pd.text, durationSeconds: pd.assetType === 'video' ? (Number(pd.duration) || 6) : undefined })
      });
      const j = await res.json();
      if (res.ok) {
        const isVideo = j.asset?.assetType === 'video';
        setGenStatus((s) => ({ ...s, [id]: { loading: false, msg: isVideo ? 'Video started — it will appear below once rendering finishes (refresh in a bit).' : 'Image generated — see below.' } }));
        loadLineData(id);
      } else {
        setGenStatus((s) => ({ ...s, [id]: { loading: false, msg: j.detail || j.error || 'Generation failed.' } }));
      }
    } catch {
      setGenStatus((s) => ({ ...s, [id]: { loading: false, msg: 'Generation failed.' } }));
    }
  }, [promptDraft, loadLineData]);

  // AI thesis suggestions — two-step so the operator sees + edits the prompt
  // BEFORE any tokens are spent, then gets fewer, fit-SCORED choices back.
  const [thesisPrompt, setThesisPrompt] = useState<Record<number, { text: string; loading: boolean; totalLeads?: number }>>({});
  const [thesisIdeas, setThesisIdeas] = useState<Record<number, { loading: boolean; ran: boolean; items: ThesisIdea[] }>>({});

  // Step 1 — fetch the editable prompt (NO LLM cost).
  const draftThesisPrompt = useCallback(async (id: number) => {
    setThesisPrompt((p) => ({ ...p, [id]: { text: p[id]?.text ?? '', loading: true, totalLeads: p[id]?.totalLeads } }));
    try {
      const res = await fetch(`/api/admin/campaigns/lines/${id}/suggest-thesis/preview`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      const j = await res.json();
      setThesisPrompt((p) => ({ ...p, [id]: { text: res.ok ? (j.prompt ?? '') : (j.error || 'Could not build prompt'), loading: false, totalLeads: j.totalLeads } }));
    } catch {
      setThesisPrompt((p) => ({ ...p, [id]: { text: 'Could not build prompt', loading: false } }));
    }
  }, []);
  const setThesisPromptText = useCallback((id: number, text: string) =>
    setThesisPrompt((p) => ({ ...p, [id]: { text, loading: false, totalLeads: p[id]?.totalLeads } })), []);

  // Step 2 — send the (possibly edited) prompt; get back fit-scored ideas.
  const generateThesisIdeas = useCallback(async (id: number) => {
    const prompt = thesisPrompt[id]?.text?.trim();
    setThesisIdeas((s) => ({ ...s, [id]: { loading: true, ran: true, items: s[id]?.items ?? [] } }));
    try {
      const res = await fetch(`/api/admin/campaigns/lines/${id}/suggest-thesis`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(prompt ? { prompt } : {})
      });
      const j = await res.json();
      setThesisIdeas((s) => ({ ...s, [id]: { loading: false, ran: true, items: res.ok ? (j.suggestions ?? []) : [] } }));
    } catch {
      setThesisIdeas((s) => ({ ...s, [id]: { loading: false, ran: true, items: [] } }));
    }
  }, [thesisPrompt]);

  const [newCustomerKey, setNewCustomerKey] = useState(customers[0]?.key ?? 'av:house');
  const [newName, setNewName] = useState('');
  const [newThesis, setNewThesis] = useState('');
  const [adding, setAdding] = useState(false);

  const toggleLine = useCallback((l: Line) => {
    setNotice(null); setPullMsg(null);
    if (openId === l.id) { setOpenId(null); return; }
    setOpenId(l.id);
    setDraft((d) => ({ ...d, [l.id]: { ...l } }));
    // Opening a fresh copy means no unsaved changes / stale save message yet.
    setDirty((m) => ({ ...m, [l.id]: false }));
    setSaveMsg((m) => ({ ...m, [l.id]: null }));
    if (!eng[l.id]) loadLineData(l.id);
  }, [openId, eng, loadLineData]);

  // Update a field in the draft AND flag the line dirty so the Save button lights
  // up — this is the visible proof that clicking a suggestion chip did something.
  // Defends against a missing draft[id] by seeding from the known line.
  const patchField = (id: number, key: keyof Line, value: unknown) => {
    setDraft((d) => {
      const base = d[id] ?? lines.find((l) => l.id === id);
      if (!base) return d;
      return { ...d, [id]: { ...base, [key]: value } };
    });
    setDirty((m) => (m[id] ? m : { ...m, [id]: true }));
    setSaveMsg((m) => (m[id] ? { ...m, [id]: null } : m));
  };

  // `override` lets a caller (e.g. "Use this thesis") persist a field immediately
  // without waiting for setDraft to flush — no save-after-setState race.
  const saveLine = useCallback(async (id: number, override?: Partial<Line>) => {
    const base = draft[id] ?? lines.find((l) => l.id === id);
    if (!base) return;
    const d: Line = override ? { ...base, ...override } : base;
    setSaving(id);
    setSaveMsg((m) => ({ ...m, [id]: null }));
    try {
      const res = await fetch('/api/admin/campaigns/lanes', {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id, name: d.name, thesis: d.thesis, audience: d.audience, emotionalDriver: d.emotionalDriver,
          authorityAngle: d.authorityAngle, seasonality: d.seasonality, conversionSignal: d.conversionSignal,
          proofPoints: d.proofPoints, doSay: d.doSay, dontSay: d.dontSay
        })
      });
      let j: { error?: string } = {};
      try { j = await res.json(); } catch { /* non-JSON response */ }
      if (!res.ok) {
        setSaveMsg((m) => ({ ...m, [id]: { ok: false, text: j.error || `Save failed (${res.status}). Try again.` } }));
        return;
      }
      setLines((ls) => ls.map((l) => (l.id === id ? { ...d } : l)));
      setDraft((dd) => ({ ...dd, [id]: { ...d } })); // keep the open editor in sync with what saved
      setDirty((m) => ({ ...m, [id]: false }));
      setSaveMsg((m) => ({ ...m, [id]: { ok: true, text: 'Saved ✓' } }));
    } catch {
      // Network/throw path — never leave the user staring at nothing.
      setSaveMsg((m) => ({ ...m, [id]: { ok: false, text: 'Could not reach the server. Check your connection and retry.' } }));
    } finally {
      setSaving(null);
    }
  }, [draft, lines]);

  const changeState = useCallback(async (id: number, state: LineState) => {
    setSaveMsg((m) => ({ ...m, [id]: null }));
    try {
      const res = await fetch('/api/admin/campaigns/lanes', {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, state })
      });
      let j: { error?: string } = {};
      try { j = await res.json(); } catch { /* non-JSON response */ }
      if (!res.ok) {
        setSaveMsg((m) => ({ ...m, [id]: { ok: false, text: j.error || 'Could not change state.' } }));
        return;
      }
      setLines((ls) => ls.map((l) => (l.id === id ? { ...l, state } : l)));
      setDraft((d) => (d[id] ? { ...d, [id]: { ...d[id], state } } : d));
      // Going live is the win — celebrate it so it's unmistakable the line is active.
      if (state === 'active') {
        celebrateConversion(lines.find((l) => l.id === id)?.name);
        setSaveMsg((m) => ({ ...m, [id]: { ok: true, text: '🎉 Live — now steering content' } }));
      } else {
        setSaveMsg((m) => ({ ...m, [id]: { ok: true, text: `Moved to ${state}.` } }));
      }
    } catch {
      setSaveMsg((m) => ({ ...m, [id]: { ok: false, text: 'Could not reach the server. Check your connection and retry.' } }));
    }
  }, [lines]);

  const submitEngagement = useCallback(async (id: number) => {
    // Records one reading per ticked channel (so "check all" logs the same
    // numbers across every channel and the by-channel breakdown stays correct).
    const channels = entry.channels.length ? entry.channels : ['other'];
    let lastSummary: EngagementSummary | null = null;
    for (const channel of channels) {
      const res = await fetch(`/api/admin/campaigns/lines/${id}/engagement`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mode: 'manual', channel,
          impressions: Number(entry.impressions) || 0, engagements: Number(entry.engagements) || 0,
          clicks: Number(entry.clicks) || 0, conversions: Number(entry.conversions) || 0, note: entry.note || null
        })
      });
      const j = await res.json();
      if (res.ok && j.summary) lastSummary = j.summary;
    }
    if (lastSummary) {
      setEng((m) => ({ ...m, [id]: lastSummary as EngagementSummary }));
      setEntry({ channels: ['linkedin'], impressions: '', engagements: '', clicks: '', conversions: '', note: '' });
    }
  }, [entry]);

  const pullSocials = useCallback(async (id: number) => {
    setPullMsg(null);
    const res = await fetch(`/api/admin/campaigns/lines/${id}/engagement`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'pull' })
    });
    const j = await res.json();
    setPullMsg(j.message || (j.ok ? `Pulled ${j.pulled} readings.` : 'Not available yet.'));
    if (j.ok) loadLineData(id);
  }, [loadLineData]);

  const addLine = useCallback(async () => {
    if (!newName.trim()) return;
    const cust = customers.find((c) => c.key === newCustomerKey) ?? customers[0];
    if (!cust) return;
    setAdding(true); setNotice(null);
    try {
      const res = await fetch('/api/admin/campaigns/lanes', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), thesis: newThesis.trim() || null, tenant: cust.tenantId, clientId: cust.clientId })
      });
      const j = await res.json();
      if (res.ok && j.id) {
        setLines((ls) => [
          { id: j.id, ownerKey: cust.key, tenantId: cust.tenantId, clientId: cust.clientId, name: newName.trim(), state: 'candidate', accent: null, thesis: newThesis.trim() || null, audience: null, emotionalDriver: null, authorityAngle: null, seasonality: null, conversionSignal: null, proofPoints: [], doSay: [], dontSay: [] },
          ...ls
        ]);
        setNewName(''); setNewThesis('');
        setOpenCustomer(cust.key);
      } else {
        setNotice(j.error || 'Could not add line.');
      }
    } finally { setAdding(false); }
  }, [newName, newThesis, newCustomerKey, customers]);

  const linesFor = (key: string) => lines.filter((l) => l.ownerKey === key);
  const activeCountFor = (key: string) => linesFor(key).filter((l) => l.state === 'active' || l.state === 'reinforcing').length;

  const editorProps = { openId, toggleLine, draft, patchField, saveLine, saving, saveMsg, dirty, changeState, eng, commercials, fit, entry, setEntry, submitEngagement, pullSocials, pullMsg, promptDraft, draftCommercialPrompt, setPromptText, genStatus, generateCommercial, thesisIdeas, thesisPrompt, draftThesisPrompt, setThesisPromptText, generateThesisIdeas };

  return (
    <div>
      {/* Gentle "win" glow for strong-fit suggestions. */}
      <style>{`@keyframes avSpark { 0%,100% { box-shadow: 0 0 0 0 rgba(110,231,183,0); } 50% { box-shadow: 0 0 16px 1px rgba(110,231,183,0.35); } }`}</style>
      {/* new line */}
      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0', marginBottom: 8 }}>New narrative line</div>
        <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 8 }}>
          <div>
            <label style={labelStyle}>Customer</label>
            <select style={inputStyle} value={newCustomerKey} onChange={(e) => setNewCustomerKey(e.target.value)}>
              <optgroup label="Your brands">
                {customers.filter((c) => c.kind === 'brand').map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </optgroup>
              {customers.some((c) => c.kind === 'client') && (
                <optgroup label="Client accounts">
                  {customers.filter((c) => c.kind === 'client').map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                </optgroup>
              )}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Name</label>
            <input style={inputStyle} placeholder="e.g. Executive recovery retreats" value={newName} onChange={(e) => setNewName(e.target.value)} />
          </div>
        </div>
        <label style={labelStyle}>Thesis (optional now)</label>
        <textarea style={{ ...inputStyle, minHeight: 46 }} placeholder="The market thesis in one sentence" value={newThesis} onChange={(e) => setNewThesis(e.target.value)} />
        <button onClick={addLine} disabled={adding || !newName.trim()} style={{ marginTop: 8, ...btnPrimary, opacity: adding || !newName.trim() ? 0.5 : 1 }}>
          {adding ? 'Adding…' : 'Add as candidate'}
        </button>
        <span style={{ fontSize: 11, color: '#64748b', marginLeft: 10 }}>New lines start as candidates — promote when ready.</span>
      </div>

      {notice && <div style={{ ...card, borderColor: 'rgba(96,165,250,0.4)', color: '#bfdbfe', fontSize: 13 }}>{notice}</div>}

      {/* customers */}
      {customers.map((c) => {
        const own = linesFor(c.key);
        const activeN = activeCountFor(c.key);
        const open = openCustomer === c.key;
        return (
          <div key={c.key} style={card}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }} onClick={() => setOpenCustomer(open ? null : c.key)}>
              <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: c.kind === 'brand' ? 'rgba(255,156,91,0.18)' : 'rgba(148,163,184,0.16)', color: c.kind === 'brand' ? '#ffb27a' : '#cbd5e1', textTransform: 'uppercase', letterSpacing: 0.5 }}>{c.kind}</span>
              <span style={{ fontSize: 16, fontWeight: 700, color: '#f1f5f9' }}>{c.label}</span>
              <span style={{ fontSize: 12, color: activeN >= maxActive ? '#fcd34d' : '#6ee7b7' }}>{activeN}/{maxActive} active</span>
              <span style={{ fontSize: 12, color: '#64748b' }}>· {own.length} line{own.length === 1 ? '' : 's'}</span>
              <span style={{ marginLeft: 'auto', color: '#64748b', fontSize: 18 }}>{open ? '−' : '+'}</span>
            </div>
            {open && (
              <div style={{ marginTop: 12 }}>
                {own.length === 0 && <div style={{ fontSize: 12, color: '#64748b' }}>No lines yet. Use the form above (pick {c.label}) to add one.</div>}
                <StateGroup title="Steering content now" lines={own.filter((l) => l.state === 'active' || l.state === 'reinforcing')} {...editorProps} />
                <StateGroup title="Candidates (parking lot)" lines={own.filter((l) => l.state === 'candidate')} {...editorProps} />
                <StateGroup title="Retiring" lines={own.filter((l) => l.state === 'retiring')} {...editorProps} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

interface EditorProps {
  openId: number | null;
  toggleLine: (l: Line) => void;
  draft: Record<number, Line>;
  patchField: (id: number, key: keyof Line, value: unknown) => void;
  saveLine: (id: number, override?: Partial<Line>) => void;
  saving: number | null;
  saveMsg: Record<number, { ok: boolean; text: string } | null>;
  dirty: Record<number, boolean>;
  changeState: (id: number, s: LineState) => void;
  eng: Record<number, EngagementSummary>;
  commercials: Record<number, Commercial[]>;
  fit: Record<number, LineFit>;
  entry: { channels: string[]; impressions: string; engagements: string; clicks: string; conversions: string; note: string };
  setEntry: (e: EditorProps['entry']) => void;
  submitEngagement: (id: number) => void;
  pullSocials: (id: number) => void;
  pullMsg: string | null;
  promptDraft: Record<number, { assetType: 'image' | 'video'; duration: string; text: string; loading: boolean }>;
  draftCommercialPrompt: (id: number, assetType: 'image' | 'video', duration: string) => void;
  setPromptText: (id: number, text: string) => void;
  genStatus: Record<number, { loading: boolean; msg: string | null }>;
  generateCommercial: (id: number) => void;
  thesisIdeas: Record<number, { loading: boolean; ran: boolean; items: ThesisIdea[] }>;
  thesisPrompt: Record<number, { text: string; loading: boolean; totalLeads?: number }>;
  draftThesisPrompt: (id: number) => void;
  setThesisPromptText: (id: number, text: string) => void;
  generateThesisIdeas: (id: number) => void;
}

function StateGroup({ title, lines, ...props }: EditorProps & { title: string; lines: Line[] }) {
  if (lines.length === 0) return null;
  const { openId, toggleLine } = props;
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, color: '#64748b', marginBottom: 6 }}>{title}</div>
      {lines.map((l) => {
        const tone = STATE_TONE[l.state];
        const open = openId === l.id;
        // The live (active/reinforcing) story is the brightest thing on the page —
        // green-glow border + tinted background so the chosen thesis dominates the
        // candidates/suggestions around it.
        const isLive = l.state === 'active' || l.state === 'reinforcing';
        return (
          <div key={l.id} style={{ border: `1px solid ${isLive ? 'rgba(16,185,129,0.55)' : 'rgba(148,163,184,0.14)'}`, borderRadius: 12, background: isLive ? 'rgba(16,185,129,0.09)' : 'rgba(2,6,23,0.35)', boxShadow: isLive ? '0 0 20px rgba(16,185,129,0.18)' : undefined, padding: 12, marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }} onClick={() => toggleLine(l)}>
              <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 9px', borderRadius: 999, background: tone.bg, color: tone.fg }}>{tone.label}</span>
              <span style={{ fontSize: 14, fontWeight: 600, color: '#f1f5f9' }}>{l.name}</span>
              <span style={{ marginLeft: 'auto', color: '#64748b', fontSize: 18 }}>{open ? '−' : '+'}</span>
            </div>
            {!open && l.thesis && <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 6 }}>{l.thesis}</div>}
            {open && <LineEditor line={l} {...props} />}
          </div>
        );
      })}
    </div>
  );
}

/** A collapsible sub-section (native <details>) so the open line isn't a wall.
 *  The summary shows a one-line hint so you get the signal without expanding. */
function Collapsible({ title, hint, defaultOpen = false, children }: { title: string; hint?: string; defaultOpen?: boolean; children: ReactNode }) {
  return (
    <details open={defaultOpen} style={{ marginTop: 14, borderTop: '1px solid rgba(148,163,184,0.12)', paddingTop: 12 }}>
      <summary style={{ cursor: 'pointer', listStyle: 'none', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0' }}>{title}</span>
        {hint && <span style={{ fontSize: 11, color: '#64748b' }}>{hint}</span>}
        <span style={{ marginLeft: 'auto', fontSize: 11, color: '#475569' }}>expand</span>
      </summary>
      <div style={{ marginTop: 10 }}>{children}</div>
    </details>
  );
}

function LineEditor({ line, draft, patchField, saveLine, saving, saveMsg, dirty, changeState, eng, commercials, fit, entry, setEntry, submitEngagement, pullSocials, pullMsg, promptDraft, draftCommercialPrompt, setPromptText, genStatus, generateCommercial, thesisIdeas, thesisPrompt, draftThesisPrompt, setThesisPromptText, generateThesisIdeas }: EditorProps & { line: Line }) {
  const d = draft[line.id] ?? line;
  const id = line.id;
  const summary = eng[id];
  const comms = commercials[id] ?? [];
  const lf = fit[id];
  const pd = promptDraft[id];
  const gen = genStatus[id];
  const ideas = thesisIdeas[id];
  const tp = thesisPrompt[id];
  const sm = saveMsg[id];
  const isDirty = !!dirty[id];

  // Plain input with the example as a faint placeholder — the old per-field
  // "Use:" chips showed the same generic suggestion on every line (noise); the
  // line-specific smart suggestions live in "Your leads" + the thesis suggester.
  const field = (label: string, key: keyof Line, example: string) => (
    <div>
      <label style={labelStyle}>{label}</label>
      <input style={inputStyle} placeholder={example} value={(d[key] as string) ?? ''} onChange={(e) => patchField(id, key, e.target.value)} aria-label={label} />
    </div>
  );
  const listField = (label: string, key: 'proofPoints' | 'doSay' | 'dontSay', placeholder: string) => (
    <div>
      <label style={labelStyle}>{label} <span style={{ color: '#475569' }}>(one per line)</span></label>
      <textarea style={{ ...inputStyle, minHeight: 56 }} placeholder={placeholder} value={linesToText(d[key] as string[])} onChange={(e) => patchField(id, key, textToLines(e.target.value))} />
    </div>
  );

  return (
    <div style={{ marginTop: 12, borderTop: '1px solid rgba(148,163,184,0.12)', paddingTop: 12 }}>
      {(line.state === 'active' || line.state === 'reinforcing') && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, padding: '8px 12px', borderRadius: 10, border: '1px solid rgba(16,185,129,0.45)', background: 'rgba(16,185,129,0.12)', color: '#6ee7b7', fontSize: 12, fontWeight: 600 }}>
          <span style={{ width: 8, height: 8, borderRadius: 999, background: '#6ee7b7', boxShadow: '0 0 0 3px rgba(16,185,129,0.25)' }} />
          {line.state === 'active'
            ? 'Live — this is your active story, steering content now.'
            : 'Reinforcing — this story is being doubled down on.'}
        </div>
      )}
      <div>
        <label style={labelStyle}>Thesis — the believable market thesis, one sentence</label>
        <textarea
          id={`thesis-${id}`}
          style={{ ...inputStyle, minHeight: 52 }}
          placeholder="e.g. Luxury retreats are becoming strategic executive performance assets."
          value={d.thesis ?? ''}
          onChange={(e) => patchField(id, 'thesis', e.target.value)}
          aria-label="Thesis"
        />
        <div style={{ marginTop: 6 }}>
          {/* Step 1 — see the prompt before spending anything. */}
          {!tp && (
            <button type="button" onClick={() => draftThesisPrompt(id)} style={btnGhost} title="Builds the exact prompt from this customer's lead needs — nothing is sent to the AI yet">
              ✦ Draft a suggestion prompt from my leads
            </button>
          )}
          {tp?.loading && !tp.text && <span style={{ fontSize: 12, color: '#94a3b8' }}>Building your prompt…</span>}
          {tp && tp.text !== undefined && tp.text !== '' && (
            <div>
              <label style={{ ...labelStyle, marginTop: 0 }}>
                Prompt the AI will read <span style={{ color: '#475569' }}>(edit it — nothing sends until you click Generate)</span>
              </label>
              <textarea
                style={{ ...inputStyle, minHeight: 130, fontFamily: 'ui-monospace, monospace', fontSize: 12 }}
                value={tp.text}
                onChange={(e) => setThesisPromptText(id, e.target.value)}
              />
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
                <button type="button" onClick={() => generateThesisIdeas(id)} disabled={ideas?.loading || !tp.text.trim()} style={{ ...btnPrimary, opacity: ideas?.loading || !tp.text.trim() ? 0.5 : 1 }}>
                  {ideas?.loading ? 'Generating…' : '✦ Generate 2 ideas'}
                </button>
                <button type="button" onClick={() => draftThesisPrompt(id)} style={btnGhost}>{tp.loading ? 'Refreshing…' : 'Re-draft from leads'}</button>
                <span style={{ fontSize: 11, color: '#64748b' }}>One small AI call.{tp.totalLeads != null ? ` Grounded in ${tp.totalLeads} leads.` : ''}</span>
              </div>
            </div>
          )}
        </div>
        {ideas?.ran && !ideas.loading && ideas.items.length === 0 && (
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 6 }}>No suggestions came back — add a few leads or some line detail and try again.</div>
        )}
        {ideas && ideas.items.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 6 }}>
              Best fit first. <strong style={{ color: '#e2e8f0' }}>Use &amp; activate</strong> makes that suggestion your live story in one click — fills the Thesis box, saves, and goes active (you can still edit + re-save after).
            </div>
            <div style={{ display: 'grid', gap: 8 }}>
              {ideas.items.map((s, i) => {
                const bs = BAND_STYLE[s.band];
                return (
                  <div key={i} style={{ border: `1px solid ${bs.border}`, background: bs.bg, borderRadius: 10, padding: 11, animation: bs.spark && line.state !== 'active' && line.state !== 'reinforcing' ? 'avSpark 2.4s ease-in-out infinite' : undefined }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: bs.fg }}>{bs.spark ? '✨ ' : ''}{bs.label}</span>
                      {s.matchedTerms.length > 0 && (
                        <span style={{ fontSize: 11, color: '#94a3b8' }}>matches your leads on: {s.matchedTerms.join(', ')}</span>
                      )}
                    </div>
                    <div style={{ fontSize: 13, color: '#e2e8f0' }}>{s.thesis}</div>
                    {s.why && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 3 }}>{s.why}</div>}
                    <button
                      type="button"
                      onClick={async () => {
                        // One click: fill the Thesis box, save it, and make it the live
                        // story. (override avoids a setState race.) Then scroll up so you
                        // see it landed; activation pops confetti + the Live banner.
                        patchField(id, 'thesis', s.thesis);
                        await saveLine(id, { thesis: s.thesis });
                        await changeState(id, 'active');
                        const el = typeof document !== 'undefined' ? document.getElementById(`thesis-${id}`) : null;
                        if (el) {
                          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                          (el as HTMLTextAreaElement).focus();
                        }
                      }}
                      style={{ ...btnPrimary, marginTop: 8, fontSize: 11, padding: '5px 12px' }}
                    >
                      ✦ Use &amp; activate this story
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
      {lf && lf.totalLeads > 0 && (
        <div style={{ fontSize: 12, color: '#cbd5e1', margin: '10px 0 2px', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span>This story reaches <strong style={{ color: lf.matchedCount > 0 ? '#6ee7b7' : '#94a3b8' }}>{lf.matchedCount}</strong> of {lf.totalLeads} of your leads</span>
          {lf.matchedCount > 0 && <span style={{ color: '#94a3b8' }}>· {lf.bands.hot} hot · {lf.bands.warm} warm · {lf.bands.cool} cool</span>}
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {field('Audience', 'audience', 'burned-out leadership teams')}
        {field('Emotional driver', 'emotionalDriver', 'burnout + reconnection')}
        {field('Authority angle', 'authorityAngle', 'performance psychology')}
        {field('Seasonality / timing', 'seasonality', 'Q2–Q3 planning season')}
      </div>
      <div>
        <label style={labelStyle}>Conversion signal — the moment that means it&apos;s working</label>
        <input style={inputStyle} placeholder="e.g. retreat inquiry after commercial view" value={d.conversionSignal ?? ''} onChange={(e) => patchField(id, 'conversionSignal', e.target.value)} aria-label="Conversion signal" />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
        {listField('Proof points', 'proofPoints', 'stat / quote / result')}
        {listField('Say (on-thesis)', 'doSay', 'phrases that fit')}
        {listField("Don't say (off-thesis)", 'dontSay', 'phrases to avoid')}
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap', alignItems: 'center', position: 'sticky', bottom: 0, zIndex: 5, background: 'rgba(2,6,23,0.94)', backdropFilter: 'blur(6px)', borderTop: '1px solid rgba(148,163,184,0.18)', padding: '10px 4px', margin: '12px -4px 0', borderRadius: '0 0 12px 12px' }}>
        <button onClick={() => saveLine(id)} disabled={saving === id} style={{ ...btnPrimary, opacity: saving === id ? 0.5 : 1 }}>{saving === id ? 'Saving…' : isDirty ? 'Save line •' : 'Save line'}</button>
        {line.state !== 'active' && <button onClick={() => changeState(id, 'active')} style={btnGhost}>Activate</button>}
        {line.state === 'active' && <button onClick={() => changeState(id, 'reinforcing')} style={btnGhost}>Mark reinforcing</button>}
        {line.state !== 'candidate' && <button onClick={() => changeState(id, 'candidate')} style={btnGhost}>Back to candidate</button>}
        {line.state !== 'retiring' && <button onClick={() => changeState(id, 'retiring')} style={btnGhost}>Retire</button>}
        {/* Feedback lives right here, next to the button — never off-screen. */}
        {sm && <span style={{ fontSize: 12, fontWeight: 600, color: sm.ok ? '#6ee7b7' : '#fca5a5' }}>{sm.text}</span>}
        {!sm && isDirty && <span style={{ fontSize: 12, color: '#fcd34d' }}>Unsaved changes — click Save line</span>}
      </div>

      {/* Narrative spine: the assets advancing / reinforcing / testing this story. */}
      <StoryMap lineId={id} />

      {/* Your leads — fit + what they need, merged into one place (was two blocks). */}
      <Collapsible
        title="Your leads"
        hint={lf ? (lf.totalLeads === 0 ? 'no leads yet' : `maps to ${lf.matchedCount} of ${lf.totalLeads} · ${lf.bands.hot} hot`) : 'checking…'}
      >
        {!lf ? (
          <div style={{ fontSize: 12, color: '#64748b' }}>Checking your pipeline…</div>
        ) : lf.totalLeads === 0 ? (
          <div style={{ fontSize: 12, color: '#64748b' }}>No leads in this customer&apos;s pipeline yet — once there are, you&apos;ll see how many this line speaks to.</div>
        ) : (
          <>
            <div style={{ fontSize: 13, color: '#cbd5e1' }}>
              Maps to <strong style={{ color: lf.matchedCount > 0 ? '#6ee7b7' : '#94a3b8' }}>{lf.matchedCount}</strong> of {lf.totalLeads} leads
              {lf.matchedCount > 0 && (
                <span style={{ color: '#94a3b8' }}> &nbsp;·&nbsp; {lf.bands.hot} hot · {lf.bands.warm} warm · {lf.bands.cool} cool</span>
              )}
            </div>
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
              Defend the push order — lead with the line that reaches the most (and hottest) leads.
            </div>

            {(lf.needs.painThemes.length > 0 || lf.needs.industries.length > 0 || lf.needs.keywords.length > 0) && (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6 }}>What they need — click a chip to add it to Audience:</div>
                {([
                  { label: 'Pain themes', items: lf.needs.painThemes },
                  { label: 'Industries', items: lf.needs.industries },
                  { label: 'Recurring words', items: lf.needs.keywords }
                ] as const).map((group) => group.items.length > 0 && (
                  <div key={group.label} style={{ marginBottom: 6 }}>
                    <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.6, color: '#475569', marginRight: 6 }}>{group.label}:</span>
                    {group.items.map((it) => (
                      <button
                        key={it.label}
                        type="button"
                        onClick={() => {
                          const cur = (d.audience ?? '').trim();
                          const already = cur.toLowerCase().split(/\s*,\s*/).includes(it.label.toLowerCase());
                          if (already) return;
                          patchField(id, 'audience', cur ? `${cur}, ${it.label}` : it.label);
                        }}
                        title="Click to add to Audience"
                        style={{ display: 'inline-block', margin: '2px 4px 2px 0', padding: '2px 9px', borderRadius: 999, border: '1px solid rgba(96,165,250,0.3)', background: 'rgba(96,165,250,0.08)', color: '#bfdbfe', fontSize: 11, cursor: 'pointer' }}
                      >
                        {it.label} {it.count > 1 && <span style={{ color: '#64748b' }}>×{it.count}</span>}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            )}

            {lf.top.length > 0 && (
              <ul style={{ marginTop: 10, listStyle: 'none', padding: 0 }}>
                {lf.top.map((t) => (
                  <li key={t.leadId} style={{ fontSize: 12, color: '#cbd5e1', padding: '3px 0', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ color: '#f1f5f9', fontWeight: 600 }}>{t.company}</span>
                    {t.band && <span style={{ color: '#94a3b8' }}>{t.band}{t.score != null ? ` · ${t.score}` : ''}</span>}
                    {t.sharedTerms.length > 0 && <span style={{ color: '#64748b' }}>matched on: {t.sharedTerms.join(', ')}</span>}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </Collapsible>

      {/* Engagement */}
      <Collapsible title="Engagement (the learning loop)" hint={summary ? `${summary.entryCount} entries · ${(summary.engagementRate * 100).toFixed(1)}% rate` : 'no readings yet'}>
        {summary ? (
          <div style={{ display: 'flex', gap: 16, fontSize: 13, color: '#cbd5e1', marginBottom: 10, flexWrap: 'wrap' }}>
            <span>{summary.impressions.toLocaleString()} impressions</span>
            <span>{summary.engagements.toLocaleString()} engagements</span>
            <span>{summary.clicks.toLocaleString()} clicks</span>
            <span>{summary.conversions.toLocaleString()} conversions</span>
            <span style={{ color: '#94a3b8' }}>{(summary.engagementRate * 100).toFixed(1)}% rate · {summary.entryCount} entries</span>
          </div>
        ) : (
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 10 }}>No engagement recorded yet. Add a reading below.</div>
        )}
        {/* Channels — tick marks, multi-select, with Check all / Clear. The reading
            below is logged once per ticked channel. */}
        <div style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <label style={{ ...labelStyle, margin: 0 }}>Channels</label>
            {(() => {
              const allOn = CHANNELS.every((c) => entry.channels.includes(c));
              return (
                <button
                  type="button"
                  onClick={() => setEntry({ ...entry, channels: allOn ? [] : [...CHANNELS] })}
                  style={{ ...btnGhost, padding: '2px 10px', fontSize: 11 }}
                >
                  {allOn ? 'Clear all' : 'Check all'}
                </button>
              );
            })()}
            <span style={{ fontSize: 11, color: '#64748b' }}>{entry.channels.length} selected · logs one reading each</span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {CHANNELS.map((c) => {
              const on = entry.channels.includes(c);
              return (
                <label
                  key={c}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                    padding: '5px 10px', borderRadius: 8, fontSize: 12,
                    border: `1px solid ${on ? 'rgba(255,199,61,0.5)' : 'rgba(148,163,184,0.22)'}`,
                    background: on ? 'rgba(255,199,61,0.12)' : 'rgba(2,6,23,0.5)',
                    color: on ? '#f5c453' : '#cbd5e1'
                  }}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => setEntry({ ...entry, channels: on ? entry.channels.filter((x) => x !== c) : [...entry.channels, c] })}
                    style={{ accentColor: '#FFC73D', cursor: 'pointer' }}
                  />
                  {c}
                </label>
              );
            })}
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8, alignItems: 'end' }}>
          <div><label style={labelStyle}>Impressions</label><input style={inputStyle} inputMode="numeric" value={entry.impressions} onChange={(e) => setEntry({ ...entry, impressions: e.target.value })} /></div>
          <div><label style={labelStyle}>Engagements</label><input style={inputStyle} inputMode="numeric" value={entry.engagements} onChange={(e) => setEntry({ ...entry, engagements: e.target.value })} /></div>
          <div><label style={labelStyle}>Clicks</label><input style={inputStyle} inputMode="numeric" value={entry.clicks} onChange={(e) => setEntry({ ...entry, clicks: e.target.value })} /></div>
          <div><label style={labelStyle}>Conversions</label><input style={inputStyle} inputMode="numeric" value={entry.conversions} onChange={(e) => setEntry({ ...entry, conversions: e.target.value })} /></div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          <button onClick={() => submitEngagement(id)} disabled={entry.channels.length === 0} style={{ ...btnPrimary, opacity: entry.channels.length === 0 ? 0.5 : 1 }}>Add reading</button>
          <button onClick={() => pullSocials(id)} style={btnGhost} title="Auto-pull from connected socials (coming with the social accounts work)">Pull from socials</button>
        </div>
        {pullMsg && <div style={{ fontSize: 12, color: '#fcd34d', marginTop: 8 }}>{pullMsg}</div>}
      </Collapsible>

      {/* Commercials — make one from the line + see what's tied to it (merged into one section). */}
      <Collapsible title="Commercials" hint={comms.length > 0 ? `${comms.length} on this line` : 'make one from this line'}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0', marginBottom: 6 }}>Commercial from this line</div>
        <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8 }}>
          Auto-drafts a prompt from this line&apos;s thesis, audience, emotional driver &amp; authority angle — with voiceover + imagery direction baked in. Edit it freely; nothing generates yet.
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
          <div>
            <label style={labelStyle}>Type</label>
            <select style={{ ...inputStyle, width: 120 }} value={pd?.assetType ?? 'image'} onChange={(e) => draftCommercialPrompt(id, e.target.value as 'image' | 'video', pd?.duration ?? '6')}>
              <option value="image">Image</option>
              <option value="video">Video</option>
            </select>
          </div>
          {(pd?.assetType ?? 'image') === 'video' && (
            <div>
              <label style={labelStyle}>Seconds</label>
              <input style={{ ...inputStyle, width: 80 }} inputMode="numeric" value={pd?.duration ?? '6'} onChange={(e) => draftCommercialPrompt(id, 'video', e.target.value)} />
            </div>
          )}
          <button onClick={() => draftCommercialPrompt(id, pd?.assetType ?? 'image', pd?.duration ?? '6')} style={btnGhost}>
            {pd?.loading ? 'Drafting…' : pd?.text ? 'Re-draft from line' : 'Draft commercial prompt'}
          </button>
        </div>
        {pd?.text !== undefined && (
          <textarea
            style={{ ...inputStyle, minHeight: 120, marginTop: 8, fontFamily: 'ui-monospace, monospace', fontSize: 12 }}
            value={pd.text}
            onChange={(e) => setPromptText(id, e.target.value)}
            placeholder="Your editable commercial prompt will appear here…"
          />
        )}
        {pd?.text && (
          <div style={{ marginTop: 8 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button onClick={() => generateCommercial(id)} disabled={gen?.loading || !pd.text.trim()} style={{ ...btnPrimary, opacity: gen?.loading || !pd.text.trim() ? 0.5 : 1 }}>
                {gen?.loading ? 'Generating…' : `Generate ${pd.assetType}`}
              </button>
              <span style={{ fontSize: 11, color: '#64748b' }}>
                Uses exactly the prompt above. {pd.assetType === 'video' ? 'Video is the expensive call — it starts and renders in the background.' : 'Image generates right away.'}
              </span>
            </div>
            {gen?.msg && <div style={{ fontSize: 12, color: gen.msg.toLowerCase().includes('fail') ? '#fca5a5' : '#6ee7b7', marginTop: 8 }}>{gen.msg}</div>}
          </div>
        )}
        <div style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0', margin: '16px 0 6px' }}>Commercials on this line</div>
        {comms.length === 0 ? (
          <div style={{ fontSize: 12, color: '#64748b' }}>
            No commercials tied to this line yet.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: 8 }}>
            {comms.map((c) => (
              <div key={c.id} style={{ border: '1px solid rgba(148,163,184,0.16)', borderRadius: 10, padding: 10, fontSize: 12, color: '#cbd5e1' }}>
                <div style={{ fontWeight: 600, color: '#f1f5f9' }}>{c.assetType}</div>
                {c.generationStatus && GEN_STATUS_LABEL[c.generationStatus] && (
                  <div style={{ color: GEN_STATUS_LABEL[c.generationStatus].fg, fontSize: 11, marginTop: 1 }}>
                    {GEN_STATUS_LABEL[c.generationStatus].label}
                  </div>
                )}
                {c.campaignName && <div style={{ color: '#94a3b8' }}>{c.campaignName}</div>}
                {c.company && <div style={{ color: '#64748b' }}>{c.company}</div>}
                {c.brandedStatus && <div style={{ color: '#6ee7b7', marginTop: 2 }}>{c.brandedStatus}</div>}
              </div>
            ))}
          </div>
        )}
      </Collapsible>
    </div>
  );
}
