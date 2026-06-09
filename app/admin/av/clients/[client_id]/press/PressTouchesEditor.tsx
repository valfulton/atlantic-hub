'use client';

/**
 * PressTouchesEditor — interactive client component for the operator press surface.
 *
 * Provides:
 *   - Inline "+ Log press touch" form (creates a new row via POST)
 *   - Row-level status update (PATCH)
 *   - Optimistic update + router.refresh() for the page to re-fetch on success
 *
 * Pure operator surface. NEVER renders client_users notes back to the client.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type {
  PressTouch,
  PressTouchStatus,
  PressTouchChannel
} from '@/lib/client/press_touches';

const STATUS_LABEL: Record<PressTouchStatus, string> = {
  drafted: 'Drafted',
  pitched: 'Pitched',
  replied: 'Replied',
  published: 'Published',
  declined: 'Declined',
  no_response: 'No response'
};

const STATUSES: PressTouchStatus[] = [
  'drafted', 'pitched', 'replied', 'published', 'declined', 'no_response'
];

const CHANNELS: PressTouchChannel[] = ['email', 'phone', 'social_dm', 'event', 'other'];

const inputCss: React.CSSProperties = {
  background: 'var(--paper, #FFFDF5)',
  border: '0.5px solid var(--card-border, rgba(10,10,10,0.18))',
  borderRadius: 8,
  padding: '8px 10px',
  fontSize: 13,
  color: 'var(--ink, #0A0A0A)',
  width: '100%'
};

const labelCss: React.CSSProperties = {
  display: 'block',
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: 'var(--ink-soft, #5F5E5A)',
  marginBottom: 4
};

export default function PressTouchesEditor({
  clientId,
  initialTouches
}: {
  clientId: number;
  initialTouches: PressTouch[];
}) {
  const router = useRouter();
  const [touches, setTouches] = useState<PressTouch[]>(initialTouches);
  const [busy, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [form, setForm] = useState({
    journalist: '',
    journalistEmail: '',
    outlet: '',
    beat: '',
    channel: 'email' as PressTouchChannel,
    status: 'drafted' as PressTouchStatus,
    subject: '',
    notes: ''
  });
  const set = (k: keyof typeof form, v: string) => setForm((s) => ({ ...s, [k]: v }));

  async function logTouch() {
    if (!form.journalist.trim() || !form.outlet.trim()) {
      setMsg('Journalist name + outlet are required.');
      return;
    }
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/av/clients/${clientId}/press`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(form)
      });
      const j = await res.json();
      if (!res.ok || !j.ok) {
        setMsg(j.error || 'Could not log the touch.');
        return;
      }
      setMsg('Logged.');
      setForm({
        journalist: '', journalistEmail: '', outlet: '', beat: '',
        channel: 'email', status: 'drafted', subject: '', notes: ''
      });
      setOpen(false);
      startTransition(() => router.refresh());
    } catch (err) {
      setMsg((err as Error).message || 'Could not log the touch.');
    }
  }

  async function updateStatus(touchId: number, status: PressTouchStatus, url?: string) {
    // Optimistic
    setTouches((prev) => prev.map((t) => t.id === touchId ? { ...t, status, url: url ?? t.url } : t));
    try {
      const res = await fetch(`/api/admin/av/clients/${clientId}/press`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ touchId, status, url: url ?? undefined })
      });
      if (!res.ok) {
        // Revert by re-fetching
        startTransition(() => router.refresh());
      }
    } catch {
      startTransition(() => router.refresh());
    }
  }

  function promptForPublishedUrl(touchId: number) {
    const u = window.prompt('Published URL (or leave blank to skip):', '');
    updateStatus(touchId, 'published', u ?? undefined);
  }

  return (
    <div>
      {/* + Log press touch */}
      <div style={{ marginBottom: '1rem' }}>
        {!open ? (
          <button
            onClick={() => setOpen(true)}
            style={{
              background: 'var(--gold-bright, #EBCB6B)',
              color: 'var(--ink, #0A0A0A)',
              border: '0.5px solid var(--card-border, rgba(10,10,10,0.18))',
              borderRadius: 8,
              padding: '8px 16px',
              fontWeight: 500,
              fontSize: 13,
              cursor: 'pointer'
            }}
          >
            + Log press touch
          </button>
        ) : (
          <div
            style={{
              background: 'var(--paper, #FFFDF5)',
              border: '0.5px solid var(--card-border, rgba(10,10,10,0.18))',
              borderRadius: 12,
              padding: '14px 16px',
              marginBottom: 12
            }}
          >
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <label>
                <span style={labelCss}>Journalist *</span>
                <input style={inputCss} value={form.journalist} onChange={(e) => set('journalist', e.target.value)} placeholder="Maya Rodriguez" />
              </label>
              <label>
                <span style={labelCss}>Outlet *</span>
                <input style={inputCss} value={form.outlet} onChange={(e) => set('outlet', e.target.value)} placeholder="The Baltimore Banner" />
              </label>
              <label>
                <span style={labelCss}>Journalist email</span>
                <input style={inputCss} value={form.journalistEmail} onChange={(e) => set('journalistEmail', e.target.value)} placeholder="maya@banner.com" />
              </label>
              <label>
                <span style={labelCss}>Beat</span>
                <input style={inputCss} value={form.beat} onChange={(e) => set('beat', e.target.value)} placeholder="Healthcare / criminal justice" />
              </label>
              <label>
                <span style={labelCss}>Channel</span>
                <select style={inputCss} value={form.channel} onChange={(e) => set('channel', e.target.value)}>
                  {CHANNELS.map((c) => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
                </select>
              </label>
              <label>
                <span style={labelCss}>Status</span>
                <select style={inputCss} value={form.status} onChange={(e) => set('status', e.target.value)}>
                  {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                </select>
              </label>
              <label style={{ gridColumn: '1 / -1' }}>
                <span style={labelCss}>Subject line / pitch headline</span>
                <input style={inputCss} value={form.subject} onChange={(e) => set('subject', e.target.value)} placeholder="A doctor who said yes" />
              </label>
              <label style={{ gridColumn: '1 / -1' }}>
                <span style={labelCss}>Internal notes (never shown to client)</span>
                <textarea
                  style={{ ...inputCss, minHeight: 70, fontFamily: 'inherit' }}
                  value={form.notes}
                  onChange={(e) => set('notes', e.target.value)}
                  placeholder="Context, response excerpts, follow-up plan…"
                />
              </label>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
              <button
                disabled={busy}
                onClick={logTouch}
                style={{
                  background: 'var(--emerald-deep, #085041)',
                  color: 'var(--mint-soft, #E1F5EE)',
                  border: 'none',
                  borderRadius: 8,
                  padding: '8px 16px',
                  fontWeight: 500,
                  fontSize: 13,
                  cursor: 'pointer'
                }}
              >
                Save touch
              </button>
              <button
                onClick={() => { setOpen(false); setMsg(null); }}
                style={{
                  background: 'var(--paper, #FFFDF5)',
                  border: '0.5px solid var(--card-border, rgba(10,10,10,0.18))',
                  borderRadius: 8,
                  padding: '8px 14px',
                  fontSize: 13,
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
              {msg && (
                <span style={{ fontSize: 12, color: msg === 'Logged.' ? 'var(--emerald-deep, #085041)' : 'var(--rose-ink, #72243E)' }}>
                  {msg}
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Touch list */}
      {touches.length === 0 ? (
        <div
          style={{
            background: 'var(--paper, #FFFDF5)',
            border: '0.5px solid var(--card-border, rgba(10,10,10,0.10))',
            borderRadius: 12,
            padding: '24px',
            color: 'var(--ink-soft, #5F5E5A)',
            textAlign: 'center'
          }}
        >
          No touches yet. Log the first one above.
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '0.5px solid var(--card-border, rgba(10,10,10,0.12))' }}>
              <th style={{ textAlign: 'left', padding: '8px 6px', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--ink-soft, #5F5E5A)' }}>Outlet · Journalist</th>
              <th style={{ textAlign: 'left', padding: '8px 6px', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--ink-soft, #5F5E5A)' }}>Status</th>
              <th style={{ textAlign: 'left', padding: '8px 6px', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--ink-soft, #5F5E5A)' }}>Subject</th>
              <th style={{ textAlign: 'right', padding: '8px 6px', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--ink-soft, #5F5E5A)' }}>Age</th>
            </tr>
          </thead>
          <tbody>
            {touches.map((t) => (
              <tr key={t.id} style={{ borderBottom: '0.5px solid var(--card-border, rgba(10,10,10,0.06))' }}>
                <td style={{ padding: '10px 6px', verticalAlign: 'top' }}>
                  <div style={{ fontWeight: 500 }}>{t.outlet}</div>
                  <div style={{ fontSize: 11, color: 'var(--ink-soft, #5F5E5A)' }}>{t.journalist}{t.beat ? ` · ${t.beat}` : ''}</div>
                </td>
                <td style={{ padding: '10px 6px', verticalAlign: 'top' }}>
                  <select
                    value={t.status}
                    onChange={(e) => {
                      const next = e.target.value as PressTouchStatus;
                      if (next === 'published') promptForPublishedUrl(t.id);
                      else updateStatus(t.id, next);
                    }}
                    style={{ ...inputCss, padding: '4px 6px', fontSize: 12 }}
                  >
                    {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                  </select>
                  {t.url ? (
                    <div style={{ marginTop: 4 }}>
                      <a href={t.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: 'var(--harbor-deep, #0C447C)' }}>
                        URL ↗
                      </a>
                    </div>
                  ) : null}
                </td>
                <td style={{ padding: '10px 6px', verticalAlign: 'top', fontSize: 12, color: 'var(--ink-soft, #5F5E5A)' }}>
                  {t.subject ?? '—'}
                </td>
                <td style={{ padding: '10px 6px', verticalAlign: 'top', fontSize: 12, color: 'var(--ink-soft, #5F5E5A)', textAlign: 'right' }}>
                  {t.ageDays}d
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
