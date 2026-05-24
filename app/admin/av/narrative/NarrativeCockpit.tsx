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
import { useCallback, useEffect, useState } from 'react';
import { SuggestInput, SuggestTextarea } from '@/components/SuggestField';

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
interface Commercial { id: number; assetType: string; brandedStatus: string | null; campaignName: string | null; company: string | null; }
interface LineFit {
  totalLeads: number;
  matchedCount: number;
  bands: { hot: number; warm: number; cool: number };
  top: Array<{ leadId: number; company: string; band: string | null; score: number | null; sharedTerms: string[] }>;
}

const STATE_TONE: Record<LineState, { label: string; bg: string; fg: string }> = {
  active: { label: 'Active', bg: 'rgba(16,185,129,0.18)', fg: '#6ee7b7' },
  reinforcing: { label: 'Reinforcing', bg: 'rgba(59,130,246,0.18)', fg: '#93c5fd' },
  candidate: { label: 'Candidate', bg: 'rgba(148,163,184,0.16)', fg: '#cbd5e1' },
  retiring: { label: 'Retiring', bg: 'rgba(245,158,11,0.16)', fg: '#fcd34d' }
};
const CHANNELS = ['linkedin', 'facebook', 'instagram', 'blog', 'newsroom', 'email', 'other'];

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

  const [eng, setEng] = useState<Record<number, EngagementSummary>>({});
  const [commercials, setCommercials] = useState<Record<number, Commercial[]>>({});
  const [fit, setFit] = useState<Record<number, LineFit>>({});
  const [entry, setEntry] = useState({ channel: 'linkedin', impressions: '', engagements: '', clicks: '', conversions: '', note: '' });
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

  const [newCustomerKey, setNewCustomerKey] = useState(customers[0]?.key ?? 'av:house');
  const [newName, setNewName] = useState('');
  const [newThesis, setNewThesis] = useState('');
  const [adding, setAdding] = useState(false);

  const toggleLine = useCallback((l: Line) => {
    setNotice(null); setPullMsg(null);
    if (openId === l.id) { setOpenId(null); return; }
    setOpenId(l.id);
    setDraft((d) => ({ ...d, [l.id]: { ...l } }));
    if (!eng[l.id]) loadLineData(l.id);
  }, [openId, eng, loadLineData]);

  const patchField = (id: number, key: keyof Line, value: unknown) =>
    setDraft((d) => ({ ...d, [id]: { ...d[id], [key]: value } }));

  const saveLine = useCallback(async (id: number) => {
    const d = draft[id];
    if (!d) return;
    setSaving(id); setNotice(null);
    try {
      const res = await fetch('/api/admin/campaigns/lanes', {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id, name: d.name, thesis: d.thesis, audience: d.audience, emotionalDriver: d.emotionalDriver,
          authorityAngle: d.authorityAngle, seasonality: d.seasonality, conversionSignal: d.conversionSignal,
          proofPoints: d.proofPoints, doSay: d.doSay, dontSay: d.dontSay
        })
      });
      const j = await res.json();
      if (!res.ok) { setNotice(j.error || 'Could not save.'); return; }
      setLines((ls) => ls.map((l) => (l.id === id ? { ...d } : l)));
      setNotice('Saved.');
    } finally { setSaving(null); }
  }, [draft]);

  const changeState = useCallback(async (id: number, state: LineState) => {
    setNotice(null);
    const res = await fetch('/api/admin/campaigns/lanes', {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, state })
    });
    const j = await res.json();
    if (!res.ok) { setNotice(j.error || 'Could not change state.'); return; }
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, state } : l)));
    setDraft((d) => (d[id] ? { ...d, [id]: { ...d[id], state } } : d));
  }, []);

  const submitEngagement = useCallback(async (id: number) => {
    const res = await fetch(`/api/admin/campaigns/lines/${id}/engagement`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        mode: 'manual', channel: entry.channel,
        impressions: Number(entry.impressions) || 0, engagements: Number(entry.engagements) || 0,
        clicks: Number(entry.clicks) || 0, conversions: Number(entry.conversions) || 0, note: entry.note || null
      })
    });
    const j = await res.json();
    if (res.ok && j.summary) {
      setEng((m) => ({ ...m, [id]: j.summary }));
      setEntry({ channel: 'linkedin', impressions: '', engagements: '', clicks: '', conversions: '', note: '' });
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

  const editorProps = { openId, toggleLine, draft, patchField, saveLine, saving, changeState, eng, commercials, fit, entry, setEntry, submitEngagement, pullSocials, pullMsg, promptDraft, draftCommercialPrompt, setPromptText, genStatus, generateCommercial };

  return (
    <div>
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
  saveLine: (id: number) => void;
  saving: number | null;
  changeState: (id: number, s: LineState) => void;
  eng: Record<number, EngagementSummary>;
  commercials: Record<number, Commercial[]>;
  fit: Record<number, LineFit>;
  entry: { channel: string; impressions: string; engagements: string; clicks: string; conversions: string; note: string };
  setEntry: (e: EditorProps['entry']) => void;
  submitEngagement: (id: number) => void;
  pullSocials: (id: number) => void;
  pullMsg: string | null;
  promptDraft: Record<number, { assetType: 'image' | 'video'; duration: string; text: string; loading: boolean }>;
  draftCommercialPrompt: (id: number, assetType: 'image' | 'video', duration: string) => void;
  setPromptText: (id: number, text: string) => void;
  genStatus: Record<number, { loading: boolean; msg: string | null }>;
  generateCommercial: (id: number) => void;
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
        return (
          <div key={l.id} style={{ border: '1px solid rgba(148,163,184,0.14)', borderRadius: 12, background: 'rgba(2,6,23,0.35)', padding: 12, marginBottom: 10 }}>
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

function LineEditor({ line, draft, patchField, saveLine, saving, changeState, eng, commercials, fit, entry, setEntry, submitEngagement, pullSocials, pullMsg, promptDraft, draftCommercialPrompt, setPromptText, genStatus, generateCommercial }: EditorProps & { line: Line }) {
  const d = draft[line.id] ?? line;
  const id = line.id;
  const summary = eng[id];
  const comms = commercials[id] ?? [];
  const lf = fit[id];
  const pd = promptDraft[id];
  const gen = genStatus[id];

  const field = (label: string, key: keyof Line, suggestion: string) => (
    <div>
      <label style={labelStyle}>{label}</label>
      <SuggestInput value={(d[key] as string) ?? ''} onChange={(v) => patchField(id, key, v)} suggestion={suggestion} ariaLabel={label} />
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
      <div>
        <label style={labelStyle}>Thesis — the believable market thesis, one sentence</label>
        <SuggestTextarea value={d.thesis ?? ''} onChange={(v) => patchField(id, 'thesis', v)} suggestion="Luxury retreats are becoming strategic executive performance assets." ariaLabel="Thesis" />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {field('Audience', 'audience', 'burned-out leadership teams')}
        {field('Emotional driver', 'emotionalDriver', 'burnout + reconnection')}
        {field('Authority angle', 'authorityAngle', 'performance psychology')}
        {field('Seasonality / timing', 'seasonality', 'Q2–Q3 planning season')}
      </div>
      <div>
        <label style={labelStyle}>Conversion signal — the moment that means it&apos;s working</label>
        <SuggestInput value={d.conversionSignal ?? ''} onChange={(v) => patchField(id, 'conversionSignal', v)} suggestion="retreat inquiry after commercial view" ariaLabel="Conversion signal" />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
        {listField('Proof points', 'proofPoints', 'stat / quote / result')}
        {listField('Say (on-thesis)', 'doSay', 'phrases that fit')}
        {listField("Don't say (off-thesis)", 'dontSay', 'phrases to avoid')}
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <button onClick={() => saveLine(id)} disabled={saving === id} style={{ ...btnPrimary, opacity: saving === id ? 0.5 : 1 }}>{saving === id ? 'Saving…' : 'Save line'}</button>
        {line.state !== 'active' && <button onClick={() => changeState(id, 'active')} style={btnGhost}>Activate</button>}
        {line.state === 'active' && <button onClick={() => changeState(id, 'reinforcing')} style={btnGhost}>Mark reinforcing</button>}
        {line.state !== 'candidate' && <button onClick={() => changeState(id, 'candidate')} style={btnGhost}>Back to candidate</button>}
        {line.state !== 'retiring' && <button onClick={() => changeState(id, 'retiring')} style={btnGhost}>Retire</button>}
      </div>

      {/* Lead fit — how many of this owner's leads the line speaks to (defend the push order) */}
      <div style={{ marginTop: 16, borderTop: '1px solid rgba(148,163,184,0.12)', paddingTop: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0', marginBottom: 6 }}>Lead fit — who this line serves</div>
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
              Use this to defend the push order — lead with the line that reaches the most (and hottest) leads. (Themed match; gets smarter over time.)
            </div>
            {lf.top.length > 0 && (
              <ul style={{ marginTop: 8, listStyle: 'none', padding: 0 }}>
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
      </div>

      {/* Engagement */}
      <div style={{ marginTop: 16, borderTop: '1px solid rgba(148,163,184,0.12)', paddingTop: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0', marginBottom: 6 }}>Engagement (the learning loop)</div>
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
        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr 1fr 1fr', gap: 8, alignItems: 'end' }}>
          <div>
            <label style={labelStyle}>Channel</label>
            <select style={inputStyle} value={entry.channel} onChange={(e) => setEntry({ ...entry, channel: e.target.value })}>
              {CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div><label style={labelStyle}>Impressions</label><input style={inputStyle} inputMode="numeric" value={entry.impressions} onChange={(e) => setEntry({ ...entry, impressions: e.target.value })} /></div>
          <div><label style={labelStyle}>Engagements</label><input style={inputStyle} inputMode="numeric" value={entry.engagements} onChange={(e) => setEntry({ ...entry, engagements: e.target.value })} /></div>
          <div><label style={labelStyle}>Clicks</label><input style={inputStyle} inputMode="numeric" value={entry.clicks} onChange={(e) => setEntry({ ...entry, clicks: e.target.value })} /></div>
          <div><label style={labelStyle}>Conversions</label><input style={inputStyle} inputMode="numeric" value={entry.conversions} onChange={(e) => setEntry({ ...entry, conversions: e.target.value })} /></div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          <button onClick={() => submitEngagement(id)} style={btnPrimary}>Add reading</button>
          <button onClick={() => pullSocials(id)} style={btnGhost} title="Auto-pull from connected socials (coming with the social accounts work)">Pull from socials</button>
        </div>
        {pullMsg && <div style={{ fontSize: 12, color: '#fcd34d', marginTop: 8 }}>{pullMsg}</div>}
      </div>

      {/* Commercial prompt — born from the line, no lead, editable before generating */}
      <div style={{ marginTop: 16, borderTop: '1px solid rgba(148,163,184,0.12)', paddingTop: 12 }}>
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
      </div>

      {/* Existing commercials tied to this line */}
      <div style={{ marginTop: 16, borderTop: '1px solid rgba(148,163,184,0.12)', paddingTop: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0', marginBottom: 6 }}>Commercials on this line</div>
        {comms.length === 0 ? (
          <div style={{ fontSize: 12, color: '#64748b' }}>
            No commercials tied to this line yet.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: 8 }}>
            {comms.map((c) => (
              <div key={c.id} style={{ border: '1px solid rgba(148,163,184,0.16)', borderRadius: 10, padding: 10, fontSize: 12, color: '#cbd5e1' }}>
                <div style={{ fontWeight: 600, color: '#f1f5f9' }}>{c.assetType}</div>
                {c.campaignName && <div style={{ color: '#94a3b8' }}>{c.campaignName}</div>}
                {c.company && <div style={{ color: '#64748b' }}>{c.company}</div>}
                {c.brandedStatus && <div style={{ color: '#6ee7b7', marginTop: 2 }}>{c.brandedStatus}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
