'use client';

/**
 * StopThePresses — the global publish kill-switch control (CFO-grade, e.g. Rebecca).
 *
 * When publishing is paused, NOTHING goes out — manual single, bulk, or the
 * scheduled cron — until someone resumes it. Enforcement is server-side
 * (lib/social/publish + the publish-due cron); this is just the lever + a loud
 * banner so the whole team can see the presses are stopped.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface PauseState {
  paused: boolean;
  reason: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
}

export function StopThePresses({ initial }: { initial: PauseState }) {
  const router = useRouter();
  const [state, setState] = useState<PauseState>(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function set(paused: boolean, reason: string | null) {
    setBusy(true); setErr(null);
    try {
      const res = await fetch('/api/admin/social/publishing-pause', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ paused, reason })
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) { setErr(j.error || `Could not update (${res.status}).`); return; }
      setState({ paused: j.paused, reason: j.reason ?? null, updatedBy: j.updatedBy ?? null, updatedAt: j.updatedAt ?? null });
      router.refresh();
    } catch {
      setErr('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  function stop() {
    const reason = window.prompt('Stop the presses — optional reason (shown to the team):', '') ?? '';
    void set(true, reason.trim() || null);
  }
  function resume() {
    void set(false, null);
  }

  if (state.paused) {
    return (
      <div
        className="mb-4 rounded-xl px-4 py-3 flex items-center gap-3 flex-wrap"
        style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.45)' }}
      >
        <span style={{ fontSize: 18 }}>&#9940;</span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold" style={{ color: '#fca5a5' }}>Publishing is paused — nothing will go out.</div>
          <div className="text-[12px] text-muted">
            {state.reason ? `Reason: ${state.reason}. ` : ''}Manual posts and the scheduled publisher are both held.
          </div>
        </div>
        <button
          type="button"
          onClick={resume}
          disabled={busy}
          className="rounded-lg px-3 py-1.5 text-sm font-semibold disabled:opacity-50"
          style={{ background: '#10b981', color: '#03251b', border: '1px solid rgba(16,185,129,0.6)' }}
        >
          {busy ? 'Resuming…' : 'Resume publishing'}
        </button>
        {err && <span className="text-[12px] w-full" style={{ color: '#fca5a5' }}>{err}</span>}
      </div>
    );
  }

  return (
    <div className="mb-4 flex items-center gap-3 flex-wrap">
      <button
        type="button"
        onClick={stop}
        disabled={busy}
        title="Halts ALL publishing — manual and scheduled — until resumed"
        className="rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50"
        style={{ background: 'rgba(239,68,68,0.12)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.4)' }}
      >
        {busy ? 'Working…' : '⛔ Stop the presses'}
      </button>
      <span className="text-[12px] text-muted">Emergency hold on all publishing — manual and scheduled.</span>
      {err && <span className="text-[12px]" style={{ color: '#fca5a5' }}>{err}</span>}
    </div>
  );
}
