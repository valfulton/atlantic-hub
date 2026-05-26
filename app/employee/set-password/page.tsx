'use client';

/**
 * /employee/set-password?token=... — PUBLIC, no-login.
 *
 * A newly-created employee opens this from their invite link, sets a password,
 * and is sent to /login. Authorized by the token (verified server-side at
 * /api/employee/set-password). Not in the middleware matcher.
 */
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';

function SetPasswordInner() {
  const token = useSearchParams().get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const validToken = /^[a-f0-9]{64}$/i.test(token);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (password.length < 10) {
      setMsg({ ok: false, text: 'Password must be at least 10 characters.' });
      return;
    }
    if (password !== confirm) {
      setMsg({ ok: false, text: 'Passwords don’t match.' });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/employee/set-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, password })
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) throw new Error(j.error || 'Could not set your password.');
      setMsg({ ok: true, text: 'Password set. Taking you to sign in…' });
      setTimeout(() => { window.location.href = '/login'; }, 1200);
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  if (!validToken) {
    return (
      <main className="max-w-lg mx-auto px-4 py-16 text-center">
        <h1 className="text-xl font-semibold text-ink">This link isn&apos;t valid</h1>
        <p className="text-sm text-muted mt-2">It may have expired. Ask Atlantic &amp; Vine for a fresh invite.</p>
      </main>
    );
  }

  const input = 'w-full rounded-lg border border-border bg-black/20 px-3 py-2 text-sm text-ink focus:outline-none focus:border-brand';

  return (
    <main className="max-w-md mx-auto px-4 py-12 sm:py-16">
      <div className="rounded-2xl border border-border bg-surface p-6">
        <div className="text-[10px] uppercase tracking-[0.18em] text-brand mb-1">Welcome to the team</div>
        <h1 className="text-2xl font-semibold text-ink">Set your password</h1>
        <p className="text-sm text-muted mt-2 leading-relaxed">
          Choose a password to access your Atlantic &amp; Vine workspace. At least 10 characters.
        </p>
        <form onSubmit={submit} className="mt-5 space-y-3">
          <label className="block">
            <span className="text-sm text-ink font-medium">New password</span>
            <input type="password" className={input} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
          </label>
          <label className="block">
            <span className="text-sm text-ink font-medium">Confirm password</span>
            <input type="password" className={input} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg px-4 py-2 text-sm font-medium"
            style={{ background: 'linear-gradient(120deg,#FF9C5B,#FFC73D)', color: '#1a1207', border: 'none' }}
          >
            {busy ? 'Setting…' : 'Set password & continue'}
          </button>
          {msg && <p className="text-xs" style={{ color: msg.ok ? '#6ee7b7' : '#fca5a5' }}>{msg.text}</p>}
        </form>
      </div>
    </main>
  );
}

export default function EmployeeSetPasswordPage() {
  return (
    <Suspense fallback={<main className="max-w-md mx-auto px-4 py-16 text-center text-sm text-muted">Loading…</main>}>
      <SetPasswordInner />
    </Suspense>
  );
}
