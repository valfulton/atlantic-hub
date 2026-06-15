'use client';

/**
 * AddTimelineEntryForm  (val 2026-06-15, #691)
 *
 * Family-side "+ Add entry" affordance for the Timeline. Rebecca + parents +
 * Adriana need to be able to log what happened (calls with the bank,
 * conversations with Cecilia, document arrivals, etc.) without going through
 * val every time.
 *
 * POSTs to /api/admin/av/cases/[caseId]/events. The route already accepts
 * operator role; the route was extended in #691 to also accept case-member
 * client_users (passes through canClientUserAccessCase).
 *
 * Layout matches the existing timeline entries — small inline form expands
 * under a "+ Add entry" link, never blocks the existing list.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  caseId: number;
  /** Optional label override — defaults to "+ Add entry". */
  label?: string;
}

export default function AddTimelineEntryForm({ caseId, label = '+ Add entry' }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [eventDate, setEventDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [eventTitle, setEventTitle] = useState('');
  const [eventDetail, setEventDetail] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!eventTitle.trim()) {
      setError('Title is required.');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) {
      setError('Date is required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/av/cases/${caseId}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventDate,
          eventTitle: eventTitle.trim(),
          eventDetail: eventDetail.trim() || null,
          source: 'family',
          eventKind: 'note'
        })
      });
      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error(j.error || 'save failed');
      // Reset + close + refresh server data so the new entry shows up.
      setEventTitle('');
      setEventDetail('');
      setEventDate(new Date().toISOString().slice(0, 10));
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'network error');
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          background: 'transparent',
          border: '1px solid rgba(10,77,60,0.25)',
          color: 'var(--emerald-deep, #0A4D3C)',
          fontSize: 12,
          fontWeight: 600,
          padding: '6px 12px',
          borderRadius: 6,
          cursor: 'pointer'
        }}
      >
        {label}
      </button>
    );
  }

  return (
    <div
      style={{
        background: 'var(--paper, #FFFFFF)',
        border: '1px solid rgba(10,77,60,0.25)',
        borderRadius: 10,
        padding: 14,
        marginTop: 10
      }}
    >
      <div style={{ display: 'grid', gap: 10 }}>
        <label style={{ fontSize: 11, color: 'var(--muted, #5C6862)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          Date
          <input
            type="date"
            value={eventDate}
            onChange={(e) => setEventDate(e.target.value)}
            style={{
              display: 'block',
              marginTop: 4,
              width: '100%',
              padding: '6px 10px',
              border: '1px solid rgba(10,77,60,0.25)',
              borderRadius: 6,
              fontSize: 13,
              color: 'var(--ink, #14201B)',
              background: '#fff'
            }}
          />
        </label>
        <label style={{ fontSize: 11, color: 'var(--muted, #5C6862)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          What happened
          <input
            type="text"
            value={eventTitle}
            onChange={(e) => setEventTitle(e.target.value)}
            placeholder="One-line summary (e.g. Called the bank about title)"
            style={{
              display: 'block',
              marginTop: 4,
              width: '100%',
              padding: '8px 10px',
              border: '1px solid rgba(10,77,60,0.25)',
              borderRadius: 6,
              fontSize: 14,
              color: 'var(--ink, #14201B)',
              background: '#fff'
            }}
          />
        </label>
        <label style={{ fontSize: 11, color: 'var(--muted, #5C6862)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          Details (optional)
          <textarea
            value={eventDetail}
            onChange={(e) => setEventDetail(e.target.value)}
            rows={3}
            placeholder="Any extra context, names, follow-ups…"
            style={{
              display: 'block',
              marginTop: 4,
              width: '100%',
              padding: '8px 10px',
              border: '1px solid rgba(10,77,60,0.25)',
              borderRadius: 6,
              fontSize: 13,
              color: 'var(--ink, #14201B)',
              background: '#fff',
              fontFamily: 'inherit',
              resize: 'vertical'
            }}
          />
        </label>
        {error && (
          <div style={{ fontSize: 12, color: '#A23B2E' }}>{error}</div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            type="button"
            onClick={() => { setOpen(false); setError(null); }}
            disabled={saving}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--muted, #5C6862)',
              fontSize: 12,
              padding: '6px 10px',
              cursor: 'pointer'
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={saving}
            style={{
              background: 'var(--emerald-deep, #0A4D3C)',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              padding: '8px 14px',
              fontSize: 12,
              fontWeight: 600,
              cursor: saving ? 'wait' : 'pointer',
              opacity: saving ? 0.6 : 1
            }}
          >
            {saving ? 'Saving…' : 'Add entry'}
          </button>
        </div>
      </div>
    </div>
  );
}
