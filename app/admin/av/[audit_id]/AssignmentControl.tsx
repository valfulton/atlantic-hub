'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Header control for assigning the lead to a sales rep + flagging it
 * for the owner's warm-email queue. Two clicks max from any lead detail.
 *
 *   [ Assign to ... v ]  [ Hand to Val ]
 *
 * Lists users from /api/admin/users (owner + staff only). Falls back to
 * "Assign to me" if no users endpoint data.
 */

interface User {
  userId: number;
  email: string;
  displayName: string | null;
  role: 'owner' | 'staff' | 'client_user';
}

interface Props {
  auditId: string;
  currentAssignedTo: number | null;
  currentHandedToOwnerAt: string | null;
  currentUserId: number;
  ownerUserId?: number | null;
}

export function AssignmentControl({
  auditId,
  currentAssignedTo,
  currentHandedToOwnerAt,
  currentUserId
}: Props) {
  const router = useRouter();
  const [users, setUsers] = useState<User[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/admin/users', { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setUsers(data.users || []);
      } catch {
        // fine -- dropdown will show only "me"
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const currentUser = users.find((u) => u.userId === currentAssignedTo);
  const owner = users.find((u) => u.role === 'owner');

  async function setAssignment(userId: number | null) {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/av/leads/${auditId}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignToUserId: userId })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(data.error || `HTTP ${res.status}`);
        return;
      }
      setOpen(false);
      router.refresh();
    } catch (e) {
      setErr(`Network error: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function toggleHandToOwner(value: boolean) {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/av/leads/${auditId}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handToOwner: value })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(data.error || `HTTP ${res.status}`);
        return;
      }
      router.refresh();
    } catch (e) {
      setErr(`Network error: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  const assignLabel = currentUser
    ? currentUser.displayName || currentUser.email
    : currentAssignedTo === currentUserId
    ? 'me'
    : currentAssignedTo
    ? `user #${currentAssignedTo}`
    : 'unassigned';

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          disabled={busy}
          className="px-3 py-1.5 rounded-md text-sm bg-surface border border-border hover:border-brand text-ink transition-colors inline-flex items-center gap-1.5 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          title="Assign this lead to a sales rep"
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          <span className="text-muted">Assigned:</span>
          <span>{assignLabel}</span>
          <span aria-hidden="true">{open ? 'v' : '>'}</span>
        </button>
        {open && (
          <div className="absolute right-0 top-full mt-1 z-30 min-w-[220px] bg-[#0e1420] border border-border rounded-md shadow-lg">
            <button
              type="button"
              onClick={() => setAssignment(currentUserId)}
              disabled={busy}
              className="w-full text-left px-3 py-2 text-sm hover:bg-surface text-ink"
            >
              Assign to me
            </button>
            {users
              .filter((u) => u.userId !== currentUserId)
              .map((u) => (
                <button
                  key={u.userId}
                  type="button"
                  onClick={() => setAssignment(u.userId)}
                  disabled={busy}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-surface text-ink"
                >
                  {u.displayName || u.email}{' '}
                  <span className="text-xs text-muted">({u.role})</span>
                </button>
              ))}
            <button
              type="button"
              onClick={() => setAssignment(null)}
              disabled={busy}
              className="w-full text-left px-3 py-2 text-sm hover:bg-surface text-muted border-t border-border"
            >
              Unassign
            </button>
          </div>
        )}
      </div>

      {currentHandedToOwnerAt ? (
        <button
          type="button"
          onClick={() => toggleHandToOwner(false)}
          disabled={busy}
          className="px-3 py-1.5 rounded-md text-sm bg-emerald-500/15 border border-emerald-500/40 text-emerald-200 inline-flex items-center gap-1.5 disabled:opacity-50"
          title="Click to clear -- mark this lead as no longer waiting on the owner"
        >
          <span>In owner queue</span>
          <span aria-hidden="true">x</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => toggleHandToOwner(true)}
          disabled={busy}
          className="px-3 py-1.5 rounded-md text-sm bg-surface border border-border hover:border-brand text-ink inline-flex items-center gap-1.5 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          title={owner ? `Flag this lead for ${owner.displayName || owner.email} to send the warm email` : 'Flag this lead for the owner to send the warm email'}
        >
          <span aria-hidden="true">{'->'}</span>
          <span>Hand to {owner?.displayName || 'owner'}</span>
        </button>
      )}

      {err && <span className="text-xs text-rose-300" aria-live="polite">{err}</span>}
    </div>
  );
}
