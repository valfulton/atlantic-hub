/**
 * /admin/av/clients/[client_id]/preview/cases/[caseId]/actions/[actionId]
 *   (val 2026-06-14, UX/UI audit — mirror-every-client-page rule)
 *
 * Operator preview mirror for /client/cases/[caseId]/actions/[actionId].
 * Read-only — same shape val will see when she previews-as the client.
 *
 * The full action-item editor lives at the operator-side case dashboard
 * (/admin/av/clients/[id]/cases/[caseId]), so this mirror keeps it simple:
 *   - Banner via OperatorPreviewChrome
 *   - Action item header + detail
 *   - Notes thread (read-only — preview doesn't mark notes read, doesn't post)
 *
 * Why a stripped mirror is correct: previews exist so val can verify what
 * the client sees, NOT to be a second editor. Editing happens on the
 * operator-side dashboard.
 */
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import type { CSSProperties } from 'react';
import { getCase, getActionItem, listActionItemNotes } from '@/lib/case/case_store';
import { getAvDb } from '@/lib/db/av';
import OperatorPreviewChrome from '@/app/admin/av/clients/[client_id]/preview/_components/OperatorPreviewChrome';
import type { RowDataPacket } from 'mysql2';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface ClientRow extends RowDataPacket {
  client_name: string | null;
}

// Cream tokens locally so the inner panel reads cream even though the
// operator layout defines --ink as near-white.
const CREAM_SKIN = {
  '--ink': '#14201B',
  '--muted': '#5C6862',
  '--paper': '#FFFFFF',
  '--cream': '#FAF8F4',
  '--gold-deep': '#7A5A18',
  '--emerald-deep': '#0A4D3C',
  '--emerald-mist': '#DCEDE5'
} as CSSProperties;

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return iso.slice(0, 10);
  }
}

export default async function PreviewClientActionDetailPage({
  params
}: {
  params: { client_id: string; caseId: string; actionId: string };
}) {
  const role = headers().get('x-ah-user-role') as 'owner' | 'staff' | 'client_user' | null;
  if (role === 'client_user') redirect('/admin');

  const clientId = Number.parseInt(params.client_id, 10);
  const caseId = Number.parseInt(params.caseId, 10);
  const actionId = Number.parseInt(params.actionId, 10);
  if (!Number.isFinite(clientId) || !Number.isFinite(caseId) || !Number.isFinite(actionId)) notFound();

  const db = getAvDb();
  const [crows] = await db.execute<ClientRow[]>(
    `SELECT client_name FROM clients WHERE client_id = ? LIMIT 1`,
    [clientId]
  );
  if (!crows[0]) notFound();
  const clientName = crows[0].client_name || `Client #${clientId}`;

  const [caseRecord, action] = await Promise.all([getCase(caseId), getActionItem(actionId)]);
  if (!caseRecord || caseRecord.clientId !== clientId) notFound();
  if (!action || action.caseId !== caseId) notFound();

  const notes = await listActionItemNotes(actionId);

  return (
    <div>
      <OperatorPreviewChrome
        clientId={clientId}
        clientName={clientName}
        active="cases"
        bannerLine={
          <>
            Read-only mirror of{' '}
            <code>/client/cases/{caseId}/actions/{actionId}</code>. The full action editor lives on{' '}
            <Link
              href={`/admin/av/clients/${clientId}/cases/${caseId}`}
              style={{ color: '#0A4D3C', fontWeight: 600 }}
            >
              the operator case dashboard
            </Link>
            .
          </>
        }
      />

      <main
        className="min-h-screen"
        style={{ ...CREAM_SKIN, background: 'var(--cream)', color: 'var(--ink)' }}
      >
        <div style={{ maxWidth: 820, margin: '0 auto', padding: '24px 20px' }}>
          {/* Breadcrumb */}
          <nav
            style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 14 }}
            aria-label="Breadcrumb"
          >
            <Link
              href={`/admin/av/clients/${clientId}/preview/cases/${caseId}`}
              style={{ color: 'var(--emerald-deep)', textDecoration: 'none' }}
            >
              {caseRecord.caseName ?? `Matter #${caseId}`}
            </Link>
            <span style={{ margin: '0 8px' }}>·</span>
            <span>Action item</span>
          </nav>

          {/* Action item header */}
          <article
            style={{
              background: 'var(--paper)',
              border: '1px solid rgba(10,77,60,0.12)',
              borderLeft: '4px solid var(--emerald-deep)',
              borderRadius: 14,
              padding: '22px 24px',
              marginBottom: 18
            }}
          >
            <p
              style={{
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                color: 'var(--gold-deep)',
                margin: '0 0 10px'
              }}
            >
              Action item · {action.priority} · {action.status}
            </p>
            <h1
              style={{
                fontFamily: 'Fraunces, Cormorant Garamond, Georgia, serif',
                fontWeight: 500,
                fontSize: 26,
                lineHeight: 1.2,
                margin: '0 0 12px',
                color: 'var(--ink)'
              }}
            >
              {action.title}
            </h1>
            {action.dueDate && (
              <p style={{ fontSize: 14, color: 'var(--muted)', margin: '0 0 14px' }}>
                Due {formatDate(action.dueDate)}
              </p>
            )}
            {action.detail && (
              <div
                style={{
                  fontSize: 16,
                  lineHeight: 1.6,
                  color: 'var(--ink)',
                  whiteSpace: 'pre-wrap'
                }}
              >
                {action.detail}
              </div>
            )}
          </article>

          {/* Notes thread — read-only listing */}
          <section
            style={{
              background: 'var(--paper)',
              border: '1px solid rgba(10,77,60,0.12)',
              borderRadius: 14,
              padding: '20px 22px'
            }}
          >
            <p
              style={{
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                color: 'var(--gold-deep)',
                margin: '0 0 12px'
              }}
            >
              Notes ({notes.length})
            </p>
            {notes.length === 0 ? (
              <p style={{ color: 'var(--muted)', fontSize: 14, margin: 0 }}>
                No notes yet on this action item.
              </p>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {notes.map((n) => (
                  <li
                    key={n.noteId}
                    style={{
                      padding: '12px 0',
                      borderTop: '1px solid rgba(10,77,60,0.08)'
                    }}
                  >
                    <p
                      style={{
                        fontSize: 12,
                        color: 'var(--muted)',
                        margin: '0 0 4px'
                      }}
                    >
                      {n.authorDisplayName ?? n.authorRole} · {formatDate(n.createdAt)}
                    </p>
                    <p
                      style={{
                        fontSize: 15,
                        color: 'var(--ink)',
                        margin: 0,
                        whiteSpace: 'pre-wrap'
                      }}
                    >
                      {n.body}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
