'use client';
import { useState } from 'react';

export default function SetPasswordPage() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    if (password.length < 10) {
      setError('Password must be at least 10 characters.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/client/set-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || 'Could not set your password. Please try again.');
        setSubmitting(false);
        return;
      }
      window.location.href = '/client/dashboard';
    } catch {
      setError('Network error. Please try again.');
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-12">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md bg-surface border border-border rounded-2xl p-8 shadow-sm"
        aria-labelledby="set-pw-heading"
      >
        <div className="mb-6">
          <h1 id="set-pw-heading" className="text-2xl font-semibold text-ink">
            Set your password
          </h1>
          <p className="text-sm text-muted mt-1">
            Pick something memorable. Minimum 10 characters.
          </p>
        </div>

        <label htmlFor="password" className="block text-sm font-medium text-ink mb-1">
          New password
        </label>
        <input
          id="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full mb-4 px-3 py-2 border border-border rounded-md bg-surface-2 text-ink focus:outline-none focus:ring-2 focus:ring-brand"
        />

        <label htmlFor="confirm" className="block text-sm font-medium text-ink mb-1">
          Confirm password
        </label>
        <input
          id="confirm"
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="w-full mb-6 px-3 py-2 border border-border rounded-md bg-surface-2 text-ink focus:outline-none focus:ring-2 focus:ring-brand"
        />

        {error && (
          <div
            role="alert"
            className="mb-4 px-3 py-2 rounded-md border border-danger/40 bg-danger/10 text-danger text-sm"
          >
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full py-2 rounded-md bg-brand text-brand-fg font-medium disabled:opacity-60"
        >
          {submitting ? 'Saving...' : 'Save password and continue'}
        </button>
      </form>
    </main>
  );
}
