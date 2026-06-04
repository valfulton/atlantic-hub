'use client';

/**
 * OperatorLoginForm — client half of /login (#418).
 *
 * Wears the Velvet Royale gate aesthetic for parity with /client/login Door B.
 * All user-visible text comes from props (fetched server-side via getCopyMap).
 */
import { useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import RoyaleGateFrame from '@/app/client/_components/RoyaleGateFrame';
import { accent } from '@/lib/copy/accent';

export interface OperatorLoginCopy {
  eyebrow: string;
  h1: string;
  lede: string;
  labelEmail: string;
  labelPassword: string;
  cta: string;
  foot: string;
}

function LoginBody({ copy }: { copy: OperatorLoginCopy }) {
  const params = useSearchParams();
  const nextHref = params.get('next') || '/admin';

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
        setError(j.error || 'Could not sign in. Please try again.');
        setSubmitting(false);
        return;
      }
      window.location.href = nextHref;
    } catch {
      setError('Network error. Please try again.');
      setSubmitting(false);
    }
  }

  return (
    <RoyaleGateFrame
      eyebrow={copy.eyebrow}
      headline={accent(copy.h1)}
      lede={copy.lede}
      foot={copy.foot}
    >
      <form onSubmit={handleSubmit} aria-labelledby="operator-login-heading">
        <div style={{ marginBottom: 14 }}>
          <label htmlFor="op-email" className="rg-label">{copy.labelEmail}</label>
          <input
            id="op-email"
            type="email"
            name="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rg-input rg-input--text"
          />
        </div>
        <div style={{ marginBottom: 8 }}>
          <label htmlFor="op-password" className="rg-label">{copy.labelPassword}</label>
          <input
            id="op-password"
            type="password"
            name="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rg-input rg-input--text"
          />
        </div>
        {error && <div role="alert" className="rg-error">{error}</div>}
        <button
          type="submit"
          disabled={submitting}
          className="rg-cta rg-cta--block"
          style={{ marginTop: 18 }}
        >
          {submitting ? 'Signing in…' : copy.cta}
        </button>
      </form>
    </RoyaleGateFrame>
  );
}

export default function OperatorLoginForm({ copy }: { copy: OperatorLoginCopy }) {
  return (
    <Suspense fallback={<div className="rg" />}>
      <LoginBody copy={copy} />
    </Suspense>
  );
}
