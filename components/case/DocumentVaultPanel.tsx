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
}

interface Props {
  caseId: number;
  documents: CaseDocumentLite[];
}

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

export default function DocumentVaultPanel({ caseId, documents }: Props) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const [documentName, setDocumentName] = useState('');
  const [documentKind, setDocumentKind] = useState('');
  const [notes, setNotes] = useState('');

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
                  <a
                    href={`/api/admin/av/cases/${caseId}/documents/${d.documentId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-emerald-300 hover:underline truncate"
                  >
                    {d.documentName}
                  </a>
                  {d.documentKind && (
                    <span className="text-[10px] uppercase tracking-wider text-muted">
                      {d.documentKind.replace(/_/g, ' ')}
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted mt-0.5">
                  {formatDate(d.uploadedAt)}
                  {d.sizeBytes && <> · {formatBytes(d.sizeBytes)}</>}
                  {d.mimeType && <> · {d.mimeType}</>}
                </div>
                {d.notes && (
                  <div className="text-xs text-ink mt-1 opacity-80">{d.notes}</div>
                )}
              </div>
              <button
                type="button"
                onClick={() => handleDelete(d.documentId)}
                className="text-[10px] uppercase tracking-wider text-red-300 hover:text-red-200 hover:underline"
                aria-label={`Delete ${d.documentName}`}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
