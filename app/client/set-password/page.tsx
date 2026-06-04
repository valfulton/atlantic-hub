'use client';
import { useState } from 'react';

/**
 * /client/set-password — V3. Inherits data-skin="social" (navy) from the
 * client layout; gate card register, Cormorant heading, gold-focus inputs,
 * ghost-gold submit (no solid block). Door A/B (cream vs Royale) flows from
 * the two-doors routing — see V3_spec_entry_doors.md.
 */
const inputStyle: React.CSSProperties = {
  width: '100%',
  fontSize: 16,
  padding: '12px 14px',
  background: 'rgba(255,255,255,.04)',
  border: '1px solid var(--rule)',
  borderRadius: 8,
  color: 'var(--cream)',
  outline: 'none',
  marginBottom: 14
};
const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 11,
  letterSpacing: '.14em',
  textTransform: 'uppercase',
  color: 'var(--amber-deep)',
  marginBottom: 6
};

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
    <main className="v3-wrap" style={{ maxWidth: 440, minHeight: '80vh', display: 'grid', placeItems: 'center' }}>
      <form onSubmit={handleSubmit} className="v3-card" style={{ width: '100%' }} aria-labelledby="set-pw-heading">
        <h1 id="set-pw-heading" className="v3-card__h" style={{ fontSize: 26 }}>
          Set your password.
        </h1>
        <p className="v3-card__p">Pick something memorable. Minimum 10 characters.</p>

        <label htmlFor="password" style={labelStyle}>New password</label>
        <input
          id="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={inputStyle}
        />

        <label htmlFor="confirm" style={labelStyle}>Confirm password</label>
        <input
          id="confirm"
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          style={inputStyle}
        />

        {error && (
          <div role="alert" style={{ margin: '0 0 14px', padding: '10px 12px', borderRadius: 8, border: '1px solid rgba(201,138,146,.4)', background: 'rgba(201,138,146,.08)', color: '#E3A7AD', fontSize: 14 }}>
            {error}
          </div>
        )}

        <button type="submit" disabled={submitting} className="v3-cta" style={{ width: '100%', textAlign: 'center' }}>
          {submitting ? 'Saving…' : 'Save password and continue'}
        </button>
      </form>
    </main>
  );
}
