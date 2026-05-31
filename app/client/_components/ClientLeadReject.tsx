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
    return <span className="text-[12px] text-emerald-300/85 italic">✓ Passed — thanks for the signal.</span>;
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
      <span className="inline-flex items-center gap-2 text-[12px]">
        <span className="text-muted">Pass on this lead?</span>
        <button
          onClick={reject}
          disabled={pending}
          // (#299) bg-brand text-black per the contrast rule (was text-brand link)
          className="px-2.5 py-1 rounded-md bg-brand text-black text-[11px] font-medium hover:opacity-90 disabled:opacity-50"
        >
          {pending ? 'Passing…' : 'Yes, pass'}
        </button>
        <button
          onClick={() => setConfirming(false)}
          className="text-[11px] text-muted/80 hover:text-ink underline-offset-2 hover:underline"
        >
          Keep it
        </button>
      </span>
    );
  }

  // (#299) Lifted from a near-invisible text-[11px] muted link to a proper
  // action chip sized to match LOG CALL / LOG EMAIL / LOG NOTE buttons so
  // Tim can actually find it on first scan. Quiet neutral until hovered;
  // turns rose on hover so it reads as a "remove" action without shouting.
  return (
    <button
      onClick={() => setConfirming(true)}
      className="text-[11px] uppercase tracking-[0.08em] font-medium px-3 py-1.5 rounded-md border border-border bg-surface text-muted hover:text-rose-200 hover:border-rose-400/40 transition-colors"
      title="Pass this lead back to Atlantic & Vine. They'll requeue it for the right client."
    >
      Not a fit
    </button>
  );
}
