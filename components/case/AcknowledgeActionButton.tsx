'use client';

/**
 * AcknowledgeActionButton  (val 2026-06-15, #694)
 *
 * Family-side "Got it" tap on a case action item. Hits the acknowledge
 * endpoint, toggles local state optimistically, then calls router.refresh()
 * so the progress strip + parent counts update.
 *
 * Two visual states:
 *   not acknowledged: ghost emerald outline · "Got it"
 *   acknowledged:     filled emerald with check · "Got it · {firstName}"
 *                     (clicking again clears, so it's recoverable)
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  caseId: number;
  actionId: number;
  /** ISO timestamp of when this was acknowledged, or null. */
  acknowledgedAt: string | null;
  /** Display name of the person who acknowledged it, for the chip. */
  acknowledgedByName?: string | null;
}

export default function AcknowledgeActionButton({
  caseId,
  actionId,
  acknowledgedAt,
  acknowledgedByName
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [localAcked, setLocalAcked] = useState<boolean>(acknowledgedAt != null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setBusy(true);
    setError(null);
    // Optimistic flip — server will return the canonical state.
    const next = !localAcked;
    setLocalAcked(next);
    try {
      const res = await fetch(
        `/api/admin/av/cases/${caseId}/actions/${actionId}/acknowledge`,
        { method: 'POST' }
      );
      const j = await res.json();
      if (!res.ok || !j.ok) {
        // Roll back the optimistic flip.
        setLocalAcked(!next);
        throw new Error(j.error || 'failed');
      }
      // Server told us the actual state — trust it.
      setLocalAcked(Boolean(j.acknowledged));
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'network error');
    } finally {
      setBusy(false);
    }
  }

  // Pick a first-name for the chip.
  const firstName = acknowledgedByName
    ? acknowledgedByName.split(/\s+/)[0]
    : null;

  if (localAcked) {
    return (
      <button
        type="button"
        onClick={toggle}
        disabled={busy || isPending}
        title="Tap again to clear"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          background: 'var(--emerald-deep, #0A4D3C)',
          color: '#fff',
          border: '1px solid var(--emerald-deep, #0A4D3C)',
          borderRadius: 999,
          padding: '4px 12px',
          fontSize: 12,
          fontWeight: 600,
          cursor: busy ? 'wait' : 'pointer',
          opacity: busy ? 0.6 : 1,
          transition: 'opacity 0.15s ease'
        }}
      >
        <span aria-hidden="true">✓</span>
        Got it{firstName ? ` · ${firstName}` : ''}
      </button>
    );
  }

  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
      <button
        type="button"
        onClick={toggle}
        disabled={busy || isPending}
        title="Mark that you've read and understand this. You can always tap again to clear."
        style={{
          background: 'transparent',
          color: 'var(--emerald-deep, #0A4D3C)',
          border: '1px solid var(--emerald-deep, #0A4D3C)',
          borderRadius: 999,
          padding: '4px 12px',
          fontSize: 12,
          fontWeight: 600,
          cursor: busy ? 'wait' : 'pointer',
          opacity: busy ? 0.6 : 1,
          transition: 'background 0.15s ease, color 0.15s ease'
        }}
      >
        Got it
      </button>
      {error && (
        <span style={{ fontSize: 10, color: '#A23B2E' }}>{error}</span>
      )}
    </div>
  );
}
