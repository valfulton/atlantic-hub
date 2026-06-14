/**
 * components/access/AccessRosterPanel.tsx  (val 2026-06-12)
 *
 * The "who can log into this client" panel on /admin/av/clients/[id].
 * Replaces the SQL-from-phpMyAdmin flow val was using to find / regenerate
 * magic links for everyone attached to a client account.
 *
 * For each row:
 *   - Name + email + origin chip (primary / brand member / case collaborator)
 *   - Link status badge (active / expired / never issued)
 *   - Copy fresh link button (regenerates + copies in one shot)
 *   - Last login (when known)
 *
 * Regenerate path: clicks "Copy fresh link" → POST reissue → server returns
 * the full URL → navigator.clipboard.writeText. The OLD token is killed by
 * the same UPDATE, so accidentally clicking twice doesn't leave a stale
 * link in the wild.
 */
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface RosterEntry {
  clientUserId: number;
  email: string;
  displayName: string | null;
  origin: 'primary' | 'brand_member' | 'case_collaborator';
  contextNote: string | null;
  linkStatus: 'active' | 'expired' | 'never_issued';
  magicTokenExpiresAt: string | null;
  lastLoginAt: string | null;
  createdAt: string | null;
}

interface Props {
  clientId: number;
  initial: RosterEntry[];
}

function originLabel(o: string): string {
  switch (o) {
    case 'primary': return 'Primary login';
    case 'brand_member': return 'Brand member';
    case 'case_collaborator': return 'Case collaborator';
    default: return o;
  }
}

function originBadgeStyle(o: string) {
  switch (o) {
    case 'primary':
      return { background: 'rgba(10, 77, 60, 0.25)', color: '#6EE7B7', border: '1px solid rgba(10, 77, 60, 0.5)' };
    case 'brand_member':
      return { background: 'rgba(122, 90, 24, 0.2)', color: '#E8C25A', border: '1px solid rgba(122, 90, 24, 0.5)' };
    case 'case_collaborator':
    default:
      return { background: 'rgba(60, 80, 120, 0.25)', color: '#93C5FD', border: '1px solid rgba(60, 80, 120, 0.5)' };
  }
}

function statusBadgeStyle(s: string) {
  switch (s) {
    case 'active':
      return { background: 'rgba(10, 77, 60, 0.25)', color: '#6EE7B7' };
    case 'expired':
      return { background: 'rgba(122, 60, 60, 0.25)', color: '#FCA5A5' };
    case 'never_issued':
    default:
      return { background: 'rgba(120, 120, 120, 0.15)', color: 'var(--muted)' };
  }
}

function formatExpiry(iso: string | null): string {
  if (!iso) return 'No link issued';
  try {
    const d = new Date(iso);
    const diffMs = d.getTime() - Date.now();
    const hours = Math.round(diffMs / (1000 * 60 * 60));
    if (hours <= 0) return 'Expired';
    if (hours < 24) return `Expires in ${hours}h`;
    const days = Math.round(hours / 24);
    return `Expires in ${days}d`;
  } catch { return iso; }
}

function formatLastLogin(iso: string | null): string {
  if (!iso) return 'Never logged in';
  try {
    const d = new Date(iso);
    return 'Last login ' + d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return iso; }
}

