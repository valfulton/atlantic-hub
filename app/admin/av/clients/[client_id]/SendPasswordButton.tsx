'use client';

/**
 * SendPasswordButton  (#45 Phase B + manual-override 2026-06-02)
 *
 * Three modes operator picks per use:
 *   1. AUTO + EMAIL  (default) -- generate temp password, email client, show plaintext once.
 *   2. MANUAL + EMAIL          -- val types the password, system emails it.
 *   3. MANUAL or AUTO, SAVE-ONLY -- set the password hash but don't email; val shares it however she wants.
 *
 * The plaintext is shown ONCE in the panel after the action; never logged.
 *
 * Error surfacing: when the API returns 404 with {error:'no_user', reason}, we
 * render the reason inline so val isn't staring at "Failed HTTP 404" with no
 * idea why. Other errors fall back to status text.
 */
import { useState } from 'react';
import { apiCall, ApiError } from '@/lib/http';

interface SendResult {
  ok: boolean;
  email: string;
  password: string;
  emailSent: boolean;
  emailError: string | null;
  sentSkipped: boolean;
  manual: boolean;
}

export default function SendPasswordButton({ clientId }: { clientId: number }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showManual, setShowManual] = useState(false);
  const [manualPwd, setManualPwd] = useState('');

  async function go(opts: { manual?: boolean; send: boolean }) {
    const confirmMsg = opts.send
      ? 'This sets a NEW password (overwrites their current one) and emails it. Continue?'
      : 'This sets a NEW password (overwrites their current one) WITHOUT emailing. You will share it yourself. Continue?';
    if (!confirm(confirmMsg)) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const data = await apiCall<SendResult>(
        `/api/admin/av/clients/${clientId}/send-password`,
        {
          password: opts.manual ? manualPwd.trim() : undefined,
          send: opts.send
        }
      );
      setResult(data);
      if (opts.manual) setManualPwd('');
    } catch (e) {
      if (e instanceof ApiError) {
        // Try to parse the structured error body for a friendly message.
        try {
          const body = JSON.parse(e.body) as { error?: string; reason?: string; minLength?: number };
          if (body.reason) {
            setError(body.reason);
          } else if (body.minLength) {
            setError(`Password must be at least ${body.minLength} characters.`);
          } else {
            setError(`Failed (HTTP ${e.status})`);
          }
        } catch {
          setError(`Failed (HTTP ${e.status})`);
        }
      } else {
        setError('Failed.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-4 mb-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[11px] uppercase tracking-[0.12em] text-muted">Email + password</div>
          <div className="text-sm text-ink mt-0.5">
            Set a password for email + password sign-in. Auto-generate or type it yourself.
          </div>
        </div>
        {!showManual ? (
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => go({ send: true })}
              disabled={busy}
              className="rounded-lg border border-border bg-brand text-black font-medium text-sm px-4 py-2 disabled:opacity-50"
            >
              {busy ? 'Working…' : 'Auto + email'}
            </button>
            <button
              type="button"
              onClick={() => setShowManual(true)}
              disabled={busy}
              className="rounded-lg border border-border bg-black/30 hover:bg-white/5 text-ink text-sm px-3 py-2 disabled:opacity-50"
            >
              Set it myself
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => { setShowManual(false); setManualPwd(''); }}
            className="text-[11px] text-muted hover:text-ink"
          >
            ← Back to auto
          </button>
        )}
      </div>

      {showManual && (
        <div className="mt-3 grid gap-2">
          <label className="text-[11px] uppercase tracking-[0.1em] text-muted">Password you choose (min 6)</label>
          <input
            type="text"
            value={manualPwd}
            onChange={(e) => setManualPwd(e.target.value)}
            placeholder="e.g. Velvet-Royale-42"
            className="rounded-lg border border-border bg-black/30 px-3 py-2 text-sm text-ink font-mono placeholder-muted/50 focus:outline-none focus:border-brand"
            disabled={busy}
            autoComplete="off"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => go({ manual: true, send: true })}
              disabled={busy || manualPwd.trim().length < 6}
              className="rounded-lg border border-border bg-brand text-black font-medium text-sm px-4 py-2 disabled:opacity-50"
            >
              {busy ? 'Working…' : 'Save + email it'}
            </button>
            <button
              type="button"
              onClick={() => go({ manual: true, send: false })}
              disabled={busy || manualPwd.trim().length < 6}
              className="rounded-lg border border-border bg-black/30 hover:bg-white/5 text-ink text-sm px-4 py-2 disabled:opacity-50"
              title="Saves the password without emailing — you share it however you want"
            >
              Save without emailing
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="text-xs text-danger mt-3 leading-relaxed">{error}</div>
      )}

      {result && (
        <div className="mt-3 grid gap-2 text-xs">
          <div className={
            result.sentSkipped
              ? 'text-muted'
              : (result.emailSent ? 'text-emerald-300' : 'text-danger')
          }>
            {result.sentSkipped
              ? `Saved. Not emailed — share it yourself with ${result.email}.`
              : (result.emailSent
                  ? `Sent to ${result.email}.`
                  : `Could not email (${result.emailError || 'unknown'}) — copy the password below and share it another way.`)}
          </div>
          <div className="text-muted">Plaintext (shown once):</div>
          <code className="block rounded bg-black/40 border border-border px-3 py-2 font-mono text-ink select-all break-all">
            {result.password}
          </code>
          <div className="text-muted">
            They sign in at <span className="text-ink">/client/login</span> with their email + this password.
          </div>
        </div>
      )}
    </div>
  );
}
