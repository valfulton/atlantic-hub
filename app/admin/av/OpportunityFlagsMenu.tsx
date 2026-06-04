'use client';
/**
 * OpportunityFlagsMenu  (#296 / #183)
 *
 * Header dropdown showing leads that heated up in the last 24h. Same
 * architecture as InvestorsMenu / Conductor link — sits in the cockpit
 * top-right strip, fires a button-rooted floating panel, closes on
 * outside-click / Escape.
 *
 * Per-operator dismissal lives in localStorage (`av-flags-dismissed-v1`).
 * Dismissed IDs are kept for 14 days then cycled out so a re-hot lead
 * resurfaces. The trigger badge shows the un-dismissed count and quietly
 * disappears when there are no flags worth showing.
 *
 * Visual rules (the contrast rule):
 *   - Trigger uses bg-brand text-black when count > 0; otherwise neutral
 *     border-only chip so it doesn't always shout amber.
 *   - Each row hover is amber-tinted, never solid amber.
 *   - "Dismiss" link sits muted-on-dark.
 */
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
// (#305) Import from the meta sidecar — NOT from opportunity_flags.ts —
// so this client bundle doesn't try to drag mysql2 + Node net/tls into
// the browser via the DB-call transitive imports.
import { SIGNAL_COPY, type OpportunityFlag, type FlagSignal } from '@/lib/av/opportunity_flags_meta';

const STORAGE_KEY = 'av-flags-dismissed-v1';
const DISMISS_TTL_MS = 14 * 24 * 60 * 60 * 1000;

interface DismissMap {
  [leadId: string]: number; // timestamp ms
}

function readDismissed(): Set<number> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const map = JSON.parse(raw) as DismissMap;
    const now = Date.now();
    const out = new Set<number>();
    for (const [k, ts] of Object.entries(map)) {
      if (typeof ts === 'number' && now - ts < DISMISS_TTL_MS) {
        const n = Number(k);
        if (Number.isFinite(n)) out.add(n);
      }
    }
    return out;
  } catch {
    return new Set();
  }
}

function writeDismissed(set: Set<number>): void {
  try {
    const out: DismissMap = {};
    const now = Date.now();
    set.forEach((id) => { out[String(id)] = now; });
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(out));
  } catch {
    /* storage quota / disabled — non-fatal */
  }
}

function ago(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const mins = Math.max(0, Math.round((now - then) / 60_000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export function OpportunityFlagsMenu({ flags }: { flags: OpportunityFlag[] }) {
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Hydrate dismissed set from localStorage after mount (SSR-safe).
  useEffect(() => {
    setDismissed(readDismissed());
  }, []);

  // Close on outside click + Escape.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const visible = flags.filter((f) => !dismissed.has(f.leadId));
  const count = visible.length;

  function dismissOne(leadId: number) {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(leadId);
      writeDismissed(next);
      return next;
    });
  }
  function dismissAll() {
    setDismissed((prev) => {
      const next = new Set(prev);
      visible.forEach((f) => next.add(f.leadId));
      writeDismissed(next);
      return next;
    });
  }

  // (#293/#296) Contrast rule — trigger flips to bg-brand text-black ONLY
  // when there's something to show. Otherwise stays a quiet neutral chip so
  // we don't ALWAYS shout amber from the header.
  const triggerClass = count > 0
    ? 'bg-brand text-black hover:opacity-90'
    : 'border border-border bg-surface text-muted hover:border-brand/50 hover:text-ink';

  return (
    <div ref={wrapRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`text-xs font-medium px-2.5 py-1.5 rounded-md inline-flex items-center gap-1.5 transition ${triggerClass}`}
        title={
          count > 0
            ? `${count} lead${count === 1 ? '' : 's'} heated up in the last 24h`
            : 'No new opportunity flags right now'
        }
      >
        <span>🔥</span>
        <span>Hot inbox</span>
        {count > 0 && (
          <span
            className="text-[10px] font-semibold tabular-nums rounded-full px-1.5 py-[1px]"
            style={{ backgroundColor: 'rgba(0,0,0,0.18)', color: 'inherit' }}
          >
            {count}
          </span>
        )}
        {count > 0 && (
          <span
            aria-hidden="true"
            className="text-[10px] ml-0.5"
            style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform 120ms ease' }}
          >
            ▾
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-[360px] rounded-xl border border-border shadow-2xl z-50 overflow-hidden"
          style={{ backgroundColor: '#0e1420' }}
        >
          <div className="px-4 py-3 border-b border-border bg-gradient-to-b from-[#EBCB6B]/[0.06] to-transparent flex items-baseline justify-between gap-2">
            <div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-brand">Hot inbox</div>
              <div className="text-sm text-ink mt-0.5 font-medium">
                {count > 0
                  ? `${count} lead${count === 1 ? '' : 's'} heated up · last 24h`
                  : 'All quiet'}
              </div>
            </div>
            {count > 0 && (
              <button
                type="button"
                onClick={dismissAll}
                className="text-[11px] text-muted hover:text-ink underline-offset-2 hover:underline shrink-0"
                title="Dismiss every signal in this list. They will not reappear for 14 days unless they re-heat."
              >
                Dismiss all
              </button>
            )}
          </div>

          {count === 0 ? (
            <div className="px-4 py-8 text-center">
              <div className="text-2xl mb-2" aria-hidden="true">🌊</div>
              <p className="text-[12.5px] text-muted leading-relaxed">
                Nothing new to chase right now. The watch will tap you on the shoulder when a lead heats up.
              </p>
            </div>
          ) : (
            <ul className="max-h-[60vh] overflow-y-auto divide-y divide-[var(--border)]">
              {visible.map((flag) => (
                <FlagRow
                  key={`${flag.leadId}-${flag.signal}`}
                  flag={flag}
                  onDismiss={() => dismissOne(flag.leadId)}
                  onNavigate={() => setOpen(false)}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function FlagRow({
  flag,
  onDismiss,
  onNavigate
}: {
  flag: OpportunityFlag;
  onDismiss: () => void;
  onNavigate: () => void;
}) {
  const sig = SIGNAL_COPY[flag.signal as FlagSignal];
  const href = flag.auditId ? `/admin/av/${flag.auditId}` : '/admin/av';
  return (
    <li className="group hover:bg-[#EBCB6B]/[0.04] transition">
      <div className="flex items-start gap-2.5 px-4 py-2.5">
        <span className="text-base leading-none mt-0.5 shrink-0" aria-hidden="true">
          {sig.emoji}
        </span>
        <div className="min-w-0 flex-1">
          <Link
            href={href}
            onClick={onNavigate}
            className="text-[13px] text-ink font-medium leading-snug hover:text-[#EBCB6B]/95 transition block truncate"
          >
            {flag.company}
          </Link>
          <div className="text-[11px] mt-0.5 leading-snug flex items-center gap-1.5 flex-wrap">
            <span style={{ color: sig.fg }} className="font-medium">
              {sig.label}
            </span>
            <span className="text-muted/80">·</span>
            <span className="text-ink/85 tabular-nums">{Math.round(flag.score)}</span>
            {flag.clientName && (
              <>
                <span className="text-muted/80">·</span>
                <span className="text-muted/90 truncate max-w-[140px]">{flag.clientName}</span>
              </>
            )}
            <span className="text-muted/80">·</span>
            <span className="text-muted/80">{ago(flag.firedAt)}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label={`Dismiss ${flag.company}`}
          title="Dismiss — won't reappear for 14 days unless this lead heats up again."
          className="text-[11px] text-muted/60 hover:text-rose-200 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 px-1"
        >
          ✕
        </button>
      </div>
    </li>
  );
}