export default function AccessRosterPanel({ clientId, initial }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<Record<number, string>>({});

  async function handleArchive(entry: RosterEntry) {
    const label = entry.displayName || entry.email;
    const ok = window.confirm(
      `Archive ${label}?\n\nThey will no longer be able to log into ANY brand. ` +
      `Their portal access dies immediately. This does NOT delete their data — ` +
      `the row stays for audit purposes — but they cannot reach the portal again ` +
      `until you create a new client_user for them.\n\nProceed?`
    );
    if (!ok) return;
    setBusy(entry.clientUserId);
    setFeedback((prev) => ({ ...prev, [entry.clientUserId]: 'archiving…' }));
    try {
      const res = await fetch(
        `/api/admin/av/clients/${clientId}/access-roster/${entry.clientUserId}/archive`,
        { method: 'POST' }
      );
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        setFeedback((prev) => ({ ...prev, [entry.clientUserId]: data?.error || 'archive failed' }));
        return;
      }
      setFeedback((prev) => ({ ...prev, [entry.clientUserId]: 'archived · login killed' }));
      router.refresh();
    } catch (e) {
      setFeedback((prev) => ({
        ...prev,
        [entry.clientUserId]: e instanceof Error ? e.message : 'network error'
      }));
    } finally {
      setBusy(null);
    }
  }

  async function handleCopyFreshLink(entry: RosterEntry) {
    setBusy(entry.clientUserId);
    setFeedback((prev) => ({ ...prev, [entry.clientUserId]: 'minting…' }));
    try {
      const res = await fetch(
        `/api/admin/av/clients/${clientId}/access-roster/${entry.clientUserId}/reissue-link`,
        { method: 'POST' }
      );
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        setFeedback((prev) => ({ ...prev, [entry.clientUserId]: data?.error || 'mint failed' }));
        return;
      }
      const url: string = data.magicLinkUrl;
      try {
        await navigator.clipboard.writeText(url);
        setFeedback((prev) => ({ ...prev, [entry.clientUserId]: 'copied · old link killed' }));
      } catch {
        // Clipboard blocked; still show the URL inline.
        setFeedback((prev) => ({ ...prev, [entry.clientUserId]: url }));
      }
      // Re-fetch the page so the row's expiry / status badges refresh.
      router.refresh();
    } catch (e) {
      setFeedback((prev) => ({
        ...prev,
        [entry.clientUserId]: e instanceof Error ? e.message : 'network error'
      }));
    } finally {
      setBusy(null);
    }
  }

  if (initial.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-surface p-5 mb-6">
        <div className="text-[11px] uppercase tracking-[0.14em] text-ink/70 mb-2">Access roster</div>
        <div className="text-sm text-muted italic">
          No client_users attached to this client yet. Use the "Send access" panel above to invite one.
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-surface mb-6 overflow-hidden">
      <div className="px-4 py-3.5 border-b border-white/[0.06]">
        <div className="text-[11px] uppercase tracking-[0.14em] text-ink/70">Access roster</div>
        <div className="text-sm text-ink mt-0.5">
          Everyone who can log into this client · {initial.length} {initial.length === 1 ? 'login' : 'logins'}
        </div>
      </div>
      <ul className="divide-y divide-white/[0.05]">
        {initial.map((e) => (
          <li key={`${e.clientUserId}-${e.origin}`} className="px-4 py-3 flex items-start gap-3 flex-wrap">
            <div className="flex-1 min-w-[200px]">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium text-ink">
                  {e.displayName || e.email}
                </span>
                <span
                  className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-md"
                  style={originBadgeStyle(e.origin)}
                >
                  {originLabel(e.origin)}
                </span>
                {e.contextNote && (
                  <span className="text-[10px] uppercase tracking-wider text-muted">
                    {e.contextNote.replace(/_/g, ' ')}
                  </span>
                )}
              </div>
              <div className="text-xs text-muted mt-0.5">
                {e.email}
              </div>
              <div className="text-[11px] text-muted mt-1 flex items-center gap-2 flex-wrap">
                <span
                  className="px-1.5 py-0.5 rounded uppercase tracking-wider text-[9px]"
                  style={statusBadgeStyle(e.linkStatus)}
                >
                  {e.linkStatus === 'never_issued' ? 'no link' : e.linkStatus}
                </span>
                <span>{formatExpiry(e.magicTokenExpiresAt)}</span>
                <span>· {formatLastLogin(e.lastLoginAt)}</span>
              </div>
              {feedback[e.clientUserId] && (
                <div className="text-[11px] mt-1 text-emerald-300 break-all">
                  {feedback[e.clientUserId]}
                </div>
              )}
            </div>
            <div className="flex flex-col gap-1 items-end shrink-0">
              <button
                type="button"
                onClick={() => handleCopyFreshLink(e)}
                disabled={busy === e.clientUserId}
                className="text-[11px] uppercase tracking-wider px-3 py-1.5 rounded-md bg-emerald-700 text-white disabled:opacity-50"
                title="Mint a new 24h link and copy it. Old link is killed immediately."
              >
                {busy === e.clientUserId ? 'Working…' : 'Copy fresh link'}
              </button>
              <button
                type="button"
                onClick={() => handleArchive(e)}
                disabled={busy === e.clientUserId}
                className="text-[10px] uppercase tracking-wider text-red-300 hover:text-red-200 hover:underline disabled:opacity-50"
                title="Permanently kill this login. They lose portal access to every brand."
              >
                Archive login
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
