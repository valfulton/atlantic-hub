'use client';

/**
 * ExtractIntelButton — operator action that turns this client's intake into
 * canonical intelligence_objects (one visible-prompt LLM pass). Button-driven so
 * val controls spend; shows what was extracted so the result is legible.
 */
import { useState } from 'react';

export default function ExtractIntelButton({ clientId }: { clientId: number }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [tone, setTone] = useState<'ok' | 'info' | 'err'>('info');

  async function run() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/av/clients/${clientId}/extract-intel`, { method: 'POST' });
      const j = await res.json();
      if (!res.ok) { setTone('err'); setMsg(j.error || 'Extraction failed.'); return; }
      if (j.reason === 'no_intake') {
        setTone('info');
        setMsg('No intake answers to work from yet — fill the creative brief / have them complete intake first.');
      } else if (!j.written) {
        setTone('info');
        setMsg('Ran, but found nothing solid enough to extract. Add more intake detail and try again.');
      } else {
        setTone('ok');
        setMsg(`Extracted ${j.written} intelligence object${j.written === 1 ? '' : 's'}: ${(j.objectTypes || []).join(', ')}.`);
      }
    } catch {
      setTone('err');
      setMsg('Extraction failed.');
    } finally {
      setBusy(false);
    }
  }

  const color = tone === 'ok' ? '#6ee7b7' : tone === 'err' ? '#fca5a5' : '#bfdbfe';

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <button
        onClick={run}
        disabled={busy}
        title="Turn this client's intake answers into reusable intelligence the PR engine + narrative lines use"
        style={{
          background: 'rgba(255,156,91,0.16)', color: '#FFD9BE',
          border: '1px solid rgba(255,156,91,0.35)', borderRadius: 8,
          padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', opacity: busy ? 0.6 : 1
        }}
      >
        {busy ? 'Extracting…' : '✦ Extract intelligence from intake'}
      </button>
      {msg && <span style={{ fontSize: 12, color }}>{msg}</span>}
    </span>
  );
}
