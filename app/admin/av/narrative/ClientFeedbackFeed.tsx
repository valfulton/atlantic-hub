'use client';

/**
 * ClientFeedbackFeed  (#61 Inc 4-polish-A)
 *
 * Operator-side surface: what clients have said back on drafts queued for
 * their approval. Pulls /api/admin/social/outbox/feedback and renders the
 * most-recent N notes — customer, line, note text, status — so val sees the
 * feedback at the top of the cockpit without leaving the page.
 *
 * Collapsible (native <details>) so it doesn't compete with the lines list
 * when there's nothing to read. The summary shows the count + most-recent
 * sender so val knows whether to expand.
 */
import { useEffect, useState } from 'react';

interface FeedbackItem {
  outboxId: number;
  tenantId: string;
  clientId: number | null;
  clientLabel: string;
  status: string;
  bodyText: string | null;
  clientEditedBody: string | null;
  clientNotes: string;
  narrativeLineId: number | null;
  narrativeLineName: string | null;
  updatedAt: string;
}

function fmtWhen(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const now = Date.now();
    const ms = now - d.getTime();
    const min = Math.round(ms / 60000);
    if (min < 60) return `${min}m ago`;
    const hr = Math.round(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const day = Math.round(hr / 24);
    if (day < 14) return `${day}d ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

const STATUS_COLOR: Record<string, string> = {
  scheduled: '#86efac',
  publishing: '#fcd34d',
  published: '#86efac',
  canceled: '#fca5a5',
  draft: '#cbd5e1',
  failed: '#fca5a5'
};

export function ClientFeedbackFeed() {
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch('/api/admin/social/outbox/feedback', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        if (Array.isArray(j.items)) setItems(j.items);
        setLoaded(true);
      })
      .catch(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, []);

  // Hide entirely until loaded — and if loaded with zero, hide too. The
  // cockpit shouldn't get visual weight from "nothing happened yet."
  if (!loaded || items.length === 0) return null;

  const most = items[0];
  return (
    <details
      style={{
        marginBottom: 12,
        borderRadius: 12,
        border: '1px solid rgba(147,197,253,0.30)',
        background: 'rgba(147,197,253,0.06)',
        padding: 12
      }}
    >
      <summary
        style={{
          cursor: 'pointer',
          listStyle: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap'
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 600, color: '#93c5fd', letterSpacing: 0.2 }}>
          💬 Client feedback
        </span>
        <span style={{ fontSize: 12, color: '#e2e8f0' }}>
          {items.length} note{items.length === 1 ? '' : 's'} ·
          latest from <strong>{most.clientLabel}</strong> {fmtWhen(most.updatedAt)}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: '#64748b' }}>expand</span>
      </summary>
      <ul style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map((it) => (
          <li
            key={it.outboxId}
            style={{
              border: '1px solid rgba(148,163,184,0.14)',
              borderRadius: 10,
              padding: 10,
              background: 'rgba(2,6,23,0.45)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#f1f5f9' }}>{it.clientLabel}</span>
              {it.narrativeLineName && (
                <span style={{ fontSize: 11, color: '#94a3b8' }}>
                  · on <span style={{ color: '#e2e8f0' }}>{it.narrativeLineName}</span>
                </span>
              )}
              <span
                style={{
                  fontSize: 10,
                  textTransform: 'uppercase',
                  letterSpacing: 0.8,
                  padding: '1px 7px',
                  borderRadius: 999,
                  background: 'rgba(2,6,23,0.6)',
                  color: STATUS_COLOR[it.status] ?? '#cbd5e1',
                  border: '1px solid rgba(148,163,184,0.20)'
                }}
              >
                {it.status}
              </span>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: '#64748b' }}>{fmtWhen(it.updatedAt)}</span>
            </div>
            <p style={{ marginTop: 6, fontSize: 13, color: '#e2e8f0', lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>
              {it.clientNotes}
            </p>
            {it.clientEditedBody && (
              <p style={{ marginTop: 6, fontSize: 11, color: '#94a3b8', lineHeight: 1.4 }}>
                ↪ They edited the caption to:
                <span style={{ display: 'block', color: '#cbd5e1', marginTop: 2, whiteSpace: 'pre-wrap' }}>
                  {it.clientEditedBody}
                </span>
              </p>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}
