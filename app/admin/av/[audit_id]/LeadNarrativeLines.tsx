'use client';

/**
 * LeadNarrativeLines  (#46 spine Inc 1)
 *
 * The narrative spine, seen FROM the lead. Shows the 2-4 active lines for this
 * lead's owner (the client's lines if assigned, the brand's house lines if not)
 * tagged with link status + the keywords the lead shares with each line. One
 * click links/unlinks; a role picker lets val choose advances / reinforces /
 * tests. This is the smallest visible piece of "every asset attaches to one
 * line" — the operator sees the connection at the point of decision.
 *
 * Renders nothing when there are no active lines for the owner (the panel
 * adds no visual weight until the owner actually has lines to steer on).
 */
import { useCallback, useEffect, useState } from 'react';
import type { LinkRole } from '@/lib/campaigns/line_links';

interface LineForLead {
  lineId: number;
  name: string;
  state: 'candidate' | 'active' | 'reinforcing' | 'retiring';
  thesis: string | null;
  audience: string | null;
  role: LinkRole | null;
  shared: string[];
}

const ROLES: LinkRole[] = ['advances', 'reinforces', 'tests'];

function roleColor(role: LinkRole): { bg: string; border: string; text: string } {
  // Same palette as the cockpit role chips so the two surfaces feel like one
  // language. Greens for advance (forward motion), amber for reinforce
  // (proven, doubling down), violet for tests (experiment).
  if (role === 'advances') return { bg: 'rgba(134,239,172,0.10)', border: 'rgba(134,239,172,0.40)', text: '#86efac' };
  if (role === 'reinforces') return { bg: 'rgba(253,230,138,0.10)', border: 'rgba(253,230,138,0.40)', text: '#fde68a' };
  return { bg: 'rgba(196,181,253,0.10)', border: 'rgba(196,181,253,0.40)', text: '#c4b5fd' };
}

