'use client';

/**
 * NarrativeCockpit -- author + steer narrative lines.
 *
 * Per line: edit the thesis + intelligence, move it through its lifecycle
 * (candidate -> active -> reinforcing -> retiring) under the 2-4 active cap,
 * capture engagement (manual now; "Pull from socials" stub for later), and see
 * the commercials it has produced. Talks to /api/admin/campaigns/lanes and
 * /api/admin/campaigns/lines/[id]/{engagement,commercials}.
 */
import { useCallback, useEffect, useState } from 'react';

type LineState = 'candidate' | 'active' | 'reinforcing' | 'retiring';

interface Line {
  id: number;
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
  impressions: number;
  engagements: number;
  clicks: number;
  conversions: number;
  entryCount: number;
  engagementRate: number;
  byChannel: Array<{ channel: string; impressions: number; engagements: number; clicks: number; conversions: number }>;
  recent: Array<{ id: number; channel: string; impressions: number; engagements: number; clicks: number; conversions: number; source: string; createdAt: string }>;
}

interface Commercial {
  id: number;
  assetType: string;
  brandedStatus: string | null;
  campaignName: string | null;
  company: string | null;
}

const STATE_TONE: Record<LineState, { label: string; bg: string; fg: string }> = {
  active: { label: 'Active', bg: 'rgba(16,185,129,0.18)', fg: '#6ee7b7' },
  reinforcing: { label: 'Reinforcing', bg: 'rgba(59,130,246,0.18)', fg: '#93c5fd' },
  candidate: { label: 'Candidate', bg: 'rgba(148,163,184,0.16)', fg: '#cbd5e1' },
  retiring: { label: 'Retiring', bg: 'rgba(245,158,11,0.16)', fg: '#fcd34d' }
};

const CHANNELS = ['linkedin', 'facebook', 'instagram', 'blog', 'newsroom', 'email', 'other'];

const card: React.CSSProperties = {
  border: '1px solid rgba(148,163,184,0.16)',
  borderRadius: 14,
  background: 'rgba(15,23,42,0.5)',
  padding: 16,
  marginBottom: 14
};
const inputStyle: React.CSSProperties = {
  width: '100%', background: 'rgba(2,6,23,0.6)', border: '1px solid rgba(148,163,184,0.2)',
  borderRadius: 8, padding: '7px 10px', color: '#e2e8f0', fontSize: 13
};
const labelStyle: React.CSSProperties = { display: 'block', fontSize: 11, color: '#94a3b8', margin: '8px 0 3px' };

const linesToText = (a: string[]) => a.join('\n');
const textToLines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);

