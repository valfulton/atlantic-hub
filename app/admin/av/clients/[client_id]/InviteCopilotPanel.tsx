'use client';

/**
 * InviteCopilotPanel  (Spinoff B — "Invite co-pilot")
 *
 * Lets the operator add a SECOND login to a brand so two people (e.g. Kevin +
 * Maile Lyons on The Flame) each sign in with their own email and see the SAME
 * brand. Shows the current roster of logins on the brand, an "Invite co-pilot"
 * form (email + optional name + "email it to them"), and the resulting magic
 * link to copy.
 *
 * Co-pilots are full client_users with full access — there is no separate
 * "co-pilot role". The joint nature is brand-level: both see everything, both
 * get notifications, and either one's approval counts (joint authority).
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiCall, ApiError } from '@/lib/http';

export interface CopilotRosterEntry {
  email: string;
  displayName: string | null;
  tier: string;
  lastLoginAt: string | null;
}

interface InviteResponse {
  ok: boolean;
  mode?: 'created' | 'reissued';
  clientUserId?: number;
  email?: string;
  displayName?: string | null;
  magicLink?: string;
  expiresInHours?: number;
  emailSent?: boolean;
}

export default function InviteCopilotPanel({
  clientId,
  clientName,
  existing
}: {
  clientId: number;
  clientName: string;
  /** Logins already on this brand (from d.members). Drives the roster. */
  existing: CopilotRosterEntry[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [sendEmail, setSendEmail] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<InviteResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const isJoint = existing.length >= 2;

  async function submit() {
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      const data = await apiCall<InviteResponse>(
        `/api/admin/av/clients/${clientId}/copilots/invite`,
        {
          email: email.trim(),
          displayName: displayName.trim() || undefined,
          send: sendEmail
        }
      );
      setResult(data);
      setEmail('');
      setDisplayName('');
      // Refresh the parent so the roster picks up the new co-pilot.
      router.refresh();
    } catch (e) {
      if (e instanceof ApiError) {
        try {
          const b = JSON.parse(e.body) as { reason?: string; error?: string };
          setErr(b.reason || b.error || `Failed (HTTP ${e.status})`);
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

  function copy() {
    if (result?.magicLink) {
      navigator.clipboard?.writeText(result.magicLink);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-4 mb-6">
      <div className="flex items-baseline justify-between gap-3 mb-3 flex-wrap">
        <div>
          <div className="text-[11px] uppercase tracking-[0.14em] text-muted">Co-pilots on {clientName}</div>
          <div className="text-sm text-ink mt-0.5">
            {existing.length === 0
              ? 'No logins on this brand yet.'
              : existing.length === 1
                ? 'One login. Add a co-pilot so a partner can sign in with their own email.'
                : `${existing.length} logins share this brand.`}
          </div>
        </div>
        {isJoint && (
          <span
            className="text-[10px] uppercase tracking-[0.12em] shrink-0 rounded px-2 py-1"
            style={{ background: 'rgba(110,231,183,0.10)', color: '#86efac', border: '1px solid rgba(110,231,183,0.25)' }}
            title="Two or more people share this brand. Both get all notifications; either one's approval counts."
          >
            Joint authority
          </span>
        )}
      </div>

      {/* Current roster */}
      {existing.length > 0 && (
        <ul className="mb-3 space-y-1.5">
          {existing.map((m, i) => (
            <li key={m.email} className="text-sm flex items-baseline gap-2 flex-wrap">
              <span className="text-ink">{m.displayName || m.email}</span>
              <span className="text-muted text-xs">
                {m.displayName ? `· ${m.email}` : ''}
                {i === 0 ? ' · owner' : ' · co-pilot'}
                {m.lastLoginAt ? ` · last in ${m.lastLoginAt.slice(0, 10)}` : ' · never signed in'}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* Success state — surface the magic link to copy/share. */}
      {result?.ok && result.magicLink && (
        <div
          className="rounded-xl p-3 mb-3"
          style={{ background: 'rgba(110,231,183,0.07)', border: '1px solid rgba(110,231,183,0.25)' }}
        >
          <div className="text-[11px] uppercase tracking-[0.12em] mb-1" style={{ color: '#86efac' }}>
            {result.mode === 'reissued' ? 'Fresh link issued' : 'Co-pilot invited'}
          </div>
          <div className="text-sm text-ink mb-2">
            {result.displayName || result.email} can now sign in to {clientName}.
            {result.emailSent
              ? ' We emailed them the sign-in link.'
              : ' Copy their one-time sign-in link below.'}
          </div>
          <div className="flex gap-2">
            <input
              readOnly
              value={result.magicLink}
              onFocus={(e) => e.currentTarget.select()}
              className="w-full rounded-lg border border-border bg-black/30 px-3 py-2 text-sm text-ink"
            />
            <button
              onClick={copy}
              className="shrink-0 rounded-lg border border-border bg-black/30 px-3 text-sm text-ink hover:border-brand"
            >
              {copied ? '✓ Copied' : 'Copy'}
            </button>
          </div>
          <div className="text-[11px] text-muted mt-1.5">
            Valid {result.expiresInHours ?? 24}h · single-use. They sign in at /client/login.
          </div>
        </div>
      )}

      {/* Invite form (toggle) */}
      {!open ? (
        <button
          type="button"
          onClick={() => { setOpen(true); setResult(null); }}
          className="text-brand hover:underline text-sm"
        >
          + Invite co-pilot →
        </button>
      ) : (
        <div className="grid gap-2.5 rounded-xl border border-border bg-black/20 p-3">
          <label className="grid gap-1">
            <span className="text-[10.5px] uppercase tracking-[0.12em] text-muted">Their email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="maile@theflame.com"
              className="rounded-lg border border-border bg-black/30 px-3 py-2 text-sm text-ink"
              autoComplete="off"
            />
          </label>
          <label className="grid gap-1">
            <span className="text-[10.5px] uppercase tracking-[0.12em] text-muted">Display name (optional)</span>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Maile Lyons"
              className="rounded-lg border border-border bg-black/30 px-3 py-2 text-sm text-ink"
              autoComplete="off"
            />
          </label>
          <label className="flex items-center gap-2 text-[12px] text-muted">
            <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} />
            Email the sign-in link to them
          </label>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <button
              type="button"
              onClick={submit}
              disabled={busy || email.trim().length === 0}
              className="rounded-lg border border-border bg-brand text-black font-medium text-sm px-4 py-2 disabled:opacity-50"
            >
              {busy ? 'Inviting…' : 'Send invite'}
            </button>
            <button
              type="button"
              onClick={() => { setOpen(false); setErr(null); }}
              className="text-xs text-muted hover:text-ink underline"
            >
              Cancel
            </button>
            {err && <span className="text-[11px] text-danger">{err}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
