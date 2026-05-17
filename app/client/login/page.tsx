'use client';
import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

const ERROR_MESSAGES: Record<string, string> = {
  link_invalid_or_expired:
    "That magic link is no longer valid. Submit the intake form again or use your password below.",
  invalid_link:
    "That magic link is no longer valid. Submit the intake form again or use your password below.",
  server_error: 'Something went wrong on our end. Please try again in a moment.',
  something_went_wrong: 'Something went wrong on our end. Please try again in a moment.'
};

function LoginForm() {
  const params = useSearchParams();
  const initialError = params.get('error');
  const next = params.get('next') || '/client/dashboard';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(
    initialError ? ERROR_MESSAGES[initialError] ?? 'Could not sign in. Please try again.' : null
  );
  const [submitting, setSubmitting] = useState(false);

  // Clear the URL error param once we have it in state, so a refresh doesn't repeat it.
  useEffect(() => {
    if (initialError && typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.delete('error');
      window.history.replaceState({}, '', url.toString());
    }
  }, [initialError]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/client/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || 'Could not sign in. Please try again.');
        setSubmitting(false);
        return;
      }
      window.location.href = next;
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
        aria-labelledby="login-heading"
      >
        <div className="mb-6">
          <h1 id="login-heading" className="text-2xl font-semibold text-ink">
            Atlantic &amp; Vine
          </h1>
          <p className="text-sm text-muted mt-1">Client portal sign in</p>
        </div>

        <label htmlFor="email" className="block text-sm font-medium text-ink mb-1">
          Email
        </label>
        <input
          id="email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full mb-4 px-3 py-2 border border-border rounded-md bg-surface-2 text-ink focus:outline-none focus:ring-2 focus:ring-brand"
        />

        <label htmlFor="password" className="block text-sm font-medium text-ink mb-1">
          Password
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
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
          {submitting ? 'Signing in...' : 'Sign in'}
        </button>

        <p className="mt-6 text-xs text-muted text-center">
          First time here? Submit the intake form on{' '}
          <a
            href="https://atlanticandvine.netlify.app/#client-intake"
            className="text-brand hover:underline"
          >
            atlanticandvine.com
          </a>{' '}
          and we&apos;ll send you a secure link.
        </p>
      </form>
    </main>
  );
}

export default function ClientLoginPage() {
  return (
    <Suspense fallback={<main className="min-h-screen flex items-center justify-center" />}>
      <LoginForm />
    </Suspense>
  );
}
