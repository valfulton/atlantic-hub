'use client';

/**
 * Small delete control for a commercial card in the gallery. Soft-deletes the
 * asset (archived_at) via the per-asset DELETE route, then refreshes. Owner-only
 * server-side. Used to clear expired/broken demo commercials.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function DeleteCommercialButton({ auditId, assetId }: { auditId: string; assetId: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function del(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/av/leads/${auditId}/commercial/${assetId}`, { method: 'DELETE' });
      if (res.ok || res.status === 204) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={del}
      disabled={busy}
      aria-label="Delete commercial"
      title="Delete this commercial"
      className="absolute top-2 right-2 z-10 px-2 py-1 rounded-full text-[11px] disabled:opacity-50"
      style={{ background: 'rgba(0,0,0,0.7)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.4)' }}
    >
      {busy ? '…' : 'Delete'}
    </button>
  );
}
