'use client';

/**
 * ConvertLeadToClient — the no-retype path. Search your existing leads, click
 * one, and it becomes a client carrying its own info (email, contact, company,
 * industry) — no re-typing ever. The matching lead is marked 'converted' (won)
 * server-side, and we fire a champagne-pop celebration. Lives on the Clients page.
 */
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { celebrateGoLive } from '@/lib/ui/celebrate';

type Tier = 'audit_only' | 'sprint' | 'momentum' | 'scale';

interface ConvertibleLead {
  auditId: string;
  company: string;
  contactName: string | null;
  email: string;
  industry: string | null;
  score: number | null;
  band: string | null;
}

export default function ConvertLeadToClient({ leads }: { leads: ConvertibleLead[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<ConvertibleLead | null>(null);
  const [tier, setTier] = useState<Tier>('scale');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ clientId: number | null; magicLink: string; emailSent: boolean; name: string } | null>(null);

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return leads.slice(0, 40);
    return leads
      .filter((l) =>
        l.company.toLowerCase().includes(n) ||
        (l.contactName || '').toLowerCase().includes(n) ||
        l.email.toLowerCase().includes(n) ||
        (l.industry || '').toLowerCase().includes(n))
      .slice(0, 40);
  }, [q, leads]);

  async function convert(send: boolean) {
    if (!picked) return;
    setBusy(true); setErr(null);
    try {
      const res = await fetch('/api/admin/av/clients/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: picked.email,
          name: picked.contactName || null,
          company: picked.company || null,
          industry: picked.industry || null,
          tier,
          sendInvite: send
        })
      });
      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error(j?.error || 'Could not convert.');
      celebrateGoLive(`${picked.company} is a client`);
      setDone({ clientId: j.clientId ?? null, magicLink: j.magicLink, emailSent: j.emailSent, name: picked.company });
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setPicked(null); setDone(null); setErr(null); setQ('');
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mb-5 ml-2 rounded-lg border border-border bg-black/30 hover:border-brand text-ink font-medium text-sm px-4 py-2"
      >
        Convert a lead → client
      </button>
    );
  }

  const input = 'w-full rounded-lg border border-border bg-black/30 px-3 py-2 text-sm text-ink placeholder-muted/60 focus:outline-none focus:border-brand';

  return (
    <div className="mb-6 rounded-2xl border border-border bg-surface p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="text-base font-semibold text-ink">Convert a lead → client</div>
        <button onClick={() => { setOpen(false); reset(); }} className="text-muted text-sm hover:text-ink">Close</button>
      </div>

      {done ? (
        <div className="text-sm text-ink space-y-3">
          <p>🎉 <strong>{done.name}</strong> is now a client and marked won. {done.emailSent ? 'Magic-link invite emailed.' : 'No email sent — copy the link to send when ready.'}</p>
          <div>
            <div className="text-[11px] uppercase tracking-[0.1em] text-muted mb-1">Magic link (valid 24h)</div>
            <div className="flex gap-2">
              <input className={input} readOnly value={done.magicLink} onFocusCapture={(e) => e.currentTarget.select()} />
              <button onClick={() => navigator.clipboard?.writeText(done.magicLink)} className="shrink-0 rounded-lg border border-border bg-black/30 px-3 text-sm text-ink">Copy</button>
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            {done.clientId && <a href={`/admin/av/clients/${done.clientId}`} className="rounded-lg bg-brand hover:opacity-90 text-brand-fg font-medium text-sm px-4 py-2">Open client</a>}
            <button onClick={reset} className="rounded-lg border border-border bg-black/30 px-4 py-2 text-sm text-ink">Convert another</button>
          </div>
        </div>
      ) : picked ? (
        <div className="space-y-3 text-sm">
          <p className="text-muted">
            Converting <span className="text-ink font-medium">{picked.contactName || picked.company}</span>{' '}
            (<span className="text-ink">{picked.email}</span>) — their info carries over, no retyping. Finish their brief afterward.
          </p>
          <div className="flex items-center gap-2">
            <span className="text-[11px] uppercase tracking-[0.1em] text-muted">Tier</span>
            <select className="rounded-lg border border-border bg-black/30 px-2 py-1.5 text-sm text-ink" value={tier} onChange={(e) => setTier(e.target.value as Tier)}>
              {(['audit_only', 'sprint', 'momentum', 'scale'] as Tier[]).map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <button onClick={() => setPicked(null)} className="text-xs text-muted hover:text-ink ml-1">← pick another</button>
          </div>
          {err && <div className="text-xs" style={{ color: '#fca5a5' }}>{err}</div>}
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => convert(false)} disabled={busy} className="rounded-lg bg-brand hover:opacity-90 disabled:opacity-50 text-brand-fg font-medium text-sm px-5 py-2">
              {busy ? 'Converting…' : 'Convert (save only)'}
            </button>
            <button onClick={() => convert(true)} disabled={busy} className="rounded-lg border border-border bg-black/30 hover:border-brand disabled:opacity-50 text-ink font-medium text-sm px-5 py-2">
              {busy ? 'Converting…' : 'Convert & send invite'}
            </button>
          </div>
        </div>
      ) : (
        <>
          <input className={input + ' mb-3'} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your leads by company, contact, or email…" autoFocus />
          {leads.length === 0 ? (
            <p className="text-sm text-muted">No convertible leads. Find new leads first.</p>
          ) : (
            <div className="max-h-72 overflow-y-auto divide-y divide-border border border-border rounded-lg">
              {filtered.map((l) => (
                <button key={l.auditId} onClick={() => { setPicked(l); setErr(null); }} className="w-full text-left flex items-center gap-3 px-3 py-2 hover:bg-white/5">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-ink truncate">{l.company}</div>
                    <div className="text-[11px] text-muted truncate">{l.contactName ? `${l.contactName} · ` : ''}{l.email}{l.industry ? ` · ${l.industry}` : ''}</div>
                  </div>
                  <div className="text-xs tabular-nums text-muted shrink-0">{l.score !== null ? Math.round(l.score) : '—'}{l.band ? ` ${l.band}` : ''}</div>
                </button>
              ))}
              {filtered.length === 0 && <div className="px-3 py-3 text-sm text-muted">No matches.</div>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
