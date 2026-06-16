'use client';

/**
 * AddCaseNoteForm  (val 2026-06-15, #699)
 *
 * Compose surface for a case-level note. Renders inline expandable —
 * collapsed: "+ Add a note for everyone on this case" button.
 * Open: textarea + optional audience picker (operator only) + Save.
 *
 * Family members (client_user) only get the 'family' audience, server
 * enforces this. Operator sees a 3-way picker (Family / Investigation /
 * Operator only).
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  caseId: number;
  /** When true, render the audience picker. Operator-side surfaces pass true. */
  showAudiencePicker?: boolean;
  /** When true, render the pin toggle. Operator-side surfaces pass true. */
  showPinToggle?: boolean;
}

export default function AddCaseNoteForm({
  caseId,
  showAudiencePicker = false,
  showPinToggle = false
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState<'family' | 'legal_team' | 'operator_only'>('family');
  const [pinned, setPinned] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const trimmed = body.trim();
    if (!trimmed) {
      setError('Note body is required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/av/cases/${caseId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          body: trimmed,
          audience: showAudiencePicker ? audience : 'family',
          pinned: showPinToggle ? pinned : false
        })
      });
      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error(j.error || 'save failed');
      setBody('');
      setAudience('family');
      setPinned(false);
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
          border: '1px dashed rgba(10,77,60,0.3)',
          color: 'var(--emerald-deep, #0A4D3C)',
          fontSize: 13,
          fontWeight: 500,
          padding: '10px 16px',
          borderRadius: 8,
          cursor: 'pointer',
          width: '100%',
          textAlign: 'left'
        }}
      >
        + Add a note for everyone on this case
      </button>
    );
  }

  return (
    <div
      style={{
        background: '#FFFFFF',
        border: '1px solid rgba(10,77,60,0.25)',
        borderRadius: 10,
        padding: 14
      }}
    >
      <div style={{ display: 'grid', gap: 10 }}>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={5}
          placeholder="Write a note. It will be visible to everyone on this case."
          style={{
            width: '100%',
            padding: '10px 12px',
            border: '1px solid rgba(10,77,60,0.25)',
            borderRadius: 6,
            fontSize: 14,
            lineHeight: 1.5,
            // (val 2026-06-16) Explicit dark hex — NOT var(--ink), because
            // --ink resolves to a LIGHT color on the operator dark theme,
            // making typed text invisible on the white textarea background.
            color: '#14201B',
            background: '#fff',
            fontFamily: 'inherit',
            resize: 'vertical'
          }}
          autoFocus
        />
        {(showAudiencePicker || showPinToggle) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            {showAudiencePicker && (
              <label style={{ fontSize: 11, color: 'var(--muted, #5C6862)', letterSpacing: '0.06em', textTransform: 'uppercase', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                Audience
                <select
                  value={audience}
                  onChange={(e) => setAudience(e.target.value as 'family' | 'legal_team' | 'operator_only')}
                  style={{
                    fontSize: 12, padding: '4px 8px',
                    border: '1px solid rgba(10,77,60,0.25)', borderRadius: 4,
                    // (val 2026-06-16) Explicit colors so the operator dark
                    // theme doesn't render this as white-on-white.
                    background: '#fff', color: '#14201B'
                  }}
                >
                  <option value="family">Family sees it</option>
                  <option value="legal_team">Investigation tier</option>
                  <option value="operator_only">Operator only</option>
                </select>
              </label>
            )}
            {showPinToggle && (
              <label style={{ fontSize: 11, color: 'var(--muted, #5C6862)', letterSpacing: '0.06em', textTransform: 'uppercase', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
                Pin to top
              </label>
            )}
          </div>
        )}
        {error && (
          <div style={{ fontSize: 12, color: '#A23B2E' }}>{error}</div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            type="button"
            onClick={() => { setOpen(false); setError(null); setBody(''); }}
            disabled={saving}
            style={{ background: 'transparent', border: 'none', color: 'var(--muted, #5C6862)', fontSize: 12, padding: '6px 10px', cursor: 'pointer' }}
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
            {saving ? 'Saving…' : 'Post note'}
          </button>
        </div>
      </div>
    </div>
  );
}
