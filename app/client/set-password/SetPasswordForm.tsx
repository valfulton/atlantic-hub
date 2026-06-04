'use client';

/**
 * SetPasswordForm — client half of /client/set-password (#418).
 *
 * The server wrapper (page.tsx) fetches copy via getCopyMap() and passes it
 * through `copy`. Everything user-facing on this surface comes from there,
 * so val can edit eyebrow / headline / lede / button at /admin/av/copy.
 *
 * Two states based on `?welcome=1`:
 *   welcoming → "Welcome in." (first-landing from magic link)
 *   returning → "Set your password." (subsequent set-password visit)
 */
import { useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import RoyaleGateFrame from '@/app/client/_components/RoyaleGateFrame';
import { accent } from '@/lib/copy/accent';

export interface SetPasswordCopy {
  eyebrow: string;
  h1Welcoming: string;
  h1Returning: string;
  ledeWelcoming: string;
  ledeReturning: string;
  labelNew: string;
  labelConfirm: string;
  cta: string;
  foot: string;
}

function SetPasswordBody({ copy }: { copy: SetPasswordCopy }) {
  const params = useSearchParams();
  const welcoming = params.get('welcome') === '1';
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

  const h1 = welcoming ? copy.h1Welcoming : copy.h1Returning;
  const lede = welcoming ? copy.ledeWelcoming : copy.ledeReturning;

  return (
    <RoyaleGateFrame eyebrow={copy.eyebrow} headline={accent(h1)} lede={lede} foot={copy.foot}>
      <form onSubmit={handleSubmit} aria-labelledby="set-pw-heading">
        <div style={{ marginBottom: 14 }}>
          <label htmlFor="password" className="rg-label">{copy.labelNew}</label>
          <input
            id="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={10}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rg-input rg-input--text"
          />
        </div>
        <div style={{ marginBottom: 8 }}>
          <label htmlFor="confirm" className="rg-label">{copy.labelConfirm}</label>
          <input
            id="confirm"
            type="password"
            autoComplete="new-password"
            required
            minLength={10}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
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
          {submitting ? 'Saving…' : copy.cta}
        </button>
      </form>
    </RoyaleGateFrame>
  );
}

export default function SetPasswordForm({ copy }: { copy: SetPasswordCopy }) {
  return (
    <Suspense fallback={<div className="rg" />}>
      <SetPasswordBody copy={copy} />
    </Suspense>
  );
}
