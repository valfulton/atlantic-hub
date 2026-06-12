/**
 * /admin/av/clients/[client_id]/cases/[caseId]/actions/[actionId]
 *
 * Operator detail page for a single action item. Shows full title + detail
 * (with §X.Y deep-links into the trust PDF), inline edit (status / priority /
 * due date / body), append-only notes thread. Mirrors at /client/cases/[caseId]/
 * actions/[actionId] for the family + attorneys with case access.
 *
 * Server component: loads action + case + notes + indexableDoc, then mounts
 * client components for the editor and notes panel.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  getActionItem,
  getCase,
  listActionItemNotes,
  findIndexableDocumentForCase
} from '@/lib/case/case_store';
import SectionText from '@/components/case/SectionText';
import ActionItemEditor from '@/components/case/ActionItemEditor';
import ActionItemNotesPanel from '@/components/case/ActionItemNotesPanel';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PageProps {
  params: { client_id: string; caseId: string; actionId: string };
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return iso.slice(0, 10); }
}

function priorityPill(p: string) {
  const styles: Record<string, string> = {
    urgent: 'bg-red-900/30 text-red-300 border-red-700/40',
    high: 'bg-amber-900/30 text-amber-300 border-amber-700/40',
    normal: 'bg-[var(--surface-3)] text-muted border-border',
    low: 'bg-[var(--surface-3)] text-muted border-border'
  };
  return styles[p] || styles.normal;
}

function statusPill(s: string) {
  const styles: Record<string, string> = {
    open: 'bg-emerald-900/30 text-emerald-300 border-emerald-700/40',
    in_progress: 'bg-blue-900/30 text-blue-300 border-blue-700/40',
    done: 'bg-[var(--surface-3)] text-muted border-border',
    blocked: 'bg-red-900/30 text-red-300 border-red-700/40'
  };
  return styles[s] || styles.open;
}

export default async function ActionItemDetailPage({ params }: PageProps) {
  const clientId = parseInt(params.client_id, 10);
  const caseId = parseInt(params.caseId, 10);
  const actionId = parseInt(params.actionId, 10);
  if (!Number.isInteger(clientId) || !Number.isInteger(caseId) || !Number.isInteger(actionId)) notFound();

  const [action, caseRow, notes, indexableDoc] = await Promise.all([
    getActionItem(actionId),
    getCase(caseId),
    listActionItemNotes(actionId),
    findIndexableDocumentForCase(caseId)
  ]);
  if (!action || action.caseId !== caseId) notFound();
  if (!caseRow || caseRow.clientId !== clientId) notFound();

  const sectionDocUrl = indexableDoc
    ? `/api/admin/av/cases/${caseId}/documents/${indexableDoc.documentId}`
    : null;
  const sectionIndex = indexableDoc?.sectionIndex ?? null;

  return (
    <main className="min-h-screen p-6 bg-[var(--surface)] text-ink">
      <div className="max-w-4xl mx-auto">
        {/* Breadcrumb */}
        <div className="text-xs text-muted mb-4">
          <Link href="/admin/av/cases" className="hover:text-brand">Cases</Link>
          {' · '}
          <Link href={`/admin/av/clients/${clientId}`} className="hover:text-brand">Client #{clientId}</Link>
          {' · '}
          <Link href={`/admin/av/clients/${clientId}/cases/${caseId}`} className="hover:text-brand">{caseRow.caseName}</Link>
          {' · '}
          <span>Action item</span>
        </div>

        {/* Header */}
        <header className="mb-6">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-md border ${priorityPill(action.priority)}`}>
              {action.priority}
            </span>
            <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-md border ${statusPill(action.status)}`}>
              {action.status.replace(/_/g, ' ')}
            </span>
            {action.dueDate && (
              <span className="text-[10px] uppercase tracking-wider text-muted">
                Due {formatDate(action.dueDate)}
              </span>
            )}
          </div>
          <h1 className="text-2xl font-medium leading-tight" style={{ fontFamily: 'Fraunces, Cormorant Garamond, Georgia, serif' }}>
            {action.title}
          </h1>
          <div className="text-xs text-muted mt-2">
            Created {formatDate(action.createdAt)}
            {action.source ? ` · source: ${action.source}` : ''}
          </div>
        </header>

        {/* Body with § links */}
        <section className="rounded-xl border border-border bg-[var(--surface-2)] p-5 mb-6">
          <h2 className="text-sm uppercase tracking-wider text-muted mb-3">Detail</h2>
          {action.detail ? (
            <div className="text-sm whitespace-pre-wrap leading-relaxed">
              <SectionText
                text={action.detail}
                documentUrl={sectionDocUrl}
                sectionIndex={sectionIndex}
              />
            </div>
          ) : (
            <div className="text-sm text-muted italic">No detail yet.</div>
          )}
        </section>

        {/* Edit panel — client component handles PATCH */}
        <section className="rounded-xl border border-border bg-[var(--surface-2)] p-5 mb-6">
          <h2 className="text-sm uppercase tracking-wider text-muted mb-3">Edit</h2>
          <ActionItemEditor
            caseId={caseId}
            actionId={actionId}
            initial={{
              title: action.title,
              detail: action.detail,
              status: action.status,
              priority: action.priority,
              dueDate: action.dueDate
            }}
          />
        </section>

        {/* Notes thread */}
        <section className="rounded-xl border border-border bg-[var(--surface-2)] p-5 mb-6">
          <h2 className="text-sm uppercase tracking-wider text-muted mb-3">Notes ({notes.length})</h2>
          <ActionItemNotesPanel
            caseId={caseId}
            actionId={actionId}
            initialNotes={notes}
            sectionDocUrl={sectionDocUrl}
            sectionIndex={sectionIndex}
          />
        </section>
      </div>
    </main>
  );
}
