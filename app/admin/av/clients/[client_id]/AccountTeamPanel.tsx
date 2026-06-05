'use client';

/**
 * AccountTeamPanel — operator panel to manage the AV employees assigned to a
 * client account. Reads + writes `/api/admin/av/clients/[id]/account-employees`
 * (and DELETEs to the sibling [user_id] route).
 *
 * Surface: a list of currently-assigned employees (name + title + role chip +
 * Remove), plus an "Add employee" row (dropdown of unassigned staff + role
 * select + Assign button).
 *
 * The corresponding CLIENT surface — "Your A&V team" on /client/dashboard —
 * picks up changes automatically via lib/client/employees_on_account.ts.
 */
import { useEffect, useMemo, useState } from 'react';

type Role = 'primary_rep' | 'rep' | 'support';

interface Assigned {
  userId: number;
  displayName: string;
  email: string | null;
  title: string | null;
  role: Role;
  assignedAt: string;
}

interface Assignable {
  userId: number;
  displayName: string;
  email: string;
  title: string | null;
}

const ROLE_LABEL: Record<Role, string> = {
  primary_rep: 'Primary rep',
  rep: 'Rep',
  support: 'Support'
};

const ROLE_TONE: Record<Role, string> = {
  // emerald for primary, gold for rep, slate for support — operator-page palette.
  primary_rep: '#34d399',
  rep: '#FFC73D',
  support: '#cbd5e1'
};

const btn: React.CSSProperties = {
  background: 'rgba(148,163,184,0.12)',
  color: '#cbd5e1',
  border: '1px solid rgba(148,163,184,0.2)',
  borderRadius: 8,
  padding: '6px 12px',
  fontSize: 12,
  cursor: 'pointer'
};
const btnPrimary: React.CSSProperties = {
  background: 'linear-gradient(120deg,#FF9C5B,#FFC73D)',
  color: '#1a1207',
  border: 'none',
  borderRadius: 8,
  padding: '6px 12px',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer'
};
const btnDanger: React.CSSProperties = {
  background: 'transparent',
  color: '#fca5a5',
  border: '1px solid rgba(252,165,165,0.3)',
  borderRadius: 6,
  padding: '4px 8px',
  fontSize: 11,
  cursor: 'pointer'
};
const sel: React.CSSProperties = {
  background: 'rgba(2,6,23,0.6)',
  border: '1px solid rgba(148,163,184,0.2)',
  borderRadius: 8,
  padding: '6px 8px',
  color: '#e2e8f0',
  fontSize: 12
};

