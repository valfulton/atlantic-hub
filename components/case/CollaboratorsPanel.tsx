/**
 * components/case/CollaboratorsPanel.tsx  (val 2026-06-12, Phase 3 Wave 3)
 *
 * Operator view of who can access the case + invite-a-sibling form.
 * Each row shows email, role, parent-approval status, and acceptance status.
 * Pending invites get a "copy magic link" button so val can text/email it.
 *
 * Parent-approval gate: invite defaults to PENDING. Operator can flag a row
 * as approved after a parent says yes verbally.
 */
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface CollaboratorRowLite {
  collaboratorId: number;
  clientUserId: number;
  email: string;
  displayName: string | null;
  role: string;
  invitationAccepted: boolean;
  acceptedAt: string | null;
  parentApproved: boolean;
  revokedAt: string | null;
  magicToken: string | null;
  magicTokenExpiresAt: string | null;
}

interface Props {
  caseId: number;
  collaborators: CollaboratorRowLite[];
}

const ROLE_OPTIONS: Array<{ value: string; label: string; danger?: boolean }> = [
  { value: 'sibling_reader', label: 'Sibling — read only' },
  { value: 'sibling_commenter', label: 'Sibling — read + comment + log wellness' },
  { value: 'sibling_admin', label: 'Sibling admin — can also upload + invite' },
  { value: 'advisor', label: 'Advisor / financial' },
  { value: 'attorney', label: 'Attorney' },
  { value: 'successor_trustee', label: 'Successor trustee' },
  { value: 'primary_caregiver', label: 'Primary caregiver' }
];

function formatDate(iso: string | null): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return iso; }
}

function statusPill(c: CollaboratorRowLite): { label: string; classes: string } {
  if (c.revokedAt) return { label: 'Revoked', classes: 'border-zinc-700 text-zinc-400 bg-zinc-900/40' };
  if (!c.parentApproved) return { label: 'Pending parent approval', classes: 'border-amber-700/40 text-amber-300 bg-amber-900/20' };
  if (c.invitationAccepted) return { label: 'Active', classes: 'border-emerald-700/40 text-emerald-300 bg-emerald-900/20' };
  return { label: 'Invited · not yet logged in', classes: 'border-sky-700/40 text-sky-300 bg-sky-900/20' };
}