export function NarrativeCockpit({ initialLines, activeCount, maxActive }: {
  initialLines: Line[];
  activeCount: number;
  maxActive: number;
}) {
  const [lines, setLines] = useState<Line[]>(initialLines);
  const [active, setActive] = useState(activeCount);
  const [openId, setOpenId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Record<number, Line>>({});
  const [saving, setSaving] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [eng, setEng] = useState<Record<number, EngagementSummary>>({});
  const [commercials, setCommercials] = useState<Record<number, Commercial[]>>({});
  const [entry, setEntry] = useState<{ channel: string; impressions: string; engagements: string; clicks: string; conversions: string; note: string }>({
    channel: 'linkedin', impressions: '', engagements: '', clicks: '', conversions: '', note: ''
  });
  const [pullMsg, setPullMsg] = useState<string | null>(null);

  const [newName, setNewName] = useState('');
  const [newThesis, setNewThesis] = useState('');
  const [adding, setAdding] = useState(false);

  const loadLineData = useCallback(async (id: number) => {
    try {
      const [e, c] = await Promise.all([
        fetch(`/api/admin/campaigns/lines/${id}/engagement`, { cache: 'no-store' }).then((r) => r.json()),
        fetch(`/api/admin/campaigns/lines/${id}/commercials`, { cache: 'no-store' }).then((r) => r.json())
      ]);
      if (e?.summary) setEng((m) => ({ ...m, [id]: e.summary }));
      if (c?.commercials) setCommercials((m) => ({ ...m, [id]: c.commercials }));
    } catch {
      /* ignore */
    }
  }, []);

  const toggle = useCallback((l: Line) => {
    setNotice(null);
    setPullMsg(null);
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
    setSaving(id);
    setNotice(null);
    try {
      const res = await fetch('/api/admin/campaigns/lanes', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id,
          name: d.name,
          thesis: d.thesis,
          audience: d.audience,
          emotionalDriver: d.emotionalDriver,
          authorityAngle: d.authorityAngle,
          seasonality: d.seasonality,
          conversionSignal: d.conversionSignal,
          proofPoints: d.proofPoints,
          doSay: d.doSay,
          dontSay: d.dontSay
        })
      });
      const j = await res.json();
      if (!res.ok) { setNotice(j.error || 'Could not save.'); return; }
      setLines((ls) => ls.map((l) => (l.id === id ? { ...d } : l)));
      setNotice('Saved.');
    } finally {
      setSaving(null);
    }
  }, [draft]);

  const changeState = useCallback(async (id: number, state: LineState) => {
    setNotice(null);
    const res = await fetch('/api/admin/campaigns/lanes', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, state })
    });
    const j = await res.json();
    if (!res.ok) {
      // 409 = the 2-4 active cap. Surface the friendly message.
      setNotice(j.error || 'Could not change state.');
      if (typeof j.activeCount === 'number') setActive(j.activeCount);
      return;
    }
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, state } : l)));
    setDraft((d) => (d[id] ? { ...d, [id]: { ...d[id], state } } : d));
    // recompute active count locally
    setActive(() => lines.filter((l) => (l.id === id ? state : l.state) === 'active' || (l.id === id ? state : l.state) === 'reinforcing').length);
  }, [lines]);

  const submitEngagement = useCallback(async (id: number) => {
    const body = {
      mode: 'manual',
      channel: entry.channel,
      impressions: Number(entry.impressions) || 0,
      engagements: Number(entry.engagements) || 0,
      clicks: Number(entry.clicks) || 0,
      conversions: Number(entry.conversions) || 0,
      note: entry.note || null
    };
    const res = await fetch(`/api/admin/campaigns/lines/${id}/engagement`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
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
    setAdding(true);
    try {
      const res = await fetch('/api/admin/campaigns/lanes', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), thesis: newThesis.trim() || null })
      });
      const j = await res.json();
      if (res.ok && j.id) {
        setLines((ls) => [
          { id: j.id, name: newName.trim(), state: 'candidate', accent: null, thesis: newThesis.trim() || null, audience: null, emotionalDriver: null, authorityAngle: null, seasonality: null, conversionSignal: null, proofPoints: [], doSay: [], dontSay: [] },
          ...ls
        ]);
        setNewName(''); setNewThesis('');
      }
    } finally {
      setAdding(false);
    }
  }, [newName, newThesis]);

  const group = (s: LineState[]) => lines.filter((l) => s.includes(l.state));
  const steering = group(['active', 'reinforcing']);
  const candidates = group(['candidate']);
  const retiring = group(['retiring']);

  return (
    <div>
      {/* cap banner */}
      <div style={{ ...card, display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(15,23,42,0.7)' }}>
        <div style={{ fontSize: 13, color: '#cbd5e1' }}>
          <strong style={{ color: active >= maxActive ? '#fcd34d' : '#6ee7b7' }}>{active} / {maxActive}</strong> narrative lines steering content.
          {active >= maxActive && <span style={{ color: '#94a3b8' }}> &nbsp;Cap reached — retire one before activating another.</span>}
        </div>
      </div>

      {/* new line */}
      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0', marginBottom: 8 }}>New narrative line</div>
        <input style={inputStyle} placeholder="Short name (e.g. Executive recovery retreats)" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <textarea style={{ ...inputStyle, marginTop: 8, minHeight: 52 }} placeholder="The market thesis in one sentence (optional now, you can add it later)" value={newThesis} onChange={(e) => setNewThesis(e.target.value)} />
        <button onClick={addLine} disabled={adding || !newName.trim()} style={{ marginTop: 8, ...btnPrimary, opacity: adding || !newName.trim() ? 0.5 : 1 }}>
          {adding ? 'Adding…' : 'Add as candidate'}
        </button>
        <span style={{ fontSize: 11, color: '#64748b', marginLeft: 10 }}>New lines start as candidates — promote when you&apos;re ready.</span>
      </div>

      {notice && <div style={{ ...card, borderColor: 'rgba(96,165,250,0.4)', color: '#bfdbfe', fontSize: 13 }}>{notice}</div>}

      <Section title="Steering content now" lines={steering} {...{ openId, toggle, draft, patchField, saveLine, saving, changeState, eng, commercials, entry, setEntry, submitEngagement, pullSocials, pullMsg }} />
      <Section title="Candidates (parking lot)" lines={candidates} {...{ openId, toggle, draft, patchField, saveLine, saving, changeState, eng, commercials, entry, setEntry, submitEngagement, pullSocials, pullMsg }} />
      <Section title="Retiring" lines={retiring} {...{ openId, toggle, draft, patchField, saveLine, saving, changeState, eng, commercials, entry, setEntry, submitEngagement, pullSocials, pullMsg }} />
    </div>
  );
}

const btnPrimary: React.CSSProperties = {
  background: 'linear-gradient(120deg,#FF9C5B,#FFC73D)', color: '#1a1207', border: 'none',
  borderRadius: 8, padding: '7px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer'
};
const btnGhost: React.CSSProperties = {
  background: 'rgba(148,163,184,0.12)', color: '#cbd5e1', border: '1px solid rgba(148,163,184,0.2)',
  borderRadius: 8, padding: '6px 12px', fontSize: 12, cursor: 'pointer'
};

interface SectionProps {
  title: string;
  lines: Line[];
  openId: number | null;
  toggle: (l: Line) => void;
  draft: Record<number, Line>;
  patchField: (id: number, key: keyof Line, value: unknown) => void;
  saveLine: (id: number) => void;
  saving: number | null;
  changeState: (id: number, s: LineState) => void;
  eng: Record<number, EngagementSummary>;
  commercials: Record<number, Commercial[]>;
  entry: { channel: string; impressions: string; engagements: string; clicks: string; conversions: string; note: string };
  setEntry: (e: SectionProps['entry']) => void;
  submitEngagement: (id: number) => void;
  pullSocials: (id: number) => void;
  pullMsg: string | null;
}

function Section(props: SectionProps) {
  const { title, lines, openId, toggle } = props;
  if (lines.length === 0) return null;
  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: '#64748b', marginBottom: 8 }}>{title}</div>
      {lines.map((l) => {
        const tone = STATE_TONE[l.state];
        const open = openId === l.id;
        return (
          <div key={l.id} style={card}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }} onClick={() => toggle(l)}>
              <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 9px', borderRadius: 999, background: tone.bg, color: tone.fg }}>{tone.label}</span>
              <span style={{ fontSize: 15, fontWeight: 600, color: '#f1f5f9' }}>{l.name}</span>
              <span style={{ marginLeft: 'auto', color: '#64748b', fontSize: 18 }}>{open ? '−' : '+'}</span>
            </div>
            {!open && l.thesis && <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 6 }}>{l.thesis}</div>}
            {open && <LineEditor line={l} {...props} />}
          </div>
        );
      })}
    </div>
  );
}

