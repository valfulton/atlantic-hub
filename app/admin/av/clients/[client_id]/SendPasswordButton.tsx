'use client';

/**
 * SendPasswordButton  (#45 Phase B)
 *
 * Operator-side alternative to the magic-link button: generates a temp
 * password, hashes it on the client_users row, emails the plaintext to the
 * client. Plaintext is also returned once so val can copy it for a verbal
 * handoff. Confirmation prompt because it overwrites any existing password.
 */
import { useState } from 'react';
import { apiCall, ApiError } from '@/lib/http';

interface SendResult {
  ok: boolean;
  email: string;
  password: string;
  emailSent: boolean;
  emailError: string | null;
}

export default function SendPasswordButton({ clientId }: { clientId: number }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    if (!confirm('This generates a NEW password and overwrites their current one. Email it now?')) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const data = await apiCall<SendResult>(
        `/api/admin/av/clients/${clientId}/send-password`,
        {}
      );
      setResult(data);
    } catch (e) {
      setError(e instanceof ApiError ? `Failed (HTTP ${e.status})` : 'Failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-4 mb-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.12em] text-muted">Email + password</div>
          <div className="text-sm text-ink mt-0.5">
            Send the client a temp password for email + password sign-in (alternative to magic link).
          </div>
        </div>
        <button
          type="button"
          onClick={go}
          disabled={busy}
          className="shrink-0 rounded-lg border border-border bg-black/30 hover:bg-white/5 text-ink text-sm px-4 py-2 disabled:opacity-50"
        >
          {busy ? 'Sending…' : 'Send password'}
        </button>
      </div>
      {error && <div className="text-xs text-danger mt-2">{error}</div>}
      {result && (
        <div className="mt-3 text-xs">
          <div className={result.emailSent ? 'text-emerald-300' : 'text-danger'}>
            {result.emailSent ? `Sent to ${result.email}.` : `Could not email: ${result.emailError || 'unknown'} — copy the password below and share it another way.`}
          </div>
          <div className="mt-1 text-muted">Plaintext (shown once):</div>
          <code className="block mt-1 rounded bg-black/40 border border-border px-3 py-2 font-mono text-ink select-all">
            {result.password}
          </code>
          <div className="mt-1 text-muted">They sign in at <span className="text-ink">/client/login</span> with their email + this password.</div>
        </div>
      )}
    </div>
  );
}