export default function CollaboratorsPanel({ caseId, collaborators }: Props) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState('sibling_reader');
  const [bypassParentApproval, setBypassParentApproval] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justInvitedLink, setJustInvitedLink] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setSubmitting(true); setError(null); setJustInvitedLink(null);
    try {
      const res = await fetch(`/api/admin/av/cases/${caseId}/collaborators`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          displayName: displayName.trim() || undefined,
          role,
          bypassParentApproval
        })
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        setError(data?.error || 'Invite failed');
        return;
      }
      setJustInvitedLink(data.magicLink || null);
      setEmail(''); setDisplayName(''); setRole('sibling_reader');
      setBypassParentApproval(false);
      router.refresh();
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : 'Network error');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleApprove(collaboratorId: number) {
    if (!confirm('Mark this person as parent-approved? They will be able to access the case.')) return;
    try {
      const res = await fetch(`/api/admin/av/cases/${caseId}/collaborators/${collaboratorId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'approve' })
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) { alert(data?.error || 'Approve failed'); return; }
      router.refresh();
    } catch (e) { alert(e instanceof Error ? e.message : 'Network error'); }
  }

  async function handleRevoke(collaboratorId: number) {
    if (!confirm('Revoke this person’s access to the case?')) return;
    try {
      const res = await fetch(`/api/admin/av/cases/${caseId}/collaborators/${collaboratorId}`, {
        method: 'DELETE'
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) { alert(data?.error || 'Revoke failed'); return; }
      router.refresh();
    } catch (e) { alert(e instanceof Error ? e.message : 'Network error'); }
  }

  function copyLink(link: string) {
    void navigator.clipboard.writeText(link).then(() => {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 1500);
    });
  }

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'https://atlantic-hub.netlify.app';

  return (
    <section className="rounded-xl border border-border bg-[var(--surface-2)] p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm uppercase tracking-wider text-muted">
          Family + advisors ({collaborators.length})
        </h2>
        <button
          type="button"
          onClick={() => setShowForm(!showForm)}
          className="text-xs uppercase tracking-wider px-3 py-1.5 rounded-md border border-border bg-[var(--surface-3,rgba(255,255,255,0.04))] text-ink hover:bg-[var(--surface-3,rgba(255,255,255,0.08))]"
        >
          {showForm ? 'Cancel' : '+ Invite'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleInvite} className="mb-4 p-3 rounded-lg bg-black/20 border border-border space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs">
              <span className="block text-muted uppercase tracking-wider mb-1">Email *</span>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="sibling@example.com"
                className="w-full bg-black/30 border border-border rounded px-2 py-1.5 text-sm"
              />
            </label>
            <label className="text-xs">
              <span className="block text-muted uppercase tracking-wider mb-1">Display name</span>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="First Last"
                className="w-full bg-black/30 border border-border rounded px-2 py-1.5 text-sm"
              />
            </label>
          </div>
          <label className="text-xs block">
            <span className="block text-muted uppercase tracking-wider mb-1">Role *</span>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full bg-black/30 border border-border rounded px-2 py-1.5 text-sm"
            >
              {ROLE_OPTIONS.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </label>
          <label className="text-xs flex items-start gap-2 text-amber-200 pt-1">
            <input
              type="checkbox"
              checked={bypassParentApproval}
              onChange={(e) => setBypassParentApproval(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              A parent has already verbally approved this person — skip the pending-approval gate.
              <span className="block text-muted">
                Otherwise the invite sits in <em>pending</em> state until you mark it approved.
              </span>
            </span>
          </label>
          {error && (
            <div className="text-xs text-red-300 bg-red-950/40 border border-red-700/40 rounded px-3 py-2">
              {error}
            </div>
          )}
          {justInvitedLink && (
            <div className="text-xs bg-emerald-950/40 border border-emerald-700/40 rounded px-3 py-2 space-y-2">
              <div className="text-emerald-300 uppercase tracking-wider text-[10px]">
                Invite sent · magic link below — copy and send it
              </div>
              <div className="font-mono break-all text-emerald-200">{justInvitedLink}</div>
              <button
                type="button"
                onClick={() => copyLink(justInvitedLink)}
                className="text-[10px] uppercase tracking-wider px-2 py-1 rounded border border-emerald-700/40 text-emerald-200"
              >
                {linkCopied ? 'Copied ✓' : 'Copy link'}
              </button>
            </div>
          )}
          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              disabled={submitting || !email.trim()}
              className="text-xs uppercase tracking-wider px-3 py-1.5 rounded-md bg-emerald-700 text-white disabled:opacity-50"
            >
              {submitting ? 'Inviting…' : 'Send invite'}
            </button>
          </div>
        </form>
      )}

      {collaborators.length === 0 ? (
        <div className="text-sm text-muted italic">No collaborators yet.</div>
      ) : (
        <ul className="space-y-2">
          {collaborators.map((c) => {
            const pill = statusPill(c);
            const magicLink = c.magicToken && !c.invitationAccepted
              ? `${baseUrl}/client/login?token=${c.magicToken}` : null;
            return (
              <li
                key={c.collaboratorId}
                className={`rounded-md border ${c.revokedAt ? 'border-zinc-800 bg-zinc-950/30 opacity-60' : 'border-border bg-black/15'} p-3`}
              >
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">
                      {c.displayName || c.email}
                    </div>
                    {c.displayName && (
                      <div className="text-xs text-muted">{c.email}</div>
                    )}
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <span className="text-[10px] uppercase tracking-wider text-muted">
                        {c.role.replace(/_/g, ' ')}
                      </span>
                      <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded border ${pill.classes}`}>
                        {pill.label}
                      </span>
                      {c.acceptedAt && (
                        <span className="text-[10px] text-muted">
                          accepted {formatDate(c.acceptedAt)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {!c.parentApproved && !c.revokedAt && (
                      <button
                        type="button"
                        onClick={() => handleApprove(c.collaboratorId)}
                        className="text-[10px] uppercase tracking-wider px-2 py-1 rounded border border-emerald-700/40 text-emerald-200 hover:bg-emerald-900/30"
                      >
                        Mark approved
                      </button>
                    )}
                    {magicLink && (
                      <button
                        type="button"
                        onClick={() => copyLink(magicLink)}
                        className="text-[10px] uppercase tracking-wider px-2 py-1 rounded border border-sky-700/40 text-sky-200 hover:bg-sky-900/30"
                      >
                        Copy link
                      </button>
                    )}
                    {!c.revokedAt && (
                      <button
                        type="button"
                        onClick={() => handleRevoke(c.collaboratorId)}
                        className="text-[10px] uppercase tracking-wider px-2 py-1 rounded text-red-300 hover:text-red-200 hover:underline"
                      >
                        Revoke
                      </button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
