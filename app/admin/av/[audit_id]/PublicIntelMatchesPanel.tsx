'use client';

/**
 * PublicIntelMatchesPanel  (#370, val 2026-06-02)
 *
 * Renders the Public Intelligence records that match THIS lead on the
 * operator lead-detail Identity tab. Visibility-gap rule applied to Driver 8:
 * the moment a record lands in public_intel_records, it should appear where
 * the operator works.
 *
 * Self-hides when there are no matches yet (cleaner than an "empty" pill).
 * Grouped by source_kind. Tells val the match reason inline so she trusts it
 * ("matched on region: FL" vs "company-name match").
 */
import { useState } from 'react';

interface PublicIntelMatch {
  recordId: number;
  sourceKind: string;
  entityKey: string;
  summaryLabel: string | null;
  regionCode: string | null;
  record: unknown;
  fetchedAt: string;
  matchReason: 'client' | 'region' | 'company';
}

const SOURCE_LABELS: Record<string, string> = {
  hmda: 'HMDA mortgage data',
  cfpb: 'CFPB consumer complaints',
  census_acs: 'Census ACS',
  ca_sos: 'CA Secretary of State',
  ca_recorder: 'CA County Recorder',
  datasf: 'DataSF',
  la_assessor: 'LA Assessor'
};

const REASON_LABEL: Record<PublicIntelMatch['matchReason'], string> = {
  client: 'this client',
  region: 'state match',
  company: 'company-name match'
};

const REASON_COLOR: Record<PublicIntelMatch['matchReason'], string> = {
  client: 'text-emerald-300',
  region: 'text-amber-200',
  company: 'text-blue-300'
};

function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const d = Math.round(ms / (24 * 60 * 60 * 1000));
  if (d < 1) return 'today';
  if (d === 1) return '1d ago';
  if (d < 30) return `${d}d ago`;
  return `${Math.round(d / 30)}mo ago`;
}

export default function PublicIntelMatchesPanel({ matches }: { matches: PublicIntelMatch[] | null | undefined }) {
  const [open, setOpen] = useState(false);
  if (!matches || matches.length === 0) return null;

  // Group by source_kind so val can scan "HMDA · CFPB · CA SOS" at a glance.
  const byKind: Record<string, PublicIntelMatch[]> = {};
  for (const m of matches) {
    (byKind[m.sourceKind] ??= []).push(m);
  }
  const kinds = Object.keys(byKind).sort();

  return (
    <div className="col-span-full">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-3 text-left rounded-lg border border-brand/30 bg-brand/[0.05] px-3 py-2 hover:bg-brand/[0.10] transition-colors"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10.5px] uppercase tracking-[0.14em] text-brand">Public records for this lead</span>
          <span className="text-[11px] text-ink/85">
            {kinds.map((k) => SOURCE_LABELS[k] ?? k).join(' · ')} ({matches.length})
          </span>
        </div>
        <span className="text-[10.5px] uppercase tracking-[0.14em] text-brand/80">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && (
        <div className="mt-3 grid gap-3 rounded-2xl border border-border bg-bg/40 p-4">
          {kinds.map((k) => (
            <section key={k}>
              <h4 className="text-[11px] uppercase tracking-[0.14em] text-ink/85 font-medium mb-1.5">
                {SOURCE_LABELS[k] ?? k}
              </h4>
              <ul className="grid gap-1">
                {byKind[k].map((m) => (
                  <li key={m.recordId} className="flex items-start gap-2 text-[12px]">
                    <span className={`shrink-0 text-[10px] uppercase tracking-[0.12em] ${REASON_COLOR[m.matchReason]}`}>
                      {REASON_LABEL[m.matchReason]}
                    </span>
                    <span className="text-ink/90 truncate flex-1">
                      {m.summaryLabel ?? m.entityKey}
                    </span>
                    <span className="shrink-0 text-muted text-[11px]">{relTime(m.fetchedAt)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <p className="text-[10.5px] text-muted leading-snug mt-1">
            Pulled from this client&apos;s Public Intelligence Layer (HMDA / CFPB / Census / CA SOS / etc.).
            To add or refresh sources, open the client page → Public intelligence panel.
          </p>
        </div>
      )}
    </div>
  );
}
