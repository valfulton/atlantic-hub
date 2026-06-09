'use client';

/**
 * EditAssetModal — replaces the v1 alert popup ("Editor for individual assets
 * ships in #550 v2.") with a real editor for cockpit_approvals rows.
 *
 * Surfaces:
 *  - Title (editable)
 *  - Body (editable textarea — drafts the asset val will green-light)
 *  - Source provenance (read-only — shows which brief fields ground this draft)
 *  - Scheduled date (optional — feeds calendar surfacing in Tier 3)
 *
 * Save dispatches to /api/admin/av/cockpit/asset/edit with EITHER the
 * persisted approvalId (numeric) OR the inline approval payload (for cards
 * still in React state). The first edit on a brand-new card persists it as
 * status='pending' in cockpit_approvals — Green Light then approves + dispatches.
 *
 * Visual: cream surface to match the cockpit; champagne-gold save button.
 */
import { useEffect, useState } from 'react';

export type AssetKind = 'commercial' | 'press_release' | 'op_ed' | 'social';

export interface EditableAsset {
  id: string;           // 'a1' inline OR '17' persisted (stringified for the cockpit)
  kind: AssetKind;
  title: string;
  body?: string | null;
  source: string;
  angle: string;
}

interface Props {
  clientId: number;
  asset: EditableAsset;
  onClose: () => void;
  onSaved: (saved: { id: string; title: string; body: string | null; scheduledAt: string | null }) => void;
}

export default function EditAssetModal({ clientId, asset, onClose, onSaved }: Props) {
  const [title, setTitle] = useState(asset.title);
  const [body, setBody] = useState(asset.body ?? '');
  const [scheduledAt, setScheduledAt] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [onClose]);

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const isInline = /^a\d+/.test(asset.id);
      const payload: Record<string, unknown> = {
        clientId,
        title: title.trim(),
        body: body.trim() || null,
        scheduledAt: scheduledAt || null
      };
      if (isInline) {
        payload.approval = { kind: asset.kind, title: asset.title, source: asset.source, angle: asset.angle };
      } else {
        payload.approvalId = Number(asset.id);
      }
      const res = await fetch('/api/admin/av/cockpit/asset/edit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const j = await res.json();
      if (!res.ok || !j.ok) {
        setErr(j.error || 'Could not save.');
        return;
      }
      const saved = j.saved;
      const newId = String(j.approvalId);
      onSaved({
        id: newId,
        title: saved?.title ?? title,
        body: saved?.body ?? body,
        scheduledAt: saved?.scheduledAt ?? scheduledAt
      });
      onClose();
    } catch {
      setErr('Could not save.');
    } finally {
      setBusy(false);
    }
  }

  const kindLabel: Record<AssetKind, string> = {
    commercial: 'Commercial',
    press_release: 'Press release',
    op_ed: 'Op-ed',
    social: 'Social post'
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 60,
        background: 'rgba(10,10,10,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#FFFDF5',
          color: '#0A0A0A',
          width: '100%',
          maxWidth: 640,
          maxHeight: '90vh',
          overflow: 'auto',
          borderRadius: 16,
          boxShadow: '0 18px 50px rgba(10,10,10,0.35)',
          padding: '22px 24px'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase', color: '#7A5A18' }}>
              Edit asset · {kindLabel[asset.kind]}{asset.angle && asset.angle !== '—' ? ` · angle ${asset.angle}` : ''}
            </div>
            <div style={{ fontSize: 18, fontFamily: 'Fraunces, Cormorant Garamond, serif', marginTop: 2 }}>
              Shape the draft, save the pending row.
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', fontSize: 22, color: 'rgba(10,10,10,0.55)', cursor: 'pointer' }}
            aria-label="Close"
          >×</button>
        </div>

        <label style={{ display: 'block', marginBottom: 12 }}>
          <span style={{ display: 'block', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(10,10,10,0.55)', marginBottom: 4 }}>
            Title
          </span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={busy}
            style={{
              width: '100%', background: '#F7F1E1', border: '0.5px solid rgba(10,10,10,0.18)',
              borderRadius: 8, padding: '8px 10px', fontSize: 14, color: '#0A0A0A', fontFamily: 'inherit'
            }}
          />
        </label>

        <label style={{ display: 'block', marginBottom: 12 }}>
          <span style={{ display: 'block', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(10,10,10,0.55)', marginBottom: 4 }}>
            Body — the actual draft (becomes the press release / post / op-ed body when published)
          </span>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            disabled={busy}
            rows={12}
            placeholder="Write or paste the draft text here. Leaves blank until you fill it; Green Light still works on a body-less draft for fast-pitch use."
            style={{
              width: '100%', background: '#F7F1E1', border: '0.5px solid rgba(10,10,10,0.18)',
              borderRadius: 8, padding: '10px 12px', fontSize: 14, lineHeight: 1.6, color: '#0A0A0A',
              fontFamily: 'inherit', resize: 'vertical', minHeight: 200
            }}
          />
        </label>

        <label style={{ display: 'block', marginBottom: 12 }}>
          <span style={{ display: 'block', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(10,10,10,0.55)', marginBottom: 4 }}>
            Schedule (optional) — calendar surfaces use this once Tier 3 wires
          </span>
          <input
            type="datetime-local"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
            disabled={busy}
            style={{
              background: '#F7F1E1', border: '0.5px solid rgba(10,10,10,0.18)',
              borderRadius: 8, padding: '8px 10px', fontSize: 13, color: '#0A0A0A', fontFamily: 'inherit'
            }}
          />
        </label>

        <div style={{
          marginBottom: 16, fontSize: 11, color: 'rgba(10,10,10,0.55)',
          background: '#F7F1E1', padding: '8px 10px', borderRadius: 8, border: '0.5px dashed rgba(10,10,10,0.18)'
        }}>
          <strong style={{ color: 'rgba(10,10,10,0.75)' }}>Source provenance:</strong> {asset.source}
        </div>

        {err && (
          <div style={{ marginBottom: 12, color: '#72243E', fontSize: 12 }}>
            {err}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10 }}>
          <button
            type="button"
            onClick={save}
            disabled={busy || !title.trim()}
            style={{
              background: 'var(--gold-bright, #EBCB6B)',
              color: '#0A0A0A',
              border: 'none',
              borderRadius: 8,
              padding: '10px 18px',
              fontSize: 13,
              fontWeight: 500,
              cursor: busy ? 'wait' : 'pointer'
            }}
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            style={{
              background: 'transparent',
              border: '0.5px solid rgba(10,10,10,0.18)',
              borderRadius: 8,
              padding: '10px 18px',
              fontSize: 13,
              color: '#0A0A0A',
              cursor: 'pointer'
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