function LineEditor({ line, draft, patchField, saveLine, saving, changeState, eng, commercials, entry, setEntry, submitEngagement, pullSocials, pullMsg }: SectionProps & { line: Line }) {
  const d = draft[line.id] ?? line;
  const id = line.id;
  const summary = eng[id];
  const comms = commercials[id] ?? [];

  const field = (label: string, key: keyof Line, placeholder: string) => (
    <div>
      <label style={labelStyle}>{label}</label>
      <input style={inputStyle} placeholder={placeholder} value={(d[key] as string) ?? ''} onChange={(e) => patchField(id, key, e.target.value)} />
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
        <textarea style={{ ...inputStyle, minHeight: 52 }} value={d.thesis ?? ''} onChange={(e) => patchField(id, 'thesis', e.target.value)} placeholder="e.g. Luxury retreats are becoming strategic executive performance assets." />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {field('Audience', 'audience', 'burned-out leadership teams')}
        {field('Emotional driver', 'emotionalDriver', 'burnout + reconnection')}
        {field('Authority angle', 'authorityAngle', 'performance psychology')}
        {field('Seasonality / timing', 'seasonality', 'Q2–Q3 planning season')}
      </div>
      <div>
        <label style={labelStyle}>Conversion signal — the moment that means it&apos;s working</label>
        <input style={inputStyle} value={d.conversionSignal ?? ''} onChange={(e) => patchField(id, 'conversionSignal', e.target.value)} placeholder="retreat inquiry after commercial view" />
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

      {/* Engagement */}
      <div style={{ marginTop: 16, borderTop: '1px solid rgba(148,163,184,0.12)', paddingTop: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0', marginBottom: 6 }}>Engagement (the learning loop)</div>
        {summary ? (
          <div style={{ display: 'flex', gap: 16, fontSize: 13, color: '#cbd5e1', marginBottom: 10, flexWrap: 'wrap' }}>
            <span>👁 {summary.impressions.toLocaleString()} impressions</span>
            <span>❤ {summary.engagements.toLocaleString()} engagements</span>
            <span>🔗 {summary.clicks.toLocaleString()} clicks</span>
            <span>✅ {summary.conversions.toLocaleString()} conversions</span>
            <span style={{ color: '#94a3b8' }}>{(summary.engagementRate * 100).toFixed(1)}% eng. rate · {summary.entryCount} entries</span>
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

      {/* Commercials */}
      <div style={{ marginTop: 16, borderTop: '1px solid rgba(148,163,184,0.12)', paddingTop: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0', marginBottom: 6 }}>Commercials on this line</div>
        {comms.length === 0 ? (
          <div style={{ fontSize: 12, color: '#64748b' }}>
            No commercials tied to this line yet. They appear here once a campaign in this line generates one.
            On-thesis brand commercials launched straight from a line are the next build.
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
