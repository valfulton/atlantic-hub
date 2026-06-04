'use client';

/**
 * AttachLoginPanel  (#368, val 2026-06-02)
 *
 * The answer to "how do I attach a client to this account?" when val sees
 * "no user on this account" on the portal access surface. Two modes:
 *
 *   Create new — fresh email + display name + optional password
 *   Attach existing — type the email of an already-existing client_user, we
 *                     wire it to this brand via brand_members (Adriana case)
 *
 * Renders on the client page when there's no client_user directly bound AND
 * no brand_members row pointing at this brand. The panel disappears after
 * success — page reload from the parent picks up the new state.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiCall, ApiError } from '@/lib/http';

type Mode = 'create' | 'attach';

interface AttachResponse {
  ok: boolean;
  mode: Mode;
  clientUserId: number;
  email: string;
  displayName: string | null;
  /** create mode only */
  passwordSet?: boolean;
  password?: string | null;
  /** attach mode only */
  role?: 'owner' | 'rep' | 'viewer';
  message: string;
}

export default function AttachLoginPanel({
  clientId,
  clientName,
  suggestedEmail
}: {
  clientId: number;
  clientName: string;
  /** Prefill the email box from the operator's seed (e.g. the brand's contact
   *  on file). val can edit before submit. */
  suggestedEmail?: string | null;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('create');
  const [email, setEmail] = useState(suggestedEmail ?? '');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AttachResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      const data = await apiCall<AttachResponse>(
        `/api/admin/av/clients/${clientId}/attach-login`,
        {
          mode,
          email: email.trim(),
          displayName: displayName.trim() || undefined,
          // Only send password on create; attach mode ignores it server-side.
          password: mode === 'create' && password.trim().length > 0 ? password.trim() : undefined
        }
      );
      setResult(data);
      // Refresh the parent so the "no user" guard goes away.
      router.refresh();
    } catch (e) {
      if (e instanceof ApiError) {
        try {
          const body = JSON.parse(e.body) as { reason?: string; error?: string; minLength?: number };
          setErr(body.reason || (body.minLength ? `Password must be ≥ ${body.minLength} characters.` : body.error || `Failed (HTTP ${e.status})`));
        } catch {
          setErr(`Failed (HTTP ${e.status})`);
        }
      } else {
        setErr('Failed.');
      }
    } finally {
      setBusy(false);
    }
  }

  // After a successful create+password, surface the plaintext ONCE.
  if (result?.ok) {
    return (
      <div className="rounded-2xl border border-emerald-400/30 bg-emerald-400/[0.05] p-4">
        <div className="text-[11px] uppercase tracking-[0.14em] text-emerald-300 mb-1">
          {result.mode === 'create' ? 'Login created' : 'Login attached'}
        </div>
        <div className="text-sm text-ink mb-2">{result.message}</div>
        {result.mode === 'create' && result.password && (
          <div className="grid gap-1.5">
            <div className="text-[11px] text-muted">Plaintext password (shown once):</div>
            <code className="block rounded bg-black/40 border border-border px-3 py-2 font-mono text-ink select-all break-all">
              {result.password}
            </code>
            <div className="text-[11px] text-muted">
              They sign in at <span className="text-ink">/client/login</span> with {result.email}.
            </div>
          </div>
        )}
        <div className="text-[11px] text-muted mt-2">
          The Magic link + Email + password panels above are now active. Refresh if they still show the old state.
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-[#EBCB6B]/30 bg-[#EBCB6B]/[0.04] p-4">
      <div className="flex items-baseline justify-between gap-3 mb-2 flex-wrap">
        <div>
          <div className="text-[11px] uppercase tracking-[0.14em] text-[#EBCB6B]">
            Attach login to {clientName}
          </div>
          <div className="text-sm text-ink mt-0.5">
            No login is bound to this brand yet. Pick a mode below.
          </div>
        </div>
        <div className="flex items-center rounded-md border border-border bg-black/30 text-[11px] overflow-hidden shrink-0">
          <button
            type="button"
            onClick={() => setMode('create')}
            className={`px-3 py-1.5 ${mode === 'create' ? 'bg-brand text-black font-medium' : 'text-muted hover:text-ink'}`}
          >
            Create new
          </button>
          <button
            type="button"
            onClick={() => setMode('attach')}
            className={`px-3 py-1.5 ${mode === 'attach' ? 'bg-brand text-black font-medium' : 'text-muted hover:text-ink'}`}
          >
            Attach existing
          </button>
        </div>
      </div>

      <p className="text-[11px] text-muted mb-3 leading-snug">
        {mode === 'create'
          ? 'Mints a brand-new client_user bound to this brand. Use for first-time onboarding.'
          : 'Adds an existing login (e.g. an owner of another brand) to THIS brand via brand_members. Use when the same person owns multiple brands (Adriana: CBB + CLDA).'}
      </p>

      <div className="grid gap-2.5">
        <label className="grid gap-1">
          <span className="text-[10.5px] uppercase tracking-[0.12em] text-muted">Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={mode === 'attach' ? 'their existing login email' : 'them@example.com'}
            className="rounded-lg border border-border bg-black/30 px-3 py-2 text-sm text-ink"
            autoComplete="off"
          />
        </label>
        {mode === 'create' && (
          <>
            <label className="grid gap-1">
              <span className="text-[10.5px] uppercase tracking-[0.12em] text-muted">Display name (optional)</span>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Adriana Lopez"
                className="rounded-lg border border-border bg-black/30 px-3 py-2 text-sm text-ink"
                autoComplete="off"
              />
            </label>
            <label className="grid gap-1">
              <span className="text-[10.5px] uppercase tracking-[0.12em] text-muted">
                Password (optional — leave blank to use magic link only)
              </span>
              <input
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Velvet-Royale-42"
                className="rounded-lg border border-border bg-black/30 px-3 py-2 text-sm text-ink font-mono"
                autoComplete="new-password"
              />
            </label>
          </>
        )}
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <button
            type="button"
            onClick={submit}
            disabled={busy || email.trim().length === 0}
            className="rounded-lg border border-border bg-brand text-black font-medium text-sm px-4 py-2 disabled:opacity-50"
          >
            {busy
              ? 'Working…'
              : mode === 'create'
                ? 'Create login'
                : 'Attach existing'}
          </button>
          {err && <span className="text-[11px] text-danger">{err}</span>}
        </div>
      </div>
    </div>
  );
}
