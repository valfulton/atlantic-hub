/**
 * ApprovalsStrip — political_campaign engagement (#713 Phase 2).
 *
 * The "what do I do next" strip that sits ABOVE the race hero. Renders only
 * when pendingCount > 0 — silent otherwise. Built against the UX/UI mock
 * `AV_MOCK_John_White_Dashboard.html`: gold-tinted background, emerald-deep
 * spark circle with gold-bright bolt, emerald-deep "Review queue" button.
 *
 * Behavior: clicking "Review queue" scrolls smoothly to the DraftsInQueuePanel
 * (which mounts further down the dashboard). The panel's mount point uses
 * `#approvals-queue` as the anchor.
 */
'use client';

interface Props {
  pendingCount: number;
}

export default function ApprovalsStrip({ pendingCount }: Props) {
  // Silent state — when nothing is pending, the strip vanishes. No
  // "all clear" celebratory copy that we'd have to keep tuning.
  if (!Number.isFinite(pendingCount) || pendingCount <= 0) return null;

  function scrollToQueue(e: React.MouseEvent) {
    e.preventDefault();
    const el = document.getElementById('approvals-queue');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  const lead =
    pendingCount === 1
      ? '1 piece is ready for your green-light'
      : `${pendingCount} pieces are ready for your green-light`;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 14,
        padding: '13px 16px',
        borderRadius: 11,
        // Gold-tinted background per mock — gold @ 10% on paper. Keeps the
        // strip visible without screaming.
        background:
          'linear-gradient(0deg, rgba(201,169,97,0.10), rgba(201,169,97,0.10)), var(--paper, #FFFFFF)',
        border: '1px solid rgba(201,169,97,0.4)',
        marginBottom: 22,
        flexWrap: 'wrap'
      }}
    >
      <span
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 11,
          fontSize: 15,
          fontWeight: 600,
          color: 'var(--ink, #14201B)',
          minWidth: 0,
          flex: 1
        }}
      >
        <span
          aria-hidden
          style={{
            width: 26,
            height: 26,
            borderRadius: '50%',
            background: 'var(--emerald-deep, #0A4D3C)',
            color: 'var(--gold-bright, #E8C25A)',
            display: 'grid',
            placeItems: 'center',
            fontSize: 13,
            flex: 'none'
          }}
        >
          ⚡
        </span>
        {lead}
      </span>
      <button
        type="button"
        onClick={scrollToQueue}
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: 'var(--paper, #FAF8F4)',
          background: 'var(--emerald-deep, #0A4D3C)',
          border: 'none',
          borderRadius: 7,
          padding: '8px 14px',
          cursor: 'pointer',
          whiteSpace: 'nowrap'
        }}
      >
        Review queue
      </button>
    </div>
  );
}
