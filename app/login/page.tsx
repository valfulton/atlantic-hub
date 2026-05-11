'use client';
import { useState } from 'react';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error || 'Login failed');
        setSubmitting(false);
        return;
      }
      // Read ?next= or default to /admin.
      const params = new URLSearchParams(window.location.search);
      window.location.href = params.get('next') || '/admin';
    } catch {
      setError('Network error');
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm bg-surface border border-border rounded-2xl p-8 shadow-sm"
      >
        <h1 className="text-2xl font-semibold mb-1">Atlantic Hub</h1>
        <p className="text-sm text-muted mb-6">Operator sign in</p>

        <label className="block text-sm font-medium mb-1">Email</label>
        <input
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full mb-4 px-3 py-2 border border-border rounded-md bg-surface focus:outline-none focus:ring-2 focus:ring-brand"
        />

        <label className="block text-sm font-medium mb-1">Password</label>
        <input
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full mb-6 px-3 py-2 border border-border rounded-md bg-surface focus:outline-none focus:ring-2 focus:ring-brand"
        />

        {error && (
          <div className="text-sm text-danger mb-4" role="alert">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full py-2 rounded-md bg-brand text-brand-fg font-medium disabled:opacity-60"
        >
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
