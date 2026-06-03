/**
 * ClientWatchlistV3  (#398, val 2026-06-03, per VR V3 watchlist spec)
 *
 * The V3 client-side watchlist body. Fetches /api/client/distress?limit=25
 * (or accepts server-rendered initialRows for the operator preview mirror)
 * and renders each row as a SignalCard. ONE primary CTA per card:
 * ✎ Draft an opener. Secondary action under ⋯: ✚ Add to pipeline.
 *
 * Per the spec — no bulk-action bar on the client surface. The operator
 * still has bulk-promote on her side; this is the calm, focused client
 * view. No rescore button (operator-only).
 *
 * The cascade trail IS the signal story — we don't show a bare "score 137".
 */
'use client';

import { useEffect, useState, useCallback } from 'react';
import SignalCard, { type SignalTrailNode } from '@/app/client/_components/SignalCard';
import DraftOutreachModal, { type DraftOutreachInput } from '@/app/client/_components/DraftOutreachModal';
import { buildSignalCardData } from '@/lib/public_intel/signal_voice';
// Type-only import — erased at compile, doesn't drag mysql2 into the client bundle.
import type { ClassifiedSignal } from '@/lib/public_intel/distress_engine';

// Mirrors lib/public_intel/distress_engine.WatchlistRow but with serialized
// Date fields (ISO strings) — that's what comes back from the API and from
// the preview's server-rendered initialRows.
type SignalHit = ClassifiedSignal;
export interface ClientWatchlistRow {
  entityKey: string;
  entityLabel: string | null;
  regionCode: string | null;
  score: number;
  contributingSignals: SignalHit[];
  firstSeenAt: string;
  lastRecomputedAt: string;
  lastAction: 'contacted' | 'dismissed' | 'converted' | 'ignored' | null;
  lastActedAt: string | null;
}

export interface ClientWatchlistV3Props {
  /** Server-rendered initial rows for the operator preview mirror.
   *  When provided, the panel skips its own fetch (operator session can't
   *  hit /api/client/* and would 401). */
  initialRows?: ClientWatchlistRow[];
  /** Read-only mode — disables Draft + Add to pipeline. Used by the preview
   *  mirror so val doesn't accidentally fire client-scoped writes. */
  preview?: boolean;
}

export default function ClientWatchlistV3(p: ClientWatchlistV3Props) {
  const [rows, setRows] = useState<ClientWatchlistRow[] | null>(p.initialRows ?? null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Draft modal state
  const [draftOpen, setDraftOpen] = useState(false);
  const [draftInput, setDraftInput] = useState<DraftOutreachInput | null>(null);

  // Per-row promote state — controls the ⋯ menu's Add-to-pipeline copy.
  const [promoteState, setPromoteState] = useState<Record<string, 'idle' | 'busy' | 'done' | 'error'>>({});

  const load = useCallback(async () => {
    if (p.preview || p.initialRows) return;
    setLoading(true);
    try {
      const r = await fetch('/api/client/distress?limit=25', { cache: 'no-store' });
      const j = await r.json();
      if (!r.ok || !j.ok) {
        setError(j.error || 'Could not load.');
        return;
      }
      setRows(j.rows as ClientWatchlistRow[]);
      setError(null);
    } catch {
      setError('Could not load.');
    } finally {
      setLoading(false);
    }
  }, [p.preview, p.initialRows]);

  useEffect(() => {
    if (!rows && !p.initialRows && !p.preview) load();
  }, [rows, p.initialRows, p.preview, load]);

  function openDraft(row: ClientWatchlistRow) {
    if (p.preview) return;
    setDraftInput({
      entityKey: row.entityKey,
      entityLabel: row.entityLabel,
      score: row.score,
      signalKinds: row.contributingSignals.map((s) => s.signalKind),
      regionCode: row.regionCode
    });
    setDraftOpen(true);
  }

  async function promote(row: ClientWatchlistRow) {
    if (p.preview) return;
    setPromoteState((s) => ({ ...s, [row.entityKey]: 'busy' }));
    try {
      const r = await fetch('/api/client/distress/promote-to-lead', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          entityKey: row.entityKey,
          entityLabel: row.entityLabel,
          score: row.score,
          signalKinds: row.contributingSignals.map((s) => s.signalKind),
          regionCode: row.regionCode
        })
      });
      const j = await r.json();
      if (!r.ok || !j.ok) {
        setPromoteState((s) => ({ ...s, [row.entityKey]: 'error' }));
        return;
      }
      setPromoteState((s) => ({ ...s, [row.entityKey]: 'done' }));
      if (j.auditId) {
        window.open(`/client/leads/${j.auditId}`, '_blank', 'noopener');
      }
    } catch {
      setPromoteState((s) => ({ ...s, [row.entityKey]: 'error' }));
    }
  }

  // --- render --- //

  if (error) {
    return (
      <div className="v3-card" role="alert">
        <h3 className="v3-card__h">We hit a snag pulling your watchlist.</h3>
        <p className="v3-card__p">{error}</p>
        {!p.preview && (
          <div className="v3-card__row">
            <button type="button" className="v3-link" onClick={load} style={{ background: 'transparent', border: 0, padding: 0, cursor: 'pointer' }}>
              Try again →
            </button>
          </div>
        )}
      </div>
    );
  }

  if (rows === null) {
    return (
      <div className="v3-card">
        <h3 className="v3-card__h">Pulling today&apos;s signals…</h3>
        <p className="v3-card__p">One moment — we&apos;re reading the public records the engine watches for you.</p>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="v3-card">
        <h3 className="v3-card__h">Your watchlist is being built.</h3>
        <p className="v3-card__p">
          The first signals will appear here as the engine finds them. Court filings, suspensions, vendor
          exposure, review trends — we ranked them every morning, top of the list first.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="cards" style={{ marginTop: '14px' }}>
        {rows.map((row) => {
          const v = buildSignalCardData({
            entityLabel: row.entityLabel || 'A flagged entity',
            contributingSignals: row.contributingSignals,
            score: row.score
          });
          const entityName = row.entityLabel || row.entityKey;
          const monogram = (row.entityLabel || row.entityKey || '?').trim().charAt(0).toUpperCase();
          const promoteFlag = promoteState[row.entityKey] ?? 'idle';
          const promoteLabel =
            promoteFlag === 'busy' ? 'Adding…' :
            promoteFlag === 'done' ? '✓ In your pipeline' :
            promoteFlag === 'error' ? 'Add failed — try again' :
            'Add to pipeline';

          const trail = v.trail as SignalTrailNode[];

          return (
            <SignalCard
              key={row.entityKey}
              entity={entityName}
              monogram={monogram}
              chip={row.regionCode ?? undefined}
              chipKind="signal"
              headline={v.headline}
              trail={trail}
              primary={{
                label: p.preview ? 'Draft an opener (preview)' : 'Draft an opener',
                icon: '✎',
                onClick: () => openDraft(row)
              }}
              secondary={[
                {
                  label: promoteLabel,
                  icon: promoteFlag === 'done' ? undefined : '✚',
                  onClick: () => promote(row)
                }
              ]}
            />
          );
        })}
      </div>

      {loading && rows.length > 0 && (
        <p style={{
          marginTop: '12px', fontSize: '11px', letterSpacing: '.16em', textTransform: 'uppercase',
          color: 'var(--cream-muted, #94A4B8)', opacity: 0.6
        }}>
          Refreshing…
        </p>
      )}

      <DraftOutreachModal
        open={draftOpen}
        input={draftInput}
        endpoint="/api/client/distress/draft-outreach"
        onClose={() => setDraftOpen(false)}
      />
    </>
  );
}