export function LeadNarrativeLines({ auditId }: { auditId: string }) {
  const [lines, setLines] = useState<LineForLead[] | null>(null);
  const [busyLineId, setBusyLineId] = useState<number | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestMsg, setSuggestMsg] = useState<{ kind: 'ok' | 'soft'; text: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/admin/av/leads/${auditId}/narrative-lines`, { cache: 'no-store' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErr(j.error ?? `HTTP ${r.status}`);
        setLines([]);
        return;
      }
      setLines(j.lines ?? []);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
      setLines([]);
    }
  }, [auditId]);

  useEffect(() => { void load(); }, [load]);

  const link = useCallback(async (lineId: number, role: LinkRole) => {
    setBusyLineId(lineId);
    try {
      const r = await fetch(`/api/admin/av/leads/${auditId}/narrative-lines`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lineId, role })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErr(j.error ?? `HTTP ${r.status}`);
        return;
      }
      setLines(j.lines ?? []);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusyLineId(null);
    }
  }, [auditId]);

  const suggest = useCallback(async () => {
    setSuggesting(true);
    setSuggestMsg(null);
    setErr(null);
    try {
      const r = await fetch(`/api/admin/av/leads/${auditId}/narrative-lines`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ suggest: true })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErr(j.error ?? `HTTP ${r.status}`);
        return;
      }
      setLines(j.lines ?? []);
      if (j.ok) {
        const picked = (j.lines ?? []).find((l: LineForLead) => l.lineId === j.suggestedLineId);
        const shared = Array.isArray(j.shared) ? j.shared.join(', ') : '';
        setSuggestMsg({
          kind: 'ok',
          text: picked
            ? `Linked to “${picked.name}” as advances${shared ? ` · matched on: ${shared}` : ''}`
            : 'Best-fit line linked.'
        });
      } else {
        setSuggestMsg({ kind: 'soft', text: j.reason ?? 'No clear fit.' });
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSuggesting(false);
    }
  }, [auditId]);

  const unlink = useCallback(async (lineId: number) => {
    setBusyLineId(lineId);
    try {
      const r = await fetch(`/api/admin/av/leads/${auditId}/narrative-lines`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lineId })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErr(j.error ?? `HTTP ${r.status}`);
        return;
      }
      setLines(j.lines ?? []);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusyLineId(null);
    }
  }, [auditId]);

  // Hide entirely when there are no active lines for this owner — adds zero
  // visual weight until the owner has lines to steer on (preserves "client
  // surfaces hide all machinery" energy on the operator side too).
  if (lines === null) return null;
  if (lines.length === 0) return null;

  return (
    <div className="bg-surface border border-border rounded-xl p-4 mb-4">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">Narrative lines this lead supports</h2>
          <p className="text-[11px] text-muted mt-0.5">
            Link the lead to a story so every asset for it advances the same thesis.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* (#46 Inc 2) One-click "pick the best line for me." Greys out when
              everything's already linked or no line clears the overlap floor;
              the soft reason renders below the header. */}
          <button
            type="button"
            onClick={suggest}
            disabled={suggesting || lines.every((l) => l.role != null)}
            title="Pick the best-fit line by shared keywords and link this lead as advances."
            className={
              'text-[11px] px-2.5 py-1 rounded-md border transition ' +
              (suggesting || lines.every((l) => l.role != null)
                ? 'border-white/10 text-white/30 cursor-not-allowed'
                : 'border-amber-400/30 text-amber-200 hover:border-amber-400/60 bg-amber-400/5')
            }
          >
            {suggesting ? '✨ thinking…' : '✨ Suggest best'}
          </button>
          {err && <span className="text-[11px]" style={{ color: '#fca5a5' }}>{err}</span>}
        </div>
      </div>
      {suggestMsg && (
        <div
          className="text-[11px] mb-2 leading-snug"
          style={{ color: suggestMsg.kind === 'ok' ? '#86efac' : '#fde68a' }}
        >
          {suggestMsg.text}
        </div>
      )}

      <ul className="flex flex-col gap-2">
        {lines.map((line) => {
          const busy = busyLineId === line.lineId;
          const linked = line.role != null;
          const color = linked ? roleColor(line.role!) : null;
          return (
            <li
              key={line.lineId}
              className="border border-border rounded-lg p-3 bg-black/10 flex flex-col gap-2"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-ink truncate">{line.name}</span>
                    <span className="text-[10px] uppercase tracking-wide text-muted">
                      {line.state}
                    </span>
                    {linked && color && (
                      <span
                        className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded"
                        style={{
                          backgroundColor: color.bg,
                          border: `1px solid ${color.border}`,
                          color: color.text
                        }}
                      >
                        {line.role}
                      </span>
                    )}
                  </div>
                  {line.thesis && (
                    <p className="text-[12px] text-muted mt-1 line-clamp-2">{line.thesis}</p>
                  )}
                  {line.shared.length > 0 && (
                    <p className="text-[11px] text-muted mt-1">
                      matched on: <span className="text-ink/80">{line.shared.join(', ')}</span>
                    </p>
                  )}
                </div>
                <div className="shrink-0 flex items-center gap-1.5">
                  {!linked ? (
                    ROLES.map((role) => (
                      <button
                        key={role}
                        type="button"
                        disabled={busy}
                        onClick={() => link(line.lineId, role)}
                        title={`Link this lead to ${line.name} as ${role}`}
                        className={
                          'text-[11px] px-2 py-1 rounded-md border transition ' +
                          (busy
                            ? 'border-white/10 text-white/30 cursor-not-allowed'
                            : 'border-border text-ink hover:border-amber-400/40 bg-black/20')
                        }
                      >
                        {busy ? '…' : `Link · ${role}`}
                      </button>
                    ))
                  ) : (
                    <>
                      {ROLES.filter((r) => r !== line.role).map((role) => (
                        <button
                          key={role}
                          type="button"
                          disabled={busy}
                          onClick={() => link(line.lineId, role)}
                          title={`Change role to ${role}`}
                          className={
                            'text-[11px] px-2 py-1 rounded-md border transition ' +
                            (busy
                              ? 'border-white/10 text-white/30 cursor-not-allowed'
                              : 'border-border text-ink hover:border-amber-400/40 bg-black/20')
                          }
                        >
                          → {role}
                        </button>
                      ))}
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => unlink(line.lineId)}
                        title="Unlink this lead from this line"
                        className={
                          'text-[11px] px-2 py-1 rounded-md border transition ' +
                          (busy
                            ? 'border-white/10 text-white/30 cursor-not-allowed'
                            : 'border-border text-muted hover:border-rose-400/40 hover:text-rose-300 bg-black/20')
                        }
                      >
                        {busy ? '…' : 'Unlink'}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
