'use client';

/**
 * CampaignsBoard -- narrative lanes (editable editorial pillars) with the
 * campaigns that live in each. Create campaigns, add/retire lanes. The
 * orchestration spine: campaigns group blog/social/commercial output.
 */
import { useCallback, useEffect, useState } from 'react';

interface Lane {
  id: number;
  name: string;
  description: string | null;
  accent: string | null;
  cadenceHint: string | null;
  isActive: boolean;
}
interface Campaign {
  id: number;
  laneId: number | null;
  leadId: number | null;
  name: string;
  goal: string | null;
  status: 'planning' | 'active' | 'paused' | 'done';
  company: string | null;
  artifactCount: number;
}

const STATUS_TONE: Record<Campaign['status'], { label: string; bg: string; fg: string }> = {
  planning: { label: 'Planning', bg: 'rgba(148,163,184,0.16)', fg: '#cbd5e1' },
  active: { label: 'Active', bg: 'rgba(16,185,129,0.18)', fg: '#6ee7b7' },
  paused: { label: 'Paused', bg: 'rgba(245,158,11,0.16)', fg: '#fcd34d' },
  done: { label: 'Done', bg: 'rgba(59,130,246,0.18)', fg: '#93c5fd' }
};

export function CampaignsBoard() {
  const [lanes, setLanes] = useState<Lane[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [newLane, setNewLane] = useState('');
  const [addingLane, setAddingLane] = useState(false);

  // per-lane new-campaign drafts
  const [draft, setDraft] = useState<Record<string, { name: string; goal: string }>>({});
  const [creating, setCreating] = useState<string | null>(null);

  // expanded campaign content
  const [openId, setOpenId] = useState<number | null>(null);
  const [content, setContent] = useState<Record<number, { artifacts: Array<{ id: number; artifactType: string; title: string | null; status: string }>; commercials: Array<{ id: number; assetType: string }> }>>({});

  const viewContents = useCallback(async (id: number) => {
    if (openId === id) { setOpenId(null); return; }
    setOpenId(id);
    if (content[id]) return;
    try {
      const res = await fetch(`/api/admin/campaigns/${id}`, { cache: 'no-store' });
      const json = await res.json();
      if (res.ok) setContent((c) => ({ ...c, [id]: { artifacts: json.artifacts || [], commercials: json.commercials || [] } }));
    } catch {
      /* ignore */
    }
  }, [openId, content]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [lr, cr] = await Promise.all([
        fetch('/api/admin/campaigns/lanes?includeInactive=1', { cache: 'no-store' }),
        fetch('/api/admin/campaigns', { cache: 'no-store' })
      ]);
      const lj = await lr.json();
      const cj = await cr.json();
      if (!lr.ok) throw new Error(lj.error || 'failed to load lanes');
      setLanes(lj.lanes || []);
      setCampaigns(cj.campaigns || []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const addLane = useCallback(async () => {
    if (!newLane.trim()) return;
    setAddingLane(true);
    try {
      const res = await fetch('/api/admin/campaigns/lanes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newLane.trim() })
      });
      if (!res.ok) throw new Error((await res.json()).error || 'failed');
      setNewLane('');
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAddingLane(false);
    }
  }, [newLane, load]);

  const toggleLane = useCallback(async (lane: Lane) => {
    await fetch('/api/admin/campaigns/lanes', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: lane.id, isActive: !lane.isActive })
    });
    await load();
  }, [load]);

  const createCampaign = useCallback(async (laneId: number | null) => {
    const key = String(laneId ?? 'none');
    const d = draft[key];
    if (!d || !d.name.trim()) return;
    setCreating(key);
    try {
      const res = await fetch('/api/admin/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: d.name.trim(), goal: d.goal.trim() || undefined, laneId })
      });
      if (!res.ok) throw new Error((await res.json()).error || 'failed');
      setDraft((x) => ({ ...x, [key]: { name: '', goal: '' } }));
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(null);
    }
  }, [draft, load]);

  const cardStyle: React.CSSProperties = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14 };
  const inputStyle: React.CSSProperties = { background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.12)', color: '#fff' };

  if (loading) return <div className="text-sm text-muted">Loading lanes…</div>;

  const byLane = (laneId: number | null) => campaigns.filter((c) => c.laneId === laneId);
  const unlaned = campaigns.filter((c) => c.laneId == null || !lanes.some((l) => l.id === c.laneId));

  return (
    <div className="space-y-5">
      {error && (
        <div className="rounded-lg px-3 py-2 text-sm" style={{ background: 'rgba(239,68,68,0.12)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.3)' }}>{error}</div>
      )}

      {/* Add a lane */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl p-3" style={{ background: 'rgba(255,156,91,0.06)', border: '1px solid rgba(255,156,91,0.22)' }}>
        <span className="text-[12px]" style={{ color: '#FFD9BE' }}>New narrative lane:</span>
        <input value={newLane} onChange={(e) => setNewLane(e.target.value)} placeholder="e.g. Sustainability & Stewardship"
          className="flex-1 min-w-[220px] rounded-lg px-3 py-1.5 text-[13px]" style={inputStyle} />
        <button type="button" onClick={() => void addLane()} disabled={addingLane}
          className="rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50" style={{ background: '#FF7A1A', color: '#1a1206' }}>
          {addingLane ? 'Adding…' : 'Add lane'}
        </button>
      </div>

      {lanes.map((lane) => {
        const key = String(lane.id);
        const d = draft[key] ?? { name: '', goal: '' };
        const list = byLane(lane.id);
        return (
          <section key={lane.id} style={{ ...cardStyle, opacity: lane.isActive ? 1 : 0.55 }} className="p-4">
            <div className="flex items-start justify-between gap-3 mb-2">
              <div className="flex items-center gap-2.5">
                <span className="inline-block w-3 h-3 rounded-full" style={{ background: lane.accent || '#FF9C5B' }} />
                <div>
                  <h3 className="text-ink font-semibold">{lane.name}</h3>
                  {lane.description && <p className="text-[12px] text-muted">{lane.description}</p>}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {lane.cadenceHint && <span className="text-[11px] text-muted">{lane.cadenceHint}</span>}
                <button type="button" onClick={() => void toggleLane(lane)} className="text-[11px] text-muted hover:text-ink underline">
                  {lane.isActive ? 'Retire' : 'Reactivate'}
                </button>
              </div>
            </div>

            {list.length > 0 && (
              <ul className="space-y-2 mb-3">
                {list.map((c) => {
                  const tone = STATUS_TONE[c.status];
                  const open = openId === c.id;
                  const ct = content[c.id];
                  return (
                    <li key={c.id} className="rounded-lg px-3 py-2" style={{ background: 'rgba(0,0,0,0.22)', border: '1px solid rgba(255,255,255,0.06)' }}>
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm text-ink truncate">{c.name}</div>
                          {(c.company || c.goal) && <div className="text-[11px] text-muted truncate">{c.company ? `For ${c.company}. ` : ''}{c.goal ?? ''}</div>}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button type="button" onClick={() => void viewContents(c.id)} className="text-[11px] underline" style={{ color: '#9AE6B4' }}>
                            {open ? 'Hide' : 'View'} {c.artifactCount} piece{c.artifactCount === 1 ? '' : 's'}
                          </button>
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium" style={{ background: tone.bg, color: tone.fg }}>{tone.label}</span>
                        </div>
                      </div>
                      {open && ct && (
                        <div className="mt-2 pl-2 border-l-2" style={{ borderColor: lane.accent || '#FF9C5B' }}>
                          {ct.artifacts.length === 0 && ct.commercials.length === 0 ? (
                            <p className="text-[12px] text-muted py-1">Nothing assigned yet. Add blog posts from Content &amp; blog, or commercials from a lead.</p>
                          ) : (
                            <ul className="space-y-1 py-1">
                              {ct.artifacts.map((a) => (
                                <li key={`a-${a.id}`} className="text-[12px] text-ink flex items-center gap-2">
                                  <span className="text-[10px] uppercase tracking-wide text-muted">{a.artifactType.replace('_', ' ')}</span>
                                  <span className="truncate">{a.title || 'Untitled'}</span>
                                  <span className="text-[10px] text-muted">· {a.status}</span>
                                </li>
                              ))}
                              {ct.commercials.map((m) => (
                                <li key={`m-${m.id}`} className="text-[12px] text-ink flex items-center gap-2">
                                  <span className="text-[10px] uppercase tracking-wide text-muted">{m.assetType}</span>
                                  <span className="text-muted">commercial #{m.id}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            {/* New campaign in this lane */}
            <div className="flex flex-wrap items-center gap-2">
              <input value={d.name} onChange={(e) => setDraft((x) => ({ ...x, [key]: { ...d, name: e.target.value } }))}
                placeholder="New campaign name" className="min-w-[200px] flex-1 rounded-lg px-3 py-1.5 text-[13px]" style={inputStyle} />
              <input value={d.goal} onChange={(e) => setDraft((x) => ({ ...x, [key]: { ...d, goal: e.target.value } }))}
                placeholder="Goal / narrative (optional)" className="min-w-[200px] flex-1 rounded-lg px-3 py-1.5 text-[13px]" style={inputStyle} />
              <button type="button" onClick={() => void createCampaign(lane.id)} disabled={creating === key || !d.name.trim()}
                className="rounded-lg px-3 py-1.5 text-[13px] disabled:opacity-50" style={{ background: 'rgba(16,185,129,0.16)', color: '#6ee7b7', border: '1px solid rgba(16,185,129,0.3)' }}>
                {creating === key ? 'Creating…' : '+ Campaign'}
              </button>
            </div>
          </section>
        );
      })}

      {unlaned.length > 0 && (
        <section style={cardStyle} className="p-4">
          <h3 className="text-ink font-semibold mb-2">Unassigned</h3>
          <ul className="space-y-2">
            {unlaned.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 rounded-lg px-3 py-2" style={{ background: 'rgba(0,0,0,0.22)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <span className="text-sm text-ink truncate">{c.name}</span>
                <span className="text-[11px] text-muted">{c.artifactCount} pieces</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
