/**
 * /admin/av/ic-applications — operator-only inbox for IC applications.
 *
 * Every /client/dashboard surfaces an "Earn with A&V" card linking to
 * /client/apply. Submitted applications land in ic_applications and show
 * here. val reviews + approves; approval is a separate workflow (links to
 * the existing /admin/av/employees/[user_id] employee surface).
 */
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { listIcApplications } from '@/lib/ic/applications';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function relTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function statusChipStyle(s: string): React.CSSProperties {
  const base: React.CSSProperties = {
    display: 'inline-block', padding: '3px 9px', borderRadius: 999,
    fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase',
    fontWeight: 700
  };
  if (s === 'approved') return { ...base, background: 'rgba(10,77,60,0.10)', color: 'var(--emerald-deep, #0A4D3C)' };
  if (s === 'declined') return { ...base, background: 'rgba(162,59,46,0.10)', color: 'var(--garnet, #A23B2E)' };
  if (s === 'revoked')  return { ...base, background: 'rgba(60,60,60,0.10)', color: '#3B4944' };
  // pending
  return { ...base, background: 'rgba(122,90,24,0.10)', color: 'var(--gold-deep, #7A5A18)' };
}

export default async function IcApplicationsPage() {
  const role = headers().get('x-ah-user-role') as 'owner' | 'staff' | 'client_user' | null;
  if (role === 'client_user') redirect('/admin');

  let rows: Awaited<ReturnType<typeof listIcApplications>> = [];
  let loadError: string | null = null;
  try {
    rows = await listIcApplications({ limit: 200 });
  } catch (e) {
    loadError = e instanceof Error ? e.message : 'load failed';
  }

  const pendingCount = rows.filter((r) => r.status === 'pending').length;

  return (
    <div style={{ maxWidth: 1100 }}>
      <h1 style={{ fontSize: 24, fontWeight: 600, color: 'var(--ink, #14201B)', margin: '0 0 4px' }}>
        Independent Contractor applications
      </h1>
      <p style={{ fontSize: 13, color: 'var(--muted, #5C6862)', margin: '0 0 18px' }}>
        Every client account can apply from their dashboard's "Earn with A&V"
        card. Approved applicants get linked to an employee account so they can
        pick up leads + earn commission.
        {pendingCount > 0 && (
          <span style={{ marginLeft: 12, color: 'var(--gold-deep, #7A5A18)', fontWeight: 600 }}>
            {pendingCount} pending
          </span>
        )}
      </p>

      {loadError && (
        <div style={{
          background: 'rgba(162,59,46,0.06)',
          border: '1px solid rgba(162,59,46,0.20)',
          borderRadius: 8, padding: '10px 14px', marginBottom: 16,
          fontSize: 13, color: 'var(--garnet, #A23B2E)'
        }}>
          Load failed: {loadError}. The ic_applications table may need migration 102 to run.
        </div>
      )}

      {rows.length === 0 && !loadError && (
        <div style={{
          background: 'var(--paper, #FFFFFF)',
          border: '1px dashed rgba(10,77,60,0.18)',
          borderRadius: 12, padding: '28px 22px', textAlign: 'center'
        }}>
          <p style={{ fontSize: 14, color: 'var(--muted, #5C6862)', margin: 0 }}>
            No applications yet. They'll show here as soon as a client submits.
          </p>
        </div>
      )}

      {rows.length > 0 && (
        <div style={{ display: 'grid', gap: 10 }}>
          {rows.map((r) => (
            <div
              key={r.applicationId}
              style={{
                background: 'var(--paper, #FFFFFF)',
                border: '1px solid rgba(10,77,60,0.14)',
                borderRadius: 12, padding: '14px 16px',
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 1fr) auto',
                gap: 14, alignItems: 'start'
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
                  <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink, #14201B)' }}>
                    {r.displayName || r.email || `Client user #${r.clientUserId}`}
                  </span>
                  <span style={statusChipStyle(r.status)}>{r.status}</span>
                  <span style={{
                    fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase',
                    color: 'var(--muted, #5C6862)', fontWeight: 600
                  }}>
                    Wants: {r.tierPref === 'any' ? 'any role' : r.tierPref}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted, #5C6862)', marginBottom: 6 }}>
                  {r.email}{r.phone ? ` · ${r.phone}` : ''}
                  {r.appliedFromClientId ? ` · from client #${r.appliedFromClientId}` : ''}
                </div>
                {r.pitch && (
                  <p style={{
                    fontSize: 13, color: 'var(--ink, #14201B)', lineHeight: 1.5,
                    margin: '6px 0 0', whiteSpace: 'pre-wrap',
                    background: 'rgba(10,77,60,0.04)',
                    border: '1px solid rgba(10,77,60,0.10)',
                    borderRadius: 8, padding: '8px 10px'
                  }}>
                    {r.pitch}
                  </p>
                )}
                {r.reviewerNotes && (
                  <p style={{ fontSize: 11, color: 'var(--muted, #5C6862)', margin: '6px 0 0', fontStyle: 'italic' }}>
                    Your notes: {r.reviewerNotes}
                  </p>
                )}
                <div style={{ fontSize: 11, color: 'var(--muted, #5C6862)', marginTop: 6 }}>
                  Submitted {relTime(r.createdAt)}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
                {r.linkedAdminUserId ? (
                  <Link
                    href={`/admin/av/employees/${r.linkedAdminUserId}`}
                    style={{
                      fontSize: 12, fontWeight: 600,
                      color: 'var(--emerald-deep, #0A4D3C)',
                      textDecoration: 'none'
                    }}
                  >
                    Open employee →
                  </Link>
                ) : (
                  <Link
                    href="/admin/av/employees"
                    style={{
                      fontSize: 12, fontWeight: 600,
                      color: 'var(--emerald-deep, #0A4D3C)',
                      textDecoration: 'none'
                    }}
                  >
                    Create employee →
                  </Link>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
