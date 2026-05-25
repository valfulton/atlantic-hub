'use client';

/**
 * ClientLeadReject — a quiet "pass on this lead" control on a client lead card.
 *
 * Clients only ever see a clean signal, so this is intentionally understated:
 * a small "Not a fit" link that, once confirmed, POSTs to /api/client/leads/reject
 * and refreshes. On success the lead returns to val's pipeline (client_id -> NULL)
 * and an event is logged so she doesn't re-hand the same one. No machinery, no
 * error noise — if it fails the control just re-enables.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

export default function ClientLeadReject({ leadId }: { leadId: number }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  if (done) {
    return <span className="text-[11px] text-muted/70 italic">Passed — thanks for the signal.</span>;
  }

  async function reject() {
    try {
      const res = await fetch('/api/client/leads/reject', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ leadId })
      });
      if (res.ok) {
        setDone(true);
        startTransition(() => router.refresh());
        return;
      }
    } catch {
      /* fall through to re-enable */
    }
    setConfirming(false);
  }

  if (confirming) {
    return (
      <span className="inline-flex items-center gap-2 text-[11px]">
        <span className="text-muted">Pass on this lead?</span>
        <button
          onClick={reject}
          disabled={pending}
          className="text-brand hover:underline disabled:opacity-50"
        >
          {pending ? 'Passing…' : 'Yes, pass'}
        </button>
        <button onClick={() => setConfirming(false)} className="text-muted/70 hover:text-ink">
          Keep
        </button>
      </span>
    );
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      className="text-[11px] text-muted/70 hover:text-ink transition-colors"
    >
      Not a fit
    </button>
  );
}
