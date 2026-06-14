/**
 * /admin/av/access-audit  (val 2026-06-13)
 *
 * The single page that shows what every collaborator can ACTUALLY reach.
 * Stops the cycle of val sending links that look right but get bounced at
 * a silent data-layer gate (parent_approved=false, password missing,
 * collaborator revoked, etc).
 *
 * For every client_user:
 *   - Their brands (owner + member)
 *   - Their cases (with PASS / BLOCKED resolved against canClientUserAccessCase rules)
 *   - Their auth state (password set? magic token live?)
 *   - The verdict — and the next action val should take to unblock them
 *
 * Operator-only. Adminbar-style chrome consistent with the rest of /admin/av.
 */
import Link from 'next/link';
import { loadAccessAudit, type AccessAuditUser } from '@/lib/admin/access_audit';
import CopyLinkButton from './CopyLinkButton';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit'
    });
  } catch { return iso.slice(0, 16); }
}

function statusPill(u: AccessAuditUser): { label: string; bg: string; fg: string; border: string } {
  switch (u.status) {
    case 'active':
      return { label: 'Active', bg: 'rgba(10,77,60,0.12)', fg: '#0A4D3C', border: 'rgba(10,77,60,0.45)' };
    case 'invited_not_logged_in':
      return { label: 'Invited · never signed in', bg: 'rgba(8,90,130,0.12)', fg: '#085A82', border: 'rgba(8,90,130,0.45)' };
    case 'awaiting_parent_approval':
      return { label: 'BLOCKED · awaiting parent approval', bg: 'rgba(196,127,30,0.15)', fg: '#7A4500', border: 'rgba(196,127,30,0.55)' };
    case 'no_password_and_no_link':
      return { label: 'No password · no live link', bg: 'rgba(180,58,58,0.10)', fg: '#A03030', border: 'rgba(180,58,58,0.45)' };
    case 'revoked_everywhere':
      return { label: 'Revoked', bg: 'rgba(80,80,80,0.10)', fg: '#444', border: 'rgba(80,80,80,0.45)' };
    case 'archived':
      return { label: 'Archived', bg: 'rgba(80,80,80,0.10)', fg: '#444', border: 'rgba(80,80,80,0.45)' };
  }
}

function buildMagicUrl(token: string | null): string | null {
  if (!token) return null;
  // We hard-code the canonical origin so the URL works whether val opens
  // this page on the deploy-specific host or the canonical domain.
  return `https://atlantic-hub.netlify.app/api/client/magic-link/${token}`;
}

