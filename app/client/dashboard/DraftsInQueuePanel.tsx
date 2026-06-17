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
  // (val 2026-06-17) Pending is the DEFAULT state and the bucket header already
  // says "N waiting on you" — repeating "Pending your team" on every card was
  // pure redundancy. Only the meaningful, non-default states get a card label.
  pending: '',
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

      {/* (val 2026-06-17, #718) Per-card campaign line dropped — the campaign
          header above the bucket carries that info. Keeping the field on the
          data so any future ungrouped surface still has it. */}

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

/**
 * (val 2026-06-17, #718) Bundle drafts by campaign so a press push reads as a
 * single coordinated story instead of 10 disconnected cards. UX/UI's spec
 * called this out for John specifically — a campaign should land as
 * [press release + video + 5 social posts + op-ed] under one header, not
 * floating siblings.
 *
 * Bucket rules:
 *   - Drafts with the same `campaignName` group together.
 *   - Drafts with no campaign land in an "Other" bucket (rendered last) so
 *     the surface stays honest about what isn't yet linked.
 *   - Within a bucket, drafts keep their incoming order (newest pending first
 *     — already sorted upstream by listDraftsForClient).
 *   - Buckets sort by the count of pending drafts inside them (most active
 *     story first), then by total count.
 */
interface DraftBucket {
  /** Display name. Null = the "Other" bucket. */
  campaignName: string | null;
  campaignId: number | null;
  drafts: ClientCockpitDraft[];
  pendingCount: number;
}

function bucketByCampaign(drafts: ClientCockpitDraft[]): DraftBucket[] {
  const byKey = new Map<string, DraftBucket>();
  for (const d of drafts) {
    const key = d.campaignId != null ? `id:${d.campaignId}` : 'orphan';
    let b = byKey.get(key);
    if (!b) {
      b = {
        campaignName: d.campaignName,
        campaignId: d.campaignId,
        drafts: [],
        pendingCount: 0
      };
      byKey.set(key, b);
    }
    b.drafts.push(d);
    if (d.status === 'pending') b.pendingCount += 1;
  }
  const buckets = Array.from(byKey.values());
  buckets.sort((a, b) => {
    // "Other" bucket always last.
    if (a.campaignId == null && b.campaignId != null) return 1;
    if (a.campaignId != null && b.campaignId == null) return -1;
    // Most pending first, then total drafts.
    if (b.pendingCount !== a.pendingCount) return b.pendingCount - a.pendingCount;
    return b.drafts.length - a.drafts.length;
  });
  return buckets;
}

function BucketHeader({ bucket }: { bucket: DraftBucket }) {
  const name = bucket.campaignName || 'Not yet tied to a campaign';
  const total = bucket.drafts.length;
  const pending = bucket.pendingCount;
  const subtitle =
    pending > 0
      ? `${total} piece${total === 1 ? '' : 's'} · ${pending} waiting on you`
      : `${total} piece${total === 1 ? '' : 's'}`;
  return (
    <div
      style={{
        margin: '18px 0 10px',
        paddingBottom: 8,
        borderBottom: '1px solid var(--card-border)'
      }}
    >
      <div
        style={{
          fontFamily: 'var(--sans)',
          fontSize: 10.5,
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: bucket.campaignId
            ? 'var(--gold-deep, #7A5A18)'
            : 'var(--ink-mute, #5F5E5A)',
          marginBottom: 3
        }}
      >
        Campaign
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap'
        }}
      >
        <h4
          style={{
            fontFamily: 'var(--serif)',
            fontWeight: 500,
            fontSize: 19,
            margin: 0,
            color: bucket.campaignId
              ? 'var(--emerald-deep)'
              : 'var(--ink-mute, #5F5E5A)',
            fontStyle: bucket.campaignId ? 'italic' : 'normal'
          }}
        >
          {name}
        </h4>
        <div
          style={{
            fontFamily: 'var(--sans)',
            fontSize: 12,
            color: 'var(--ink-mute, #5F5E5A)'
          }}
        >
          {subtitle}
        </div>
      </div>
    </div>
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

  const buckets = bucketByCampaign(drafts);

  return (
    <>
      <div className="app-sh">
        <h3>Drafts in your queue</h3>
        {/* (val 2026-06-17) Pending count dropped here — it duplicated the
            approvals strip above and the per-campaign bucket counts below.
            Keep only the positive "all caught up" signal. */}
        {pendingCount === 0 ? <span className="ct">all caught up</span> : null}
      </div>
      <div>
        {buckets.map((b) => (
          <section key={b.campaignId ?? 'orphan'}>
            <BucketHeader bucket={b} />
            {b.drafts.map((d) => (
              <DraftCard key={d.id} draft={d} />
            ))}
          </section>
        ))}
      </div>
    </>
  );
}
