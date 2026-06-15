/**
 * components/case/DocumentVaultPanel.tsx  (val 2026-06-12, Phase 3 Wave 2)
 *
 * Renders the case doc vault: list of documents, upload form, per-row open +
 * delete actions. Mounts in the operator case dashboard's middle column,
 * replacing the read-only "No documents yet" stub.
 *
 * Documents stream from the byte-serve endpoint as `inline` — so PDFs and
 * images open in a new tab, downloads happen when the browser can't render
 * the mime inline.
 */
'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';

interface CaseDocumentLite {
  documentId: number;
  documentName: string;
  documentKind: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  uploadedAt: string | null;
  notes: string | null;
  /** # of §X.Y references found in this PDF; null = never indexed. */
  sectionCount?: number | null;
  // (val 2026-06-12, #613) Approval workflow surfaced inline so val can see
  // each doc's state at a glance + flip drafts into Adriana's review queue.
  approvalStatus?: 'draft' | 'pending_review' | 'approved' | 'rejected';
  approvalNote?: string | null;
}

interface Props {
  caseId: number;
  documents: CaseDocumentLite[];
  /**
   * (val 2026-06-15, #684) The client_id segment of the operator viewer URL:
   *   /admin/av/clients/[clientId]/cases/[caseId]/documents/[documentId]/view
   * When provided, the doc name links to the viewer (where the markdown editor
   * + PDF section deep-links live) instead of streaming the raw bytes. The
   * raw-bytes URL is still surfaced as a small 'open file' affordance so val
   * can grab the binary if she needs to.
   *
   * Optional so the panel still works on mounts that don't have a client_id
   * in scope (preview routes, etc.); in that case it falls back to the
   * byte-serve URL (today's behavior).
   */
  clientId?: number | null;
}

const INDEXABLE_KINDS = new Set(['trust', 'will', 'poa', 'medical_directive']);

const DOCUMENT_KINDS: Array<{ value: string; label: string }> = [
  { value: 'trust', label: 'Trust document' },
  { value: 'deed', label: 'Deed / property record' },
  { value: 'will', label: 'Will' },
  { value: 'poa', label: 'Power of Attorney' },
  { value: 'medical_directive', label: 'Medical directive' },
  { value: 'financial_statement', label: 'Financial statement' },
  { value: 'court_filing', label: 'Court filing' },
  { value: 'correspondence', label: 'Letter / correspondence' },
  { value: 'photo', label: 'Photo' },
  { value: 'other', label: 'Other' }
];

function formatBytes(n: number | null): string {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(iso: string | null): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return iso; }
}

