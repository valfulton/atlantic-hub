'use client';

/**
 * ArchiveLeadButton — soft-delete a lead (sets archived_at via the lead PATCH).
 * Confirms first (it disappears from pipelines), then returns to the leads list.
 * For clearing strays / mis-assignments without touching the DB.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function ArchiveLeadButton({ auditId }: { auditId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function archive() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/av/leads/${auditId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ archived: true })
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(j.error || 'Could not delete.'); setBusy(false); return; }
      router.push('/admin/av');
    } catch {
      setErr('Could not delete.');
      setBusy(false);
    }
  }

  if (confirming) {
    return (
      <span className="inline-flex items-center gap-2 text-xs">
        <span className="text-muted">Delete this lead?</span>
        <button onClick={archive} disabled={busy} className="rounded-md px-2 py-1 text-xs font-medium" style={{ background: 'rgba(239,68,68,0.16)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.4)' }}>
          {busy ? 'Deleting…' : 'Yes, delete'}
        </button>
        <button onClick={() => setConfirming(false)} disabled={busy} className="text-muted hover:text-ink">Keep</button>
        {err && <span style={{ color: '#fca5a5' }}>{err}</span>}
      </span>
    );
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      title="Archive (soft-delete) this lead — removes it from pipelines"
      className="rounded-md px-2.5 py-1.5 text-xs"
      style={{ background: 'transparent', color: '#94a3b8', border: '1px solid rgba(148,163,184,0.3)' }}
    >
      Delete lead
    </button>
  );
}
