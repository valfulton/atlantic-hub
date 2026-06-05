/**
 * DraftOutreachModal  (#398, val 2026-06-03, per VR V3 watchlist spec)
 *
 * Shared V3-register modal for "Drafted outreach" — opened when the client
 * (Adriana) clicks ✎ Draft an opener on a watchlist signal card, OR when
 * the operator clicks it on the operator-side panel later. Calls the
 * shared draft endpoint, shows the cascade attribution chain as a real
 * signal trail (not a fake metric), then offers Copy buttons for subject
 * and body.
 *
 * Navy + cream + amber. Cormorant head, Inter chrome. Ghost outline CTAs.
 * Scoped inside [data-skin="social"] — gracefully degrades on bare hub
 * surfaces but designed for V3.
 */
'use client';

import { useEffect, useState } from 'react';

export interface DraftOutreachInput {
  entityKey: string;
  entityLabel: string | null;
  score: number;
  signalKinds: string[];
  regionCode: string | null;
}

export interface DraftOutreachModalProps {
  open: boolean;
  input: DraftOutreachInput | null;
  /** Endpoint that returns { ok, draft: { subject, body, attribution: { humanLine }, costMicrocents } } */
  endpoint: string;
  onClose: () => void;
}

interface DraftState {
  status: 'loading' | 'ready' | 'error';
  subject?: string;
  body?: string;
  attributionHumanLine?: string | null;
  costMicrocents?: number;
  errorMessage?: string;
}

