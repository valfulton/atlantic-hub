/**
 * components/case/DocumentApprovalActions.tsx  (val 2026-06-12, #613)
 *
 * Client-side approve / reject buttons rendered on the case view next to
 * a 'pending_review' document. Used by Adriana (and any collaborator with
 * case access) to flip the doc's status from pending → approved or rejected.
 *
 * On rejected, a required note explains what's wrong (e.g. "needs §5.B
 * language"). On approved, an optional note ("ready to sign 6/15").
 *
 * On success, calls router.refresh() so the page re-fetches and the doc
 * moves from "Awaiting your decision" → "Ready to download" inline.
 */
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  caseId: number;
  documentId: number;
  documentName: string;
}

export default function DocumentApprovalActions({ caseId, documentId, documentName }: Props) {
  const router = useRouter();
  const [mode, setMode] = useState<'idle' | 'approving' | 'rejecting'>('idle');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(status: 'approved' | 'rejected') {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/av/cases/${caseId}/documents/${documentId}/approval`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ status, note: note.trim() || null })
        }
      );
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        setError(data?.error || 'save failed');
        return;
      }
      setMode('idle');
      setNote('');
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'network error');
    } finally {
      setSubmitting(false);
    }
  }

  if (mode === 'idle') {
    return (
      <div style={{ display: 'flex', gap: 12, marginTop: 10, fontSize: 12 }}>
        <button
          type="button"
          onClick={() => setMode('approving')}
          style={{
            background: 'var(--emerald-deep, #0A4D3C)',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            padding: '6px 14px',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer'
          }}
          aria-label={`Approve ${documentName}`}
        >
          Approve
        </button>
        <button
          type="button"
          onClick={() => setMode('rejecting')}
          style={{
            background: 'transparent',
            color: '#A23B2E',
            border: '1px solid #A23B2E',
            borderRadius: 6,
            padding: '6px 14px',
            fontSize: 12,
            fontWeight: 500,
            cursor: 'pointer'
          }}
          aria-label={`Reject ${documentName}`}
        >
          Send back to val
        </button>
      </div>
    );
  }

  const isApproving = mode === 'approving';
  const isRejecting = mode === 'rejecting';

  return (
    <div style={{ marginTop: 10, padding: 12, background: 'var(--cream, #FAF8F4)', border: '1px solid rgba(10,10,10,0.1)', borderRadius: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8, color: isApproving ? 'var(--emerald-deep, #0A4D3C)' : '#A23B2E' }}>
        {isApproving ? 'Approve this draft' : 'Send it back'}
      </div>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={3}
        placeholder={isApproving ? 'Optional note (e.g. "ready to sign 6/15")' : 'What needs to change? (required)'}
        style={{
          width: '100%',
          fontSize: 13,
          padding: '8px 10px',
          border: '1px solid rgba(10,10,10,0.2)',
          borderRadius: 6,
          background: '#fff',
          color: 'var(--ink, #14201B)',
          resize: 'vertical',
          fontFamily: 'inherit'
        }}
      />
      {error && (
        <div style={{ fontSize: 12, color: '#A23B2E', marginTop: 6 }}>{error}</div>
      )}
      <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
        <button
          type="button"
          disabled={submitting || (isRejecting && !note.trim())}
          onClick={() => submit(isApproving ? 'approved' : 'rejected')}
          style={{
            background: isApproving ? 'var(--emerald-deep, #0A4D3C)' : '#A23B2E',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            padding: '6px 14px',
            fontSize: 12,
            fontWeight: 600,
            cursor: submitting ? 'wait' : 'pointer',
            opacity: submitting || (isRejecting && !note.trim()) ? 0.5 : 1
          }}
        >
          {submitting ? 'Saving…' : isApproving ? 'Confirm approve' : 'Send back'}
        </button>
        <button
          type="button"
          onClick={() => { setMode('idle'); setNote(''); setError(null); }}
          style={{
            background: 'transparent',
            color: 'var(--muted, #5C6862)',
            border: '1px solid rgba(10,10,10,0.2)',
            borderRadius: 6,
            padding: '6px 14px',
            fontSize: 12,
            cursor: 'pointer'
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
