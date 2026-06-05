/** Searchable copy-map table (client). Links each key to its editor. */
'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { CopyMapRow } from './page';

export default function CopyMapTable({ rows }: { rows: CopyMapRow[] }) {
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const f = q.trim().toLowerCase();
    return !f ? rows : rows.filter((r) =>
      r.key.toLowerCase().includes(f) || r.def.toLowerCase().includes(f) || r.page.toLowerCase().includes(f)
    );
  }, [rows, q]);

  return (
    <div style={{ minHeight: '100vh', background: '#0B1B2D', color: '#E7ECF3', fontFamily: 'Inter, system-ui, sans-serif', padding: '20px 16px 80px' }}>
      <div style={{ maxWidth: 1040, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Copy map &amp; legend</h1>
          <Link href="/admin/av/copy" style={{ color: 'var(--gold-bright)', fontSize: 13 }}>open editor →</Link>
          <span style={{ marginLeft: 'auto', fontSize: 12, color: '#9FB0C7' }}>{list.length} of {rows.length} keys</span>
        </div>
        <p style={{ color: '#9FB0C7', fontSize: 13.5, margin: '6px 0 14px' }}>
          Every editable line, where it renders, and how many overrides exist. The answer to “where does this headline come from?”
        </p>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search key, default text, or page…"
          style={{ width: '100%', background: '#0E2236', color: '#E7ECF3', border: '1px solid rgba(255,255,255,.16)', borderRadius: 8, padding: '11px 12px', fontSize: 15, minHeight: 44 }} />

        <div style={{ marginTop: 14, border: '1px solid rgba(255,255,255,.1)', borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ ...rowS, background: 'rgba(255,255,255,.04)', fontWeight: 700, fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: '#9FB0C7' }}>
            <span style={{ flex: 2 }}>Key</span>
            <span style={{ flex: 3 }}>Default</span>
            <span style={{ flex: 1.4 }}>Page</span>
            <span style={{ width: 120, textAlign: 'right' }}>Overrides</span>
          </div>
          {list.map((r) => (
            <Link key={r.key} href={`/admin/av/copy?key=${encodeURIComponent(r.key)}`} style={{ ...rowS, textDecoration: 'none', color: 'inherit', borderTop: '1px solid rgba(255,255,255,.07)' }}>
              <code style={{ flex: 2, color: 'var(--gold-bright)', fontSize: 12 }}>{r.key}</code>
              <span style={{ flex: 3, color: '#C7D3E2', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.def}</span>
              <span style={{ flex: 1.4, color: '#9FB0C7', fontSize: 12 }}>{r.page}</span>
              <span style={{ width: 120, textAlign: 'right', fontSize: 11.5, color: '#9FB0C7' }}>
                <b style={{ color: r.g ? '#7ED3A1' : '#5A6B7E' }}>{r.g}</b> global · <b style={{ color: r.pc ? '#7ED3A1' : '#5A6B7E' }}>{r.pc}</b> client · <b style={{ color: r.ps ? '#7ED3A1' : '#5A6B7E' }}>{r.ps}</b> stage
              </span>
            </Link>
          ))}
          {!list.length && <div style={{ padding: 20, color: '#9FB0C7' }}>No keys match “{q}”.</div>}
        </div>
      </div>
    </div>
  );
}

const rowS: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px' };