export default function DraftOutreachModal(p: DraftOutreachModalProps) {
  const [state, setState] = useState<DraftState>({ status: 'loading' });
  const [copied, setCopied] = useState<'subject' | 'body' | null>(null);

  useEffect(() => {
    if (!p.open || !p.input) return;
    let cancelled = false;
    setState({ status: 'loading' });
    setCopied(null);
    (async () => {
      try {
        const r = await fetch(p.endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            entityKey: p.input!.entityKey,
            entityLabel: p.input!.entityLabel,
            score: p.input!.score,
            signalKinds: p.input!.signalKinds,
            regionCode: p.input!.regionCode
          })
        });
        const j = await r.json();
        if (cancelled) return;
        if (!r.ok || !j.ok) {
          setState({ status: 'error', errorMessage: j.error || 'Draft failed.' });
          return;
        }
        setState({
          status: 'ready',
          subject: j.draft.subject,
          body: j.draft.body,
          attributionHumanLine: j.draft.attribution?.humanLine ?? null,
          costMicrocents: j.draft.costMicrocents
        });
      } catch {
        if (!cancelled) setState({ status: 'error', errorMessage: 'Draft failed.' });
      }
    })();
    return () => { cancelled = true; };
  }, [p.open, p.input, p.endpoint]);

  // Escape key closes the modal — small UX touch that costs nothing.
  useEffect(() => {
    if (!p.open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') p.onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [p.open, p]);

  async function copy(which: 'subject' | 'body', value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(which);
      setTimeout(() => setCopied((c) => (c === which ? null : c)), 1600);
    } catch { /* swallow — keyboard fallback is acceptable */ }
  }

  if (!p.open || !p.input) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Drafted outreach"
      className="dom-modal"
      onClick={p.onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 50,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '16px',
        background: 'rgba(5, 12, 22, 0.78)',
        backdropFilter: 'blur(4px)'
      }}
    >
      <div
        className="dom-modal__panel"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: '640px', maxHeight: '90vh',
          background: 'var(--navy-soft, #11263C)',
          border: '1px solid var(--rule, rgba(216,203,174,.18))',
          borderRadius: '14px',
          boxShadow: '0 30px 60px -30px rgba(0,0,0,.6)',
          overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
          color: 'var(--cream, #F5EFE3)',
          fontFamily: 'var(--sans, "Inter", system-ui, sans-serif)'
        }}
      >
        {/* Head */}
        <div style={{
          padding: '16px 22px',
          borderBottom: '1px solid var(--rule, rgba(216,203,174,.18))',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px'
        }}>
          <div style={{ minWidth: 0 }}>
            <div style={{
              fontSize: '11px', letterSpacing: '.2em', textTransform: 'uppercase',
              color: 'var(--amber-deep, #C7A64E)'
            }}>
              Drafted outreach
            </div>
            <div style={{
              fontFamily: 'var(--serif, "Fraunces", Georgia, serif)',
              fontWeight: 500, fontSize: '20px', marginTop: '2px',
              color: 'var(--cream, #F5EFE3)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
            }}>
              to {p.input.entityLabel ?? p.input.entityKey}
            </div>
          </div>
          <button
            type="button"
            onClick={p.onClose}
            aria-label="Close"
            style={{
              background: 'transparent', border: 0,
              color: 'var(--cream-muted, #94A4B8)',
              fontSize: '22px', lineHeight: 1, cursor: 'pointer',
              padding: '4px 8px'
            }}
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '20px 22px', overflowY: 'auto' }}>
          {state.status === 'loading' && (
            <div style={{
              padding: '40px 0',
              textAlign: 'center',
              color: 'var(--cream-muted, #94A4B8)',
              fontSize: '13px',
              fontStyle: 'italic',
              fontFamily: 'var(--serif, "Fraunces", Georgia, serif)'
            }}>
              Drafting from the signal chain and your offer…
            </div>
          )}

          {state.status === 'error' && (
            <div style={{
              padding: '12px 14px',
              border: '1px solid rgba(255,154,168,.35)',
              background: 'rgba(255,154,168,.08)',
              color: 'var(--rose-glow, #FF9AA8)',
              borderRadius: '8px', fontSize: '13px'
            }}>
              {state.errorMessage}
            </div>
          )}

          {state.status === 'ready' && (
            <>
              {state.attributionHumanLine && (
                <div style={{
                  marginBottom: '18px',
                  padding: '12px 14px',
                  border: '1px solid rgba(235,203,107,.32)',
                  background: 'rgba(235,203,107,.08)',
                  borderRadius: '8px',
                  fontSize: '12.5px',
                  color: 'var(--cream, #F5EFE3)',
                  lineHeight: 1.55
                }}>
                  <span style={{
                    color: 'var(--amber-deep, #C7A64E)',
                    fontSize: '10.5px',
                    letterSpacing: '.18em',
                    textTransform: 'uppercase',
                    marginRight: '8px'
                  }}>
                    Signal chain ·
                  </span>
                  {state.attributionHumanLine}
                </div>
              )}

              <FieldBlock
                label="Subject"
                value={state.subject ?? ''}
                copied={copied === 'subject'}
                onCopy={() => copy('subject', state.subject ?? '')}
              />
              <FieldBlock
                label="Body"
                value={state.body ?? ''}
                copied={copied === 'body'}
                onCopy={() => copy('body', state.body ?? '')}
                multiline
              />

              {typeof state.costMicrocents === 'number' && (
                <div style={{
                  marginTop: '14px',
                  textAlign: 'right',
                  fontSize: '10.5px',
                  color: 'var(--cream-muted, #94A4B8)',
                  opacity: 0.7
                }}>
                  cost ≈ ${(state.costMicrocents / 1_000_000).toFixed(4)}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function FieldBlock(p: {
  label: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
  multiline?: boolean;
}) {
  return (
    <div style={{ marginBottom: '14px' }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: '6px'
      }}>
        <span style={{
          fontSize: '10.5px', letterSpacing: '.18em', textTransform: 'uppercase',
          color: 'var(--cream-muted, #94A4B8)'
        }}>
          {p.label}
        </span>
        <button
          type="button"
          onClick={p.onCopy}
          style={{
            background: 'transparent', border: '1px solid var(--amber, #EBCB6B)',
            color: 'var(--amber, #EBCB6B)',
            fontSize: '10.5px', letterSpacing: '.12em', textTransform: 'uppercase',
            padding: '4px 10px', borderRadius: '6px', cursor: 'pointer',
            fontWeight: 500
          }}
        >
          {p.copied ? '✓ copied' : 'Copy'}
        </button>
      </div>
      <div style={{
        padding: '12px 14px',
        border: '1px solid var(--rule, rgba(216,203,174,.18))',
        background: 'rgba(11,27,45,.4)',
        borderRadius: '8px',
        fontSize: p.multiline ? '13px' : '14px',
        color: 'var(--cream, #F5EFE3)',
        whiteSpace: p.multiline ? 'pre-wrap' : 'normal',
        lineHeight: p.multiline ? 1.6 : 1.4,
        fontFamily: 'var(--sans, "Inter", system-ui, sans-serif)'
      }}>
        {p.value}
      </div>
    </div>
  );
}