export default function DocumentVaultPanel({ caseId, documents, clientId }: Props) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [reindexing, setReindexing] = useState<number | null>(null);
  const [reindexStatus, setReindexStatus] = useState<Record<number, string>>({});

  // Per-row in-progress + suggested kind for the "Set kind" picker.
  const [tagging, setTagging] = useState<number | null>(null);
  const [pendingKind, setPendingKind] = useState<Record<number, string>>({});

  // (val 2026-06-12, #613) Approval flip state.
  const [flipping, setFlipping] = useState<number | null>(null);
  const [flipStatus, setFlipStatus] = useState<Record<number, string>>({});

  // (val 2026-06-15, #683) Inline rename + notes edit. One row at a time:
  // editingMetaId tracks which row is open. nameDraft / notesDraft hold the
  // pending values. PATCH /api/admin/av/cases/[caseId]/documents/[documentId]
  // accepts both — see content/route.ts for the body shape.
  const [editingMetaId, setEditingMetaId] = useState<number | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [notesDraft, setNotesDraft] = useState('');
  const [savingMeta, setSavingMeta] = useState(false);
  const [metaErr, setMetaErr] = useState<string | null>(null);

  function openMetaEdit(d: CaseDocumentLite) {
    setEditingMetaId(d.documentId);
    setNameDraft(d.documentName);
    setNotesDraft(d.notes || '');
    setMetaErr(null);
  }

  function cancelMetaEdit() {
    setEditingMetaId(null);
    setNameDraft('');
    setNotesDraft('');
    setMetaErr(null);
  }

  async function saveMetaEdit(documentId: number, origName: string, origNotes: string | null) {
    setMetaErr(null);
    setSavingMeta(true);
    try {
      const body: { documentName?: string; notes?: string | null } = {};
      const trimmedName = nameDraft.trim();
      const trimmedNotes = notesDraft.trim();
      if (!trimmedName) {
        setMetaErr('Name cannot be blank.');
        return;
      }
      if (trimmedName !== origName) body.documentName = trimmedName;
      const newNotesValue = trimmedNotes || null;
      const origNotesValue = origNotes || null;
      if (newNotesValue !== origNotesValue) body.notes = newNotesValue;
      if (Object.keys(body).length === 0) {
        cancelMetaEdit();
        return;
      }
      const res = await fetch(
        `/api/admin/av/cases/${caseId}/documents/${documentId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        }
      );
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        setMetaErr(data?.error || 'save failed');
        return;
      }
      cancelMetaEdit();
      router.refresh();
    } catch (e) {
      setMetaErr(e instanceof Error ? e.message : 'network error');
    } finally {
      setSavingMeta(false);
    }
  }

  async function handleFlipApproval(
    documentId: number,
    status: 'draft' | 'pending_review' | 'approved' | 'rejected',
    note?: string
  ) {
    setFlipping(documentId);
    setFlipStatus((prev) => ({ ...prev, [documentId]: 'saving…' }));
    try {
      const res = await fetch(
        `/api/admin/av/cases/${caseId}/documents/${documentId}/approval`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ status, note: note ?? null })
        }
      );
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        setFlipStatus((prev) => ({
          ...prev,
          [documentId]: data?.error || 'flip failed'
        }));
        return;
      }
      setFlipStatus((prev) => ({ ...prev, [documentId]: `now ${status.replace(/_/g, ' ')}` }));
      router.refresh();
    } catch (e) {
      setFlipStatus((prev) => ({
        ...prev,
        [documentId]: e instanceof Error ? e.message : 'network error'
      }));
    } finally {
      setFlipping(null);
    }
  }

  /** Filename → best-guess kind. So val doesn't have to think about it. */
  function guessKindFromName(name: string): string | null {
    const n = name.toLowerCase();
    if (/(trust|trst)\b/.test(n)) return 'trust';
    if (/\bwill\b/.test(n) && !/\bwillis\b/.test(n)) return 'will';
    if (/\b(poa|power.of.attorney)\b/.test(n)) return 'poa';
    if (/\b(medical|advance.directive|living.will)\b/.test(n)) return 'medical_directive';
    if (/\b(deed|grant.deed)\b/.test(n)) return 'deed';
    if (/property.report/.test(n)) return 'other';
    if (/\b(financial|bank|statement)\b/.test(n)) return 'financial_statement';
    if (/\b(court|filing|complaint|motion)\b/.test(n)) return 'court_filing';
    return null;
  }

  async function handleSetKind(documentId: number, kind: string) {
    setTagging(documentId);
    setReindexStatus((prev) => ({ ...prev, [documentId]: 'tagging…' }));
    try {
      const res = await fetch(`/api/admin/av/cases/${caseId}/documents/${documentId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ documentKind: kind })
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        setReindexStatus((prev) => ({ ...prev, [documentId]: data?.error || 'tag failed' }));
        return;
      }
      if (data.indexErr) {
        setReindexStatus((prev) => ({ ...prev, [documentId]: `tagged · ${data.indexErr}` }));
      } else if (data.sectionCount != null) {
        setReindexStatus((prev) => ({
          ...prev,
          [documentId]: `tagged · ${data.sectionCount} sections indexed`
        }));
      } else {
        setReindexStatus((prev) => ({ ...prev, [documentId]: 'tagged' }));
      }
      router.refresh();
    } catch (e) {
      setReindexStatus((prev) => ({
        ...prev,
        [documentId]: e instanceof Error ? e.message : 'network error'
      }));
    } finally {
      setTagging(null);
    }
  }

  async function handleReindex(documentId: number) {
    setReindexing(documentId);
    setReindexStatus((prev) => ({ ...prev, [documentId]: 'scanning…' }));
    try {
      const res = await fetch(`/api/admin/av/cases/${caseId}/documents/${documentId}/reindex`, {
        method: 'POST'
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        setReindexStatus((prev) => ({ ...prev, [documentId]: data?.error || 'failed' }));
        return;
      }
      setReindexStatus((prev) => ({
        ...prev,
        [documentId]: `${data.sectionCount} sections · ${data.pageCount} pages`
      }));
      // Refresh so §6.G(2) anchors render immediately
      router.refresh();
    } catch (e) {
      setReindexStatus((prev) => ({
        ...prev,
        [documentId]: e instanceof Error ? e.message : 'network error'
      }));
    } finally {
      setReindexing(null);
    }
  }

  const [documentName, setDocumentName] = useState('');
  const [documentKind, setDocumentKind] = useState('');
  const [notes, setNotes] = useState('');
  // (val 2026-06-12, #613) Upload approval state — default approved so existing
  // workflows (trust PDF, deed) keep behaving the same. val flips to 'draft'
  // when uploading a draft amendment that needs Adriana's review.
  const [uploadStatus, setUploadStatus] = useState<'approved' | 'draft'>('approved');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setError('Pick a file first');
      return;
    }
    setUploading(true);
    setError(null);

    const form = new FormData();
    form.append('file', file);
    if (documentName.trim()) form.append('documentName', documentName.trim());
    if (documentKind) form.append('documentKind', documentKind);
    if (notes.trim()) form.append('notes', notes.trim());
    // (#613) Upload status — 'draft' lands invisible to clients until val sends
    // it for review; 'approved' lands visible immediately (legacy behavior).
    form.append('approvalStatus', uploadStatus);

    try {
      const res = await fetch(`/api/admin/av/cases/${caseId}/documents`, {
        method: 'POST',
        body: form
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        setError(data?.error || 'Upload failed');
        return;
      }
      // Reset and refresh
      setDocumentName(''); setDocumentKind(''); setNotes('');
      if (fileInputRef.current) fileInputRef.current.value = '';
      setShowForm(false);
      router.refresh();
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : 'Network error');
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(documentId: number) {
    if (!confirm('Delete this document? The file will remain in storage but the case will no longer reference it.')) return;
    try {
      const res = await fetch(`/api/admin/av/cases/${caseId}/documents/${documentId}`, {
        method: 'DELETE'
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        alert(data?.error || 'Delete failed');
        return;
      }
      router.refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Network error');
    }
  }

  return (
    <section className="rounded-xl border border-border bg-[var(--surface-2)] p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm uppercase tracking-wider text-muted">Document vault ({documents.length})</h2>
        <button
          type="button"
          onClick={() => setShowForm(!showForm)}
          className="text-xs uppercase tracking-wider px-3 py-1.5 rounded-md border border-border bg-[var(--surface-3,rgba(255,255,255,0.04))] text-ink hover:bg-[var(--surface-3,rgba(255,255,255,0.08))]"
        >
          {showForm ? 'Cancel' : '+ Upload'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="mb-4 p-3 rounded-lg bg-black/20 border border-border space-y-2">
          <label className="text-xs block">
            <span className="block text-muted uppercase tracking-wider mb-1">File *</span>
            <input
              ref={fileInputRef}
              type="file"
              required
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f && !documentKind) {
                  const guessed = guessKindFromName(f.name);
                  if (guessed) setDocumentKind(guessed);
                }
              }}
              className="w-full text-sm text-ink file:mr-3 file:rounded file:border-0 file:bg-emerald-700 file:text-white file:px-3 file:py-1.5 file:text-xs file:uppercase file:tracking-wider"
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs">
              <span className="block text-muted uppercase tracking-wider mb-1">Display name (optional)</span>
              <input
                type="text"
                value={documentName}
                onChange={(e) => setDocumentName(e.target.value)}
                placeholder="Defaults to filename"
                className="w-full bg-black/30 border border-border rounded px-2 py-1.5 text-sm"
              />
            </label>
            <label className="text-xs">
              <span className="block text-muted uppercase tracking-wider mb-1">Kind</span>
              <select
                value={documentKind}
                onChange={(e) => setDocumentKind(e.target.value)}
                className="w-full bg-black/30 border border-border rounded px-2 py-1.5 text-sm"
              >
                <option value="">(unspecified)</option>
                {DOCUMENT_KINDS.map((k) => (
                  <option key={k.value} value={k.value}>{k.label}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="text-xs block">
            <span className="block text-muted uppercase tracking-wider mb-1">Notes</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="What is this? Anything Adriana or siblings should know?"
              className="w-full bg-black/30 border border-border rounded px-2 py-1.5 text-sm"
            />
          </label>
          {/* (val 2026-06-12, #613) Approval gate at upload time. Default
              'approved' for the common case (trust PDFs, deeds, property
              reports — visible to client immediately). Flip to 'draft' when
              uploading a draft that needs Adriana's sign-off (e.g. Option B
              amendment); doc lands invisible to clients until val hits
              "Send for Adriana's review" on the row. */}
          <label className="text-xs block">
            <span className="block text-muted uppercase tracking-wider mb-1">Visibility</span>
            <select
              value={uploadStatus}
              onChange={(e) => setUploadStatus(e.target.value as 'approved' | 'draft')}
              className="w-full bg-black/30 border border-border rounded px-2 py-1.5 text-sm"
            >
              <option value="approved">Approved — clients see + download immediately</option>
              <option value="draft">Draft — hidden until I send for Adriana's review</option>
            </select>
          </label>
          {error && (
            <div className="text-xs text-red-300 bg-red-950/40 border border-red-700/40 rounded px-3 py-2">
              {error}
            </div>
          )}
          <div className="flex gap-2 pt-2">
            <button
              type="submit"
              disabled={uploading}
              className="text-xs uppercase tracking-wider px-3 py-1.5 rounded-md bg-emerald-700 text-white disabled:opacity-50"
            >
              {uploading ? 'Uploading…' : 'Upload to vault'}
            </button>
            <span className="text-xs text-muted self-center">Max 25 MB · PDF · images · DOCX</span>
          </div>
        </form>
      )}

      {documents.length === 0 ? (
        <div className="text-sm text-muted italic">No documents yet.</div>
      ) : (
        <ul className="space-y-2">
          {documents.map((d) => (
            <li key={d.documentId} className="rounded-md border border-border bg-black/15 p-3 flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2 flex-wrap">
                  {/* (val 2026-06-15, #684) Route the name to the operator
                      viewer page when clientId is provided — the viewer renders
                      markdown inline + surfaces the Edit pencil, and shows the
                      PDF in a section-aware frame. Without clientId, fall back
                      to the raw byte-serve URL (legacy behavior). */}
                  <a
                    href={
                      clientId != null
                        ? `/admin/av/clients/${clientId}/cases/${caseId}/documents/${d.documentId}/view`
                        : `/api/admin/av/cases/${caseId}/documents/${d.documentId}`
                    }
                    {...(clientId != null ? {} : { target: '_blank', rel: 'noopener noreferrer' })}
                    className="text-sm text-emerald-300 hover:underline truncate"
                  >
                    {d.documentName}
                  </a>
                  {d.documentKind && (
                    <span className="text-[10px] uppercase tracking-wider text-muted">
                      {d.documentKind.replace(/_/g, ' ')}
                    </span>
                  )}
                  {/* Small raw-bytes escape hatch — useful when the mime is
                      application/octet-stream and the viewer can't preview. */}
                  {clientId != null && (
                    <a
                      href={`/api/admin/av/cases/${caseId}/documents/${d.documentId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] uppercase tracking-wider text-muted hover:text-emerald-300"
                      title="Open raw file (bytes)"
                    >
                      raw ↗
                    </a>
                  )}
                </div>
                <div className="text-xs text-muted mt-0.5">
                  {formatDate(d.uploadedAt)}
                  {d.sizeBytes && <> · {formatBytes(d.sizeBytes)}</>}
                  {d.mimeType && <> · {d.mimeType}</>}
                </div>
                {/* (val 2026-06-15, #683) Inline meta edit (name + notes).
                    Edit pencil sits next to notes; open mode swaps in inputs. */}
                {editingMetaId === d.documentId ? (
                  <div className="mt-2 space-y-2 p-2 rounded border border-emerald-700/30 bg-emerald-950/20">
                    <label className="text-[10px] uppercase tracking-wider text-muted block">
                      Document name
                      <input
                        type="text"
                        value={nameDraft}
                        onChange={(e) => setNameDraft(e.target.value)}
                        className="block w-full mt-0.5 bg-black/30 border border-border rounded px-2 py-1 text-sm"
                      />
                    </label>
                    <label className="text-[10px] uppercase tracking-wider text-muted block">
                      Notes
                      <textarea
                        value={notesDraft}
                        onChange={(e) => setNotesDraft(e.target.value)}
                        rows={3}
                        placeholder="Quick note about this document (optional)"
                        className="block w-full mt-0.5 bg-black/30 border border-border rounded px-2 py-1 text-xs"
                      />
                    </label>
                    {metaErr && (
                      <div className="text-[11px] text-red-300">{metaErr}</div>
                    )}
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={cancelMetaEdit}
                        disabled={savingMeta}
                        className="text-[10px] uppercase tracking-wider px-2 py-1 text-muted hover:text-white"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => saveMetaEdit(d.documentId, d.documentName, d.notes)}
                        disabled={savingMeta}
                        className="text-[10px] uppercase tracking-wider px-2 py-1 rounded bg-emerald-900/50 text-emerald-200 border border-emerald-700/50 hover:bg-emerald-900/70 transition-colors"
                      >
                        {savingMeta ? 'Saving…' : 'Save'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {d.notes && (
                      <div className="text-xs text-ink mt-1 opacity-80">{d.notes}</div>
                    )}
                    <button
                      type="button"
                      onClick={() => openMetaEdit(d)}
                      className="mt-1 text-[10px] uppercase tracking-wider text-emerald-300 hover:text-emerald-200"
                    >
                      {d.notes ? 'Edit name + notes' : 'Add notes / rename'}
                    </button>
                  </>
                )}
                {d.documentKind && INDEXABLE_KINDS.has(d.documentKind) && d.mimeType === 'application/pdf' && (
                  <div className="text-[10px] text-muted mt-1">
                    {d.sectionCount != null
                      ? `§ index: ${d.sectionCount} sections found — §X.Y references will deep-link into this PDF.`
                      : '§ index: not built yet. Click Re-index to scan for §X.Y references.'}
                    {reindexStatus[d.documentId] && (
                      <span className="ml-2 text-emerald-300">· {reindexStatus[d.documentId]}</span>
                    )}
                  </div>
                )}
                {!d.documentKind && d.mimeType === 'application/pdf' && (
                  <div className="mt-2 flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] uppercase tracking-wider text-amber-300">No kind set</span>
                    <select
                      value={pendingKind[d.documentId] ?? (guessKindFromName(d.documentName) || '')}
                      onChange={(e) =>
                        setPendingKind((prev) => ({ ...prev, [d.documentId]: e.target.value }))
                      }
                      disabled={tagging === d.documentId}
                      className="text-xs bg-black/30 border border-border rounded px-2 py-1"
                    >
                      <option value="">Pick a kind…</option>
                      {DOCUMENT_KINDS.map((k) => (
                        <option key={k.value} value={k.value}>{k.label}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => {
                        const k = pendingKind[d.documentId] ?? guessKindFromName(d.documentName);
                        if (!k) {
                          setReindexStatus((prev) => ({ ...prev, [d.documentId]: 'pick a kind first' }));
                          return;
                        }
                        handleSetKind(d.documentId, k);
                      }}
                      disabled={tagging === d.documentId}
                      className="text-[10px] uppercase tracking-wider px-2 py-1 rounded-md bg-emerald-700 text-white disabled:opacity-50"
                    >
                      {tagging === d.documentId ? 'Saving…' : 'Save kind + index'}
                    </button>
                    {guessKindFromName(d.documentName) && !pendingKind[d.documentId] && (
                      <span className="text-[10px] text-muted">
                        guessed: {guessKindFromName(d.documentName)?.replace(/_/g, ' ')}
                      </span>
                    )}
                    {reindexStatus[d.documentId] && (
                      <span className="text-[10px] text-emerald-300">· {reindexStatus[d.documentId]}</span>
                    )}
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-1 items-end">
                {/* (val 2026-06-12, #613) Approval status + flip controls.
                    'draft' → "Send for Adriana's review" (→ pending_review)
                    'pending_review' / 'approved' / 'rejected' → "Roll back"
                       (→ draft, operator-only).
                    Color: draft=gray · pending=amber · approved=emerald · rejected=red. */}
                {(() => {
                  const s = d.approvalStatus ?? 'approved';
                  const label =
                    s === 'draft' ? 'DRAFT' :
                    s === 'pending_review' ? "ADRIANA'S QUEUE" :
                    s === 'approved' ? 'APPROVED' : 'REJECTED';
                  const color =
                    s === 'draft' ? 'text-zinc-300' :
                    s === 'pending_review' ? 'text-amber-300' :
                    s === 'approved' ? 'text-emerald-300' : 'text-red-300';
                  return (
                    <span
                      className={`text-[10px] uppercase tracking-wider ${color}`}
                      title={d.approvalNote || undefined}
                    >
                      {label}
                    </span>
                  );
                })()}
                {(d.approvalStatus ?? 'approved') === 'draft' && (
                  <button
                    type="button"
                    onClick={() => handleFlipApproval(d.documentId, 'pending_review')}
                    disabled={flipping === d.documentId}
                    className="text-[10px] uppercase tracking-wider text-amber-300 hover:text-amber-200 hover:underline disabled:opacity-50"
                  >
                    {flipping === d.documentId ? '…' : "Send for Adriana's review"}
                  </button>
                )}
                {(d.approvalStatus ?? 'approved') !== 'draft' && (d.approvalStatus ?? 'approved') !== 'approved' && (
                  <button
                    type="button"
                    onClick={() => handleFlipApproval(d.documentId, 'draft')}
                    disabled={flipping === d.documentId}
                    className="text-[10px] uppercase tracking-wider text-zinc-300 hover:text-zinc-100 hover:underline disabled:opacity-50"
                    title="Pull this back to draft so you can edit before Adriana reviews."
                  >
                    {flipping === d.documentId ? '…' : 'Roll back to draft'}
                  </button>
                )}
                {flipStatus[d.documentId] && (
                  <span className="text-[10px] text-zinc-400">{flipStatus[d.documentId]}</span>
                )}
                {/* (val 2026-06-15) Surface the feedback note inline — was hidden
                    in a hover tooltip before. Both val (operator vault) and
                    Adriana (collaborator vault) see this. */}
                {d.approvalNote && (
                  (d.approvalStatus === 'rejected' || d.approvalStatus === 'pending_review') && (
                    <div
                      className="mt-1 max-w-[260px] text-[11px] leading-snug text-right"
                      style={{
                        color: d.approvalStatus === 'rejected' ? 'var(--garnet, #A23B2E)' : 'var(--gold-bright, #E6CE7E)',
                        fontStyle: 'italic'
                      }}
                    >
                      &ldquo;{d.approvalNote}&rdquo;
                    </div>
                  )
                )}
                {d.documentKind && INDEXABLE_KINDS.has(d.documentKind) && d.mimeType === 'application/pdf' && (
                  <button
                    type="button"
                    onClick={() => handleReindex(d.documentId)}
                    disabled={reindexing === d.documentId}
                    className="text-[10px] uppercase tracking-wider text-emerald-300 hover:text-emerald-200 hover:underline disabled:opacity-50"
                    aria-label={`Re-index ${d.documentName}`}
                  >
                    {reindexing === d.documentId ? 'Scanning…' : 'Re-index §'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleDelete(d.documentId)}
                  className="text-[10px] uppercase tracking-wider text-red-300 hover:text-red-200 hover:underline"
                  aria-label={`Delete ${d.documentName}`}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
