'use client';

/**
 * StoryMap — the narrative line's memory map (schema 050). Shows which assets
 * advance / reinforce / test this line's thesis, lets the operator re-role or
 * unlink them. Lazy: fetches only when opened, so the cockpit stays fast.
 */
import { useState } from 'react';
import { apiCall } from '@/lib/http';

type Role = 'advances' | 'reinforces' | 'tests';
interface Link { id: number; assetType: string; assetId: number; role: Role; note: string | null }
interface Counts { advances: number; reinforces: number; tests: number; total: number }

const ROLE_TONE: Record<Role, string> = { advances: '#6ee7b7', reinforces: '#93c5fd', tests: '#fcd34d' };
const ZERO: Counts = { advances: 0, reinforces: 0, tests: 0, total: 0 };

export function StoryMap({ lineId }: { lineId: number }) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [links, setLinks] = useState<Link[]>([]);
  const [counts, setCounts] = useState<Counts>(ZERO);

  async function load() {
    setBusy(true);
    try {
      const j = await apiCall<{ links?: Link[]; counts?: Counts }>(`/api/admin/campaigns/lines/${lineId}/links`);
      setLinks(j.links || []); setCounts(j.counts || ZERO); setLoaded(true);
    } catch { /* quiet */ } finally { setBusy(false); }
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !loaded) void load();
  }

  async function setRole(link: Link, role: Role) {
    setBusy(true);
    try {
      const j = await apiCall<{ counts?: Counts }>(`/api/admin/campaigns/lines/${lineId}/links`, { assetType: link.assetType, assetId: link.assetId, role });
      setLinks((ls) => ls.map((l) => (l.id === link.id ? { ...l, role } : l))); setCounts(j.counts || counts);
    } catch { /* quiet */ } finally { setBusy(false); }
  }

  async function unlink(link: Link) {
    setBusy(true);
    try {
      const j = await apiCall<{ counts?: Counts }>(`/api/admin/campaigns/lines/${lineId}/links`, { assetType: link.assetType, assetId: link.assetId }, { method: 'DELETE' });
      setLinks((ls) => ls.filter((l) => l.id !== link.id)); setCounts(j.counts || ZERO);
    } catch { /* quiet */ } finally { setBusy(false); }
  }

  const badge = (role: Role, n: number) => (
    <span style={{ fontSize: 11, fontWeight: 600, color: ROLE_TONE[role], background: 'rgba(255,255,255,0.05)', borderRadius: 999, padding: '1px 8px' }}>
      {n} {role}
    </span>
  );

  return (
    <div style={{ marginTop: 12, borderTop: '1px solid rgba(148,163,184,0.15)', paddingTop: 10 }}>
      <button
        onClick={toggle}
        style={{ background: 'none', border: 'none', color: '#cbd5e1', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: 0, display: 'inline-flex', alignItems: 'center', gap: 8 }}
        aria-expanded={open}
      >
        <span>{open ? '▾' : '▸'} Story map</span>
        {loaded && <span style={{ display: 'inline-flex', gap: 6 }}>{badge('advances', counts.advances)}{badge('reinforces', counts.reinforces)}{badge('tests', counts.tests)}</span>}
        {!loaded && <span style={{ fontSize: 11, color: '#64748b' }}>(assets advancing this story)</span>}
      </button>

      {open && (
        <div style={{ marginTop: 8 }}>
          {busy && !loaded ? (
            <div style={{ fontSize: 12, color: '#64748b' }}>Loading…</div>
          ) : links.length === 0 ? (
            <div style={{ fontSize: 12, color: '#64748b' }}>
              No assets linked yet. Spawn content or generate a commercial from this line and it lands here automatically.
            </div>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {links.map((l) => (
                <li key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: '#e2e8f0' }}>
                  <span style={{ minWidth: 150 }}>{l.assetType.replace(/_/g, ' ')} <span style={{ color: '#64748b' }}>#{l.assetId}</span></span>
                  <select
                    value={l.role}
                    onChange={(e) => setRole(l, e.target.value as Role)}
                    disabled={busy}
                    style={{ background: 'rgba(2,6,23,0.6)', border: '1px solid rgba(148,163,184,0.2)', borderRadius: 6, color: ROLE_TONE[l.role], fontSize: 11, padding: '2px 6px' }}
                  >
                    <option value="advances" style={{ color: '#000' }}>advances</option>
                    <option value="reinforces" style={{ color: '#000' }}>reinforces</option>
                    <option value="tests" style={{ color: '#000' }}>tests</option>
                  </select>
                  {l.note && <span style={{ color: '#94a3b8' }}>{l.note}</span>}
                  <button onClick={() => unlink(l)} disabled={busy} aria-label="Unlink" style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 12 }}>✕</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
