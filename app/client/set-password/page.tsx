'use client';

/**
 * /client/set-password — first landing for a magic-link recipient who
 * hasn't set a password yet (Adriana on her first click).
 *
 * Wears the Royale Gate aesthetic — obsidian + Aurum gold + Cormorant.
 * Driven by RoyaleGateFrame + royale-gate.css; no hex literals here.
 */
import { useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import RoyaleGateFrame from '@/app/client/_components/RoyaleGateFrame';

function SetPasswordBody() {
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

  const headline = welcoming ? <>Welcome <em>in</em>.</> : <>Set your <em>password</em>.</>;
  const lede = welcoming
    ? 'Choose a password to finish setting up your account. Ten characters or more.'
    : 'Choose a password. Ten characters or more.';

  return (
    <RoyaleGateFrame eyebrow="A private growth practice" headline={headline} lede={lede}>
      <form onSubmit={handleSubmit} aria-labelledby="set-pw-heading">
        <div style={{ marginBottom: 14 }}>
          <label htmlFor="password" className="rg-label">New password</label>
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
          <label htmlFor="confirm" className="rg-label">Confirm password</label>
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
          {submitting ? 'Saving…' : 'Enter'}
        </button>
      </form>
    </RoyaleGateFrame>
  );
}

export default function SetPasswordPage() {
  return (
    <Suspense fallback={<div className="rg" />}>
      <SetPasswordBody />
    </Suspense>
  );
}
