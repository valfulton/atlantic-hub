'use client';

/**
 * AssignToClientControl — hand this lead off to a client (or back to the house
 * pipeline). Sets leads.client_id so the lead shows in the client's /client/leads.
 * Operator-only; lives in the lead detail action row.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function AssignToClientControl(props: {
  auditId: string;
  clients: { clientId: number; name: string }[];
  currentClientId: number | null;
}) {
  const router = useRouter();
  const [value, setValue] = useState<string>(props.currentClientId ? String(props.currentClientId) : '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function assign(next: string) {
    setValue(next);
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/av/leads/${props.auditId}/assign-client`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clientId: next === '' ? null : Number(next) })
      });
      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error(j?.error || 'Could not assign.');
      setMsg({ ok: true, text: next === '' ? 'Returned to house pipeline' : 'Assigned to client ✓' });
      router.refresh();
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] uppercase tracking-[0.1em] text-muted">Client</span>
      <select
        value={value}
        disabled={busy}
        onChange={(e) => assign(e.target.value)}
        className="rounded-md border border-border bg-black/30 px-2 py-1.5 text-sm text-ink disabled:opacity-50"
      >
        <option value="">— house / unassigned —</option>
        {props.clients.map((c) => (
          <option key={c.clientId} value={c.clientId}>{c.name}</option>
        ))}
      </select>
      {msg && <span className={'text-[11px] ' + (msg.ok ? 'text-emerald-300' : 'text-rose-300')}>{msg.text}</span>}
    </div>
  );
}
