'use client';

/**
 * NewEmployeeForm — operator creates an employee (sales rep). Returns a
 * set-password invite link to copy and send; the employee sets their own
 * password and logs in. No external form, no honeypot — clean in-hub flow.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function NewEmployeeForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [invite, setInvite] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setInvite(null);
    if (!email.trim()) { setErr('Email is required.'); return; }
    setBusy(true);
    try {
      const res = await fetch('/api/admin/av/employees/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), name: name.trim() || undefined, title: title.trim() || undefined })
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) {
        throw new Error(j.detail ? `${j.error} (${j.detail})` : (j.error || 'Could not create employee.'));
      }
      setInvite(j.inviteUrl);
      setEmail(''); setName(''); setTitle('');
      router.refresh();
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const input = 'w-full rounded-lg border border-border bg-black/20 px-3 py-2 text-sm text-ink focus:outline-none focus:border-brand';

  return (
    <div className="rounded-2xl border border-border bg-surface p-4 mb-6">
      <div className="text-[11px] uppercase tracking-[0.12em] text-muted mb-2">Add an employee / sales rep</div>
      <form onSubmit={submit} className="grid sm:grid-cols-3 gap-3 items-end">
        <label className="block">
          <span className="text-xs text-muted">Email</span>
          <input className={input} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="rep@example.com" />
        </label>
        <label className="block">
          <span className="text-xs text-muted">Name</span>
          <input className={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Rebecca Johnson" />
        </label>
        <label className="block">
          <span className="text-xs text-muted">Title (optional)</span>
          <input className={input} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Sales rep" />
        </label>
        <div className="sm:col-span-3">
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg px-4 py-2 text-sm font-medium"
            style={{ background: 'linear-gradient(120deg,#FF9C5B,#FFC73D)', color: '#1a1207', border: 'none' }}
          >
            {busy ? 'Creating…' : 'Create employee'}
          </button>
          {err && <span className="text-xs ml-3" style={{ color: '#fca5a5' }}>{err}</span>}
        </div>
      </form>

      {invite && (
        <div className="mt-3 rounded-lg border border-border bg-black/20 p-3">
          <div className="text-[11px] uppercase tracking-[0.12em] text-muted mb-1">Invite link — send this to them to set their password</div>
          <div className="flex gap-2">
            <input readOnly value={invite} onFocus={(e) => e.currentTarget.select()} className={input} />
            <button
              onClick={() => { navigator.clipboard?.writeText(invite); setCopied(true); }}
              className="shrink-0 rounded-lg px-3 text-sm font-medium"
              style={{ background: 'linear-gradient(120deg,#FF9C5B,#FFC73D)', color: '#1a1207', border: 'none' }}
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