export default function AccountTeamPanel({
  clientId,
  clientName,
  initialAssigned,
  initialAssignable
}: {
  clientId: number;
  clientName: string;
  initialAssigned: Assigned[];
  initialAssignable: Assignable[];
}) {
  const [assigned, setAssigned] = useState<Assigned[]>(initialAssigned);
  const [assignable, setAssignable] = useState<Assignable[]>(initialAssignable);
  const [pickUserId, setPickUserId] = useState<string>('');
  const [pickRole, setPickRole] = useState<Role>('rep');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Default the picker to "no one selected" whenever the list changes.
  useEffect(() => {
    if (assignable.length > 0 && !pickUserId) setPickUserId(String(assignable[0].userId));
  }, [assignable, pickUserId]);

  const hasPrimary = useMemo(() => assigned.some((a) => a.role === 'primary_rep'), [assigned]);

  async function refresh() {
    try {
      const res = await fetch(`/api/admin/av/clients/${clientId}/account-employees`);
      const j = await res.json();
      if (res.ok && j.ok) {
        setAssigned(j.assigned ?? []);
        setAssignable(j.assignable ?? []);
      }
    } catch {
      /* non-fatal */
    }
  }

  async function assign() {
    if (!pickUserId) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/av/clients/${clientId}/account-employees`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: Number(pickUserId), role: pickRole })
      });
      const j = await res.json();
      if (res.ok && j.ok) {
        setMsg(
          j.demotedPriorPrimary
            ? `Assigned. Prior primary demoted to rep.`
            : j.created
            ? 'Assigned.'
            : 'Role updated.'
        );
        setAssigned(j.assigned ?? assigned);
        await refresh();
        setPickUserId('');
      } else {
        setMsg(j.error || 'Could not assign.');
      }
    } catch {
      setMsg('Could not assign.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(userId: number) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/av/clients/${clientId}/account-employees/${userId}`, {
        method: 'DELETE'
      });
      const j = await res.json();
      if (res.ok && j.ok) {
        setMsg(j.deleted ? 'Removed.' : 'Was not assigned.');
        setAssigned(j.assigned ?? assigned.filter((a) => a.userId !== userId));
        await refresh();
      } else {
        setMsg(j.error || 'Could not remove.');
      }
    } catch {
      setMsg('Could not remove.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-4 mb-6">
      <div className="text-[11px] uppercase tracking-[0.12em] text-muted mb-3">
        Account team — A&amp;V employees on {clientName}
      </div>

      {/* Currently assigned */}
      {assigned.length === 0 ? (
        <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 12 }}>
          No one assigned yet. Pick an employee below to put them on this account.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
          {assigned.map((a) => (
            <div
              key={a.userId}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '8px 10px',
                borderRadius: 8,
                background: 'rgba(2,6,23,0.4)',
                border: '1px solid rgba(148,163,184,0.12)',
                flexWrap: 'wrap'
              }}
            >
              <span style={{ fontSize: 13, color: '#e2e8f0', fontWeight: 600 }}>{a.displayName}</span>
              {a.title && (
                <span style={{ fontSize: 11, color: '#94a3b8' }}>· {a.title}</span>
              )}
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: ROLE_TONE[a.role],
                  border: `1px solid ${ROLE_TONE[a.role]}`,
                  borderRadius: 999,
                  padding: '2px 8px'
                }}
              >
                {ROLE_LABEL[a.role]}
              </span>
              {a.email && (
                <span style={{ fontSize: 11, color: '#64748b' }}>{a.email}</span>
              )}
              <button
                type="button"
                style={{ ...btnDanger, marginLeft: 'auto' }}
                onClick={() => remove(a.userId)}
                disabled={busy}
                aria-label={`Remove ${a.displayName} from this account`}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add row */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: '#94a3b8' }}>Add:</span>
        <select
          style={sel}
          value={pickUserId}
          onChange={(e) => setPickUserId(e.target.value)}
          disabled={busy || assignable.length === 0}
        >
          {assignable.length === 0 ? (
            <option value="">No more employees available</option>
          ) : (
            assignable.map((e) => (
              <option key={e.userId} value={e.userId}>
                {e.displayName}{e.title ? ` · ${e.title}` : ''}
              </option>
            ))
          )}
        </select>
        <select
          style={sel}
          value={pickRole}
          onChange={(e) => setPickRole(e.target.value as Role)}
          disabled={busy}
        >
          <option value="primary_rep">Primary rep{hasPrimary ? ' (will replace)' : ''}</option>
          <option value="rep">Rep</option>
          <option value="support">Support</option>
        </select>
        <button
          type="button"
          style={btnPrimary}
          onClick={assign}
          disabled={busy || !pickUserId || assignable.length === 0}
        >
          {busy ? '…' : 'Assign'}
        </button>
        {msg && <span style={{ fontSize: 12, color: '#cbd5e1' }}>{msg}</span>}
      </div>

      <div style={{ fontSize: 11, color: '#64748b', marginTop: 10, lineHeight: 1.5 }}>
        Removing an employee here does not unassign their leads — use the Release leads panel below for that.
        Each brand has at most one Primary rep; promoting a new one demotes the prior holder.
      </div>
    </div>
  );
}
