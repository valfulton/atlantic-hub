/**
 * DraftsInQueuePanel  (#578, val 2026-06-10)
 *
 * The fix for "I can't see any of the content we added yesterday on the client
 * dashboards." This panel renders every cockpit_approvals row for the active
 * brand as an expandable card:
 *
 *   - Title (Fraunces serif headline)
 *   - Kind label + status pill  ("Press release · Pending your team")
 *   - Campaign name line        ("Campaign · Procedural Justice · A Doctor I Know")
 *   - Body preview line         ("Draft · 247 words" or "No draft yet")
 *   - Expand-in-place body      (the full text, readable on the dashboard
 *                                without leaving for another route)
 *   - "Send notes about this draft" CTA → /client/notes#draft-{id}
 *                                (pre-quotes the title in the compose box via
 *                                the hash; the notes thread is the single
 *                                two-way channel back to val)
 *
 * Reuses the canonical .app-sh + .app-card classes so the visual register
 * matches the rest of the dashboard.
 */
'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { ClientCockpitDraft } from '@/lib/client/cockpit_drafts';

const STATUS_LABEL: Record<ClientCockpitDraft['status'], string> = {
  pending: 'Pending your team',
  approved: 'Approved',
  published: 'Published',
  killed: '' // never displayed — filtered out upstream
};

const STATUS_DOT: Record<ClientCockpitDraft['status'], string> = {
  pending: 'var(--gold-bright)',
  approved: 'var(--emerald-deep)',
  published: 'var(--emerald-deep)',
  killed: 'transparent'
};

function fmtScheduled(iso: string | null): string | null {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  } catch {
    return null;
  }
}

function DraftCard({ draft }: { draft: ClientCockpitDraft }) {
  const [open, setOpen] = useState(false);
  const hasBody = draft.body != null && draft.body.trim().length > 0;
  const previewLine = hasBody
    ? `Draft · ${draft.bodyWordCount.toLocaleString()} words`
    : 'No draft yet — your team is working on it';

  const scheduled = fmtScheduled(draft.scheduledAt);
  const statusLabel = STATUS_LABEL[draft.status];

  return (
    <article
      className="app-card"
      style={{
        padding: '16px 18px',
        marginBottom: 12,
        background: 'var(--paper)',
        border: '1px solid var(--card-border)',
        borderRadius: 14,
        boxShadow: '0 4px 14px var(--card-shadow)'
      }}
    >
      {/* Kind + status row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          fontFamily: 'var(--sans)',
          fontSize: 11,
          letterSpacing: '.06em',
          textTransform: 'uppercase',
          color: 'var(--ink-mute)'
        }}
      >
        <span>{draft.kindLabel}</span>
        {statusLabel ? (
          <>
            <span aria-hidden="true">·</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span
                aria-hidden="true"
                style={{
                  display: 'inline-block',
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: STATUS_DOT[draft.status]
                }}
              />
              {statusLabel}
            </span>
          </>
        ) : null}
        {scheduled ? (
          <>
            <span aria-hidden="true">·</span>
            <span>Scheduled {scheduled}</span>
          </>
        ) : null}
      </div>

      {/* Title */}
      <h4
        style={{
          fontFamily: 'var(--serif)',
          fontWeight: 500,
          fontSize: 18,
          lineHeight: 1.25,
          margin: '6px 0 4px',
          color: 'var(--ink)'
        }}
      >
        {draft.title}
      </h4>

      {/* Campaign name — plain text, no jargon */}
      {draft.campaignName ? (
        <div
          style={{
            fontFamily: 'var(--sans)',
            fontSize: 13,
            color: 'var(--emerald-deep)',
            margin: '0 0 6px'
          }}
        >
          Campaign · <em style={{ fontFamily: 'var(--serif)', fontStyle: 'italic' }}>{draft.campaignName}</em>
        </div>
      ) : null}

      {/* Body preview line */}
      <div
        style={{
          fontFamily: 'var(--sans)',
          fontSize: 13,
          color: 'var(--ink-mute)',
          marginBottom: 10
        }}
      >
        {previewLine}
      </div>

      {/* Expandable body */}
      {hasBody ? (
        <>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            style={{
              fontFamily: 'var(--sans)',
              fontSize: 13,
              fontWeight: 500,
              color: 'var(--emerald-deep)',
              background: 'transparent',
              border: '1px solid var(--card-border)',
              padding: '6px 12px',
              borderRadius: 999,
              cursor: 'pointer'
            }}
            aria-expanded={open}
          >
            {open ? 'Hide draft' : 'Read draft'}
          </button>
          {open ? (
            <div
              style={{
                fontFamily: 'var(--serif)',
                fontSize: 15,
                lineHeight: 1.55,
                color: 'var(--ink)',
                marginTop: 12,
                paddingTop: 12,
                borderTop: '1px dashed var(--card-border)',
                whiteSpace: 'pre-wrap'
              }}
            >
              {draft.body}
            </div>
          ) : null}
        </>
      ) : null}

      {/* Notes CTA */}
      <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
        <Link
          href={`/client/notes?draft=${draft.id}&about=${encodeURIComponent(draft.title)}#draft-${draft.id}`}
          style={{
            fontFamily: 'var(--sans)',
            fontSize: 13,
            fontWeight: 500,
            color: 'var(--emerald-deep)',
            textDecoration: 'none'
          }}
        >
          ✎ Send notes about this →
        </Link>
      </div>
    </article>
  );
}

export default function DraftsInQueuePanel({
  drafts,
  pendingCount
}: {
  drafts: ClientCockpitDraft[];
  pendingCount: number;
}) {
  if (drafts.length === 0) {
    return (
      <>
        <div className="app-sh">
          <h3>Drafts in your queue</h3>
        </div>
        <div className="app-wire">
          <span className="eb">— Your team is on it —</span>
          <p>
            Press releases, op-eds, and social posts your A&amp;V team drafts for
            you will land here as soon as the brief is set. Each draft is fully
            readable here, and you can send notes back to your team on every one.
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="app-sh">
        <h3>Drafts in your queue</h3>
        <span className="ct">
          {pendingCount > 0 ? `${pendingCount} pending your team` : 'all caught up'}
        </span>
      </div>
      <div>
        {drafts.map((d) => (
          <DraftCard key={d.id} draft={d} />
        ))}
      </div>
    </>
  );
}