export default async function AccessAuditPage() {
  // (val 2026-06-13) Defensive load — if the SQL throws, render an error
  // banner instead of letting Next.js 500 the whole page. The 500 was
  // hiding the actual cause from val.
  let users: AccessAuditUser[] = [];
  let loadError: string | null = null;
  try {
    users = await loadAccessAudit();
  } catch (e) {
    loadError = (e as Error).message || 'Unknown error loading access audit.';
    console.error('access-audit page load failed', e);
  }

  const totalUsers = users.length;
  const blocked = users.filter((u) =>
    u.status === 'awaiting_parent_approval' || u.status === 'no_password_and_no_link'
  );
  const neverLoggedIn = users.filter((u) => u.status === 'invited_not_logged_in');

  return (
    <main style={{ padding: '2rem 1.5rem 4rem', maxWidth: 1200, margin: '0 auto', color: 'var(--ink, #1B2329)' }}>
      <header style={{ marginBottom: '1.75rem' }}>
        <div style={{ fontSize: 11, letterSpacing: '0.16em', color: 'var(--gold-deep, #7A5A18)', textTransform: 'uppercase' }}>
          Operator · Access Audit
        </div>
        <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontWeight: 500, fontSize: 30, margin: '6px 0 8px' }}>
          Who can actually get in.
        </h1>
        <p style={{ fontSize: 14, color: 'var(--muted, #5C6862)', lineHeight: 1.55, maxWidth: 720 }}>
          One row per client_user. Reads <code>family_case_collaborators</code> against
          the real <code>canClientUserAccessCase()</code> rule, so what you see is what
          they see. If somebody is silently blocked, the row tells you why and what to click next.
        </p>
      </header>

      {loadError && (
        <div style={{
          background: 'rgba(180,58,58,0.08)',
          border: '1px solid rgba(180,58,58,0.45)',
          color: '#A03030',
          padding: '14px 18px',
          borderRadius: 10,
          marginBottom: 18,
          fontSize: 13,
          lineHeight: 1.5
        }}>
          <strong>Audit load failed:</strong> {loadError}
        </div>
      )}

      {/* Summary chips */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 24 }}>
        <SummaryChip label="Total users" value={totalUsers} />
        <SummaryChip label="Blocked" value={blocked.length} flag={blocked.length > 0 ? 'warn' : undefined} />
        <SummaryChip label="Invited · never signed in" value={neverLoggedIn.length} />
      </div>

      {/* User rows */}
      <div style={{ display: 'grid', gap: 14 }}>
        {users.map((u) => {
          const pill = statusPill(u);
          const magicUrl = buildMagicUrl(u.magicToken);
          return (
            <article
              key={u.clientUserId}
              style={{
                background: 'var(--paper, #FFFFFF)',
                border: '1px solid rgba(10,10,10,0.10)',
                borderRadius: 14,
                padding: '18px 20px'
              }}
            >
              {/* Header row */}
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink, #1B2329)' }}>
                    {u.displayName || u.email}
                  </div>
                  {u.displayName && (
                    <div style={{ fontSize: 12, color: 'var(--muted, #5C6862)' }}>{u.email}</div>
                  )}
                  <div style={{ fontSize: 11, color: 'var(--muted, #5C6862)', marginTop: 4 }}>
                    client_user_id <strong>{u.clientUserId}</strong>
                    {' · '}
                    Last login {formatDate(u.lastLoginAt)}
                    {u.tier ? <> · Tier <strong>{u.tier}</strong></> : null}
                  </div>
                </div>
                <span style={{
                  fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase',
                  padding: '4px 10px', borderRadius: 6,
                  background: pill.bg, color: pill.fg, border: `1px solid ${pill.border}`
                }}>
                  {pill.label}
                </span>
              </div>

              {/* Next action — only when there IS one */}
              {u.status !== 'active' && (
                <div style={{
                  marginTop: 12, padding: '10px 12px',
                  background: pill.bg, border: `1px solid ${pill.border}`,
                  borderRadius: 8, fontSize: 12.5, color: pill.fg
                }}>
                  <strong>Next:</strong> {u.nextAction}
                </div>
              )}

              {/* Brands */}
              {u.brands.length > 0 && (
                <div style={{ marginTop: 14 }}>
                  <div style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--muted, #5C6862)', marginBottom: 6 }}>
                    Brands
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {u.brands.map((b) => (
                      <Link
                        key={`${b.clientId}-${b.rel}`}
                        href={`/admin/av/clients/${b.clientId}`}
                        style={{
                          fontSize: 12, padding: '3px 9px', borderRadius: 6,
                          background: 'rgba(10,77,60,0.06)',
                          border: '1px solid rgba(10,77,60,0.20)',
                          color: 'var(--ink, #1B2329)', textDecoration: 'none'
                        }}
                      >
                        {b.clientName} <span style={{ color: 'var(--muted, #5C6862)', marginLeft: 4 }}>· {b.rel}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              {/* Cases */}
              {u.cases.length > 0 && (
                <div style={{ marginTop: 14 }}>
                  <div style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--muted, #5C6862)', marginBottom: 6 }}>
                    Cases ({u.cases.length})
                  </div>
                  <div style={{ display: 'grid', gap: 6 }}>
                    {u.cases.map((c) => (
                      <div
                        key={c.caseId}
                        style={{
                          fontSize: 12.5, padding: '8px 12px', borderRadius: 8,
                          background: c.canReach ? 'rgba(10,77,60,0.06)' : 'rgba(196,127,30,0.10)',
                          border: c.canReach
                            ? '1px solid rgba(10,77,60,0.20)'
                            : '1px solid rgba(196,127,30,0.45)',
                          display: 'flex', alignItems: 'flex-start',
                          justifyContent: 'space-between', gap: 10, flexWrap: 'wrap'
                        }}
                      >
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <span style={{ fontWeight: 600 }}>{c.caseName}</span>
                          <span style={{ color: 'var(--muted, #5C6862)', marginLeft: 8 }}>· {c.role.replace(/_/g, ' ')}</span>
                          {c.blockedReason && (
                            <div style={{ fontSize: 11.5, color: '#7A4500', marginTop: 4 }}>
                              {c.blockedReason}
                            </div>
                          )}
                        </div>
                        <span style={{
                          fontSize: 10, letterSpacing: '0.10em', textTransform: 'uppercase',
                          padding: '3px 8px', borderRadius: 5,
                          background: c.canReach ? '#0A4D3C' : '#7A4500',
                          color: '#fff'
                        }}>
                          {c.canReach ? 'Can reach' : 'Blocked'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Auth state + magic link */}
              <div style={{ marginTop: 14, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, color: 'var(--muted, #5C6862)' }}>
                  Password {u.passwordSet ? 'set' : 'NOT set'}
                </span>
                <span style={{ fontSize: 11, color: 'var(--muted, #5C6862)' }}>·</span>
                <span style={{ fontSize: 11, color: 'var(--muted, #5C6862)' }}>
                  Magic link{' '}
                  {magicUrl ? (
                    new Date(u.magicTokenExpiresAt || 0) > new Date()
                      ? <>live, expires {formatDate(u.magicTokenExpiresAt)}</>
                      : <>EXPIRED {formatDate(u.magicTokenExpiresAt)}</>
                  ) : 'never issued'}
                </span>
                {magicUrl && (
                  <CopyLinkButton url={magicUrl} />
                )}
              </div>
            </article>
          );
        })}
      </div>
    </main>
  );
}

function SummaryChip({ label, value, flag }: { label: string; value: number; flag?: 'warn' }) {
  const bg = flag === 'warn' ? 'rgba(196,127,30,0.10)' : 'rgba(10,77,60,0.06)';
  const border = flag === 'warn' ? 'rgba(196,127,30,0.45)' : 'rgba(10,77,60,0.20)';
  const fg = flag === 'warn' ? '#7A4500' : 'var(--ink, #1B2329)';
  return (
    <div style={{
      padding: '8px 12px', borderRadius: 8,
      background: bg, border: `1px solid ${border}`, color: fg,
      fontSize: 12, display: 'flex', alignItems: 'baseline', gap: 8
    }}>
      <span style={{ fontSize: 18, fontWeight: 600 }}>{value}</span>
      <span style={{ color: 'var(--muted, #5C6862)' }}>{label}</span>
    </div>
  );
}
