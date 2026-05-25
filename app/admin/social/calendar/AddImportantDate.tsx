'use client';

/**
 * AddImportantDate — compact operator control to drop a client important date
 * (birthday / busy season / launch / anniversary) onto the timeline. Annual
 * recurring (month + day) covers the common case; the row layers onto the grid
 * next to holidays. Posts to /api/admin/social/calendar/important-dates.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';

const KINDS = [
  { value: 'birthday', label: '🎂 Birthday' },
  { value: 'busy_season', label: '📈 Busy season' },
  { value: 'launch', label: '🚀 Launch' },
  { value: 'anniversary', label: '💍 Anniversary' },
  { value: 'date', label: '📌 Date' }
];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const inputStyle: React.CSSProperties = {
  background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.14)',
  borderRadius: 8, padding: '6px 8px', color: '#e2e8f0', fontSize: 12
};

export function AddImportantDate({ tenant }: { tenant: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState('birthday');
  const [month, setMonth] = useState(1);
  const [day, setDay] = useState(1);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function add() {
    if (!label.trim()) return;
    setBusy(true); setMsg(null);
    try {
      const res = await fetch('/api/admin/social/calendar/important-dates', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label: label.trim(), kind, tenant: tenant ?? 'av', recurMonth: month, recurDay: day })
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) { setMsg(j.error || `Could not add (${res.status}).`); return; }
      setLabel(''); setMsg('Added ✓');
      router.refresh();
    } catch {
      setMsg('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-[12px]"
        style={{ background: 'rgba(255,255,255,0.05)', color: '#cbd5e1', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, padding: '5px 10px' }}
      >
        + Add important date
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 mb-4 rounded-lg p-2" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)' }}>
      <input style={{ ...inputStyle, minWidth: 180 }} placeholder="e.g. Rebecca's birthday" value={label} onChange={(e) => setLabel(e.target.value)} aria-label="Important date label" />
      <select style={inputStyle} value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind">
        {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
      </select>
      <select style={inputStyle} value={month} onChange={(e) => setMonth(Number(e.target.value))} aria-label="Month">
        {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
      </select>
      <select style={inputStyle} value={day} onChange={(e) => setDay(Number(e.target.value))} aria-label="Day">
        {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d}</option>)}
      </select>
      <button type="button" onClick={() => void add()} disabled={busy || !label.trim()} className="text-[12px] font-medium" style={{ background: 'linear-gradient(120deg,#FF9C5B,#FFC73D)', color: '#1a1207', borderRadius: 8, padding: '6px 12px', opacity: busy || !label.trim() ? 0.5 : 1 }}>
        {busy ? 'Adding…' : 'Add'}
      </button>
      <button type="button" onClick={() => { setOpen(false); setMsg(null); }} className="text-[12px] text-muted hover:text-ink">Close</button>
      {msg && <span className="text-[12px]" style={{ color: msg.includes('✓') ? '#6ee7b7' : '#fca5a5' }}>{msg}</span>}
      <span className="text-[11px] text-muted w-full">Recurs every year. Shows on the grid alongside holidays.</span>
    </div>
  );
}
