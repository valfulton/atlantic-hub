'use client';
import Link from 'next/link';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';
import { DataTable, Column } from '@/components/DataTable';
import { StatusBadge } from '@/components/StatusBadge';

/**
 * (#284) Custom-event name used to ship the current row selection from
 * AvLeadsTable up to the BatchEnrichAllButton in the page header. Both
 * components are client components but they live in different subtrees, so
 * a window-level event is the cleanest way to share without restructuring
 * the whole page into one client tree. Detail shape: { auditIds: string[] }.
 */
export const AV_LEAD_SELECTION_EVENT = 'av-leads-selection-change';

export interface AvLead {
  id: number;
  auditId: string;
  company: string;
  contactName: string | null;
  contactTitle: string | null;
  email: string;
  phone: string | null;
  website: string | null;
  industry: string | null;
  leadStatus: string;
  aiScore: number | null;
  aiScoreBand: string | null;
  aiScoreReason?: string | null;
  aiScoreBreakdown?: {
    fit: number;
    intent: number;
    reachability: number;
    icp_match: number;
  } | null;
  aiEngagementScore?: number;
  aiCombinedScore?: number | null;
  engagementScoreUpdatedAt?: string | null;
  painPointProfile?: {
    primary_pain?: string;
    urgency_signal?: 'high' | 'medium' | 'low' | 'unknown';
    timing_signal?: 'now' | 'this_quarter' | 'later' | 'unknown';
  } | null;
  painExtractedAt?: string | null;
  assignedToUserId?: number | null;
  handedToOwnerAt?: string | null;
  wakeAtDate?: string | null;
  parkedReason?: string | null;
  submissionDate: string;
  sourceType: string;
  targetBusiness: 'av' | 'ebw' | 'both';
  clientId: number | null;
  enrichmentStatus: string | null;
  enrichedAt: string | null;
  hasRealEmail: boolean;
  hasPhone: boolean;
  hasWebsite: boolean;
  hasContactName: boolean;
  completeness: number;
}

/**
 * Pipeline badge — which business this lead belongs to.
 * AV (agency only), EBW (charter only), AV+EBW (both pipelines, notes shared).
 */
function TargetBadge({ target }: { target: 'av' | 'ebw' | 'both' }) {
  if (target === 'both') {
    return (
      <span
        title="Visible in /admin/av AND /admin/ebw. Notes shared across both views."
        className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider bg-purple-500/15 text-purple-300 border border-purple-500/30"
      >
        AV+EBW
      </span>
    );
  }
  if (target === 'ebw') {
    return (
      <span
        title="Events by Water pipeline"
        className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider bg-cyan-500/15 text-cyan-300 border border-cyan-500/30"
      >
        EBW
      </span>
    );
  }
  return (
    <span
      title="Atlantic & Vine pipeline"
      className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider bg-slate-500/15 text-slate-300 border border-slate-500/30"
    >
      AV
    </span>
  );
}

/**
 * Per-row archive button. Soft delete — sets archived_at = NOW(). The lead
 * disappears from the list (which filters WHERE archived_at IS NULL) but
 * stays in the DB; restore from the lead detail page.
 */
function ArchiveButton({ auditId, company }: { auditId: string; company: string }) {
  const router = useRouter();
  async function handleClick() {
    const ok = window.confirm(
      `Archive "${company}"?\n\nIt will be hidden from the leads list. You can restore it from the lead's detail page.`
    );
    if (!ok) return;
    try {
      const res = await fetch(`/api/admin/av/leads/${auditId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived: true })
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        alert(`Archive failed (${res.status})\n${body.slice(0, 300)}`);
        return;
      }
      router.refresh();
    } catch (err) {
      alert(`Archive failed: ${(err as Error).message}`);
    }
  }
  return (
    <button
      type="button"
      onClick={handleClick}
      title={`Archive ${company}`}
      className="text-muted hover:text-red-400 transition-colors text-base leading-none px-1"
      aria-label={`Archive ${company}`}
    >
      ×
    </button>
  );
}

function CompletenessBadge({ lead }: { lead: AvLead }) {
  const score = lead.completeness;
  const color = score === 4 ? 'text-green-400' : score >= 2 ? 'text-amber-400' : 'text-muted';
  const indicators = [
    { label: 'name', ok: lead.hasContactName },
    { label: 'email', ok: lead.hasRealEmail },
    { label: 'phone', ok: lead.hasPhone },
    { label: 'web', ok: lead.hasWebsite }
  ];
  return (
    <div className="flex items-center gap-1.5">
      <span className={`text-xs font-medium ${color}`}>{score}/4</span>
      <div className="flex gap-0.5">
        {indicators.map((i) => (
          <span
            key={i.label}
            title={i.label}
            className={`inline-block w-1.5 h-1.5 rounded-full ${i.ok ? 'bg-green-500' : 'bg-border'}`}
          />
        ))}
      </div>
    </div>
  );
}

function formatRelative(iso: string | null): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = now - then;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function EnrichmentCell({ lead }: { lead: AvLead }) {
  const s = lead.enrichmentStatus;
  if (s === 'enriched') {
    return (
      <span className="inline-flex items-center gap-1 text-xs">
        <span className="text-amber-400">✨</span>
        <span className="text-muted">{formatRelative(lead.enrichedAt)}</span>
      </span>
    );
  }
  if (s === 'failed_no_domain') {
    return <span className="text-[10px] uppercase tracking-wider text-muted">no website</span>;
  }
  if (s === 'failed_no_results') {
    return <span className="text-[10px] uppercase tracking-wider text-muted">no results</span>;
  }
  if (s === 'in_progress') {
    return <span className="text-[10px] uppercase tracking-wider text-amber-300">in progress</span>;
  }
  if (s === 'failed_permanent') {
    return <span className="text-[10px] uppercase tracking-wider text-red-400">stopped</span>;
  }
  return <span className="text-xs text-muted/60">—</span>;
}

interface SortableHeaderProps {
  label: string;
  sortKey: string;
  currentSort: string;
  currentDirection: 'asc' | 'desc';
}

function SortableHeader({ label, sortKey, currentSort, currentDirection }: SortableHeaderProps) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const isActive = currentSort === sortKey;
  const nextDirection = isActive && currentDirection === 'asc' ? 'desc' : 'asc';
  const arrow = isActive ? (currentDirection === 'asc' ? ' ↑' : ' ↓') : '';

  function handleClick() {
    const next = new URLSearchParams(params.toString());
    next.set('sort', sortKey);
    next.set('direction', nextDirection);
    router.push(`${pathname}?${next.toString()}`);
  }

  return (
    <button
      onClick={handleClick}
      className={`text-left text-xs uppercase tracking-wider font-medium hover:text-ink transition-colors ${
        isActive ? 'text-ink' : 'text-muted'
      }`}
    >
      {label}
      <span className="inline-block w-3">{arrow}</span>
    </button>
  );
}

export function AvLeadsTable({
  leads,
  sortKey = 'submitted',
  sortDirection = 'desc'
}: {
  leads: AvLead[];
  sortKey?: string;
  sortDirection?: 'asc' | 'desc';
}) {
  // (#284) Row selection — lets val pick specific leads to bulk-enrich. The
  // BatchEnrichAllButton in the page header listens for AV_LEAD_SELECTION_EVENT
  // and uses the selected audit_ids over its default "first N visible" pick.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // (#285) "Just enriched" tracker. When the batch button fires
  // 'av-leads-just-enriched', we (a) drop those IDs from selection so val
  // can't accidentally re-pick them and (b) keep them in justEnriched so the
  // row renders a ✨ marker — answers her "i can't tell which ones i ran"
  // problem without a DB schema change.
  //
  // (#286) Persisted to localStorage so the ✨ survives page reloads and
  // navigating away to a lead detail + back. Without persistence the marker
  // disappeared the moment the React tree unmounted, which is exactly what
  // val hit. Entries auto-expire after 7 days so the table doesn't carry a
  // permanent badge for ancient runs.
  const STORAGE_KEY = 'av-just-enriched-v1';
  const TTL_MS = 7 * 24 * 60 * 60 * 1000;
  const [justEnriched, setJustEnriched] = useState<Set<string>>(new Set());
  // Load persisted set on mount, dropping expired entries.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, number>;
      const now = Date.now();
      const fresh = new Set<string>();
      for (const [auditId, stampedAt] of Object.entries(parsed)) {
        if (typeof stampedAt === 'number' && now - stampedAt < TTL_MS) {
          fresh.add(auditId);
        }
      }
      if (fresh.size > 0) setJustEnriched(fresh);
    } catch {
      /* corrupt storage — start fresh */
    }
  }, []);
  // Persist whenever the set changes.
  useEffect(() => {
    try {
      const now = Date.now();
      const map: Record<string, number> = {};
      // Merge: preserve prior timestamps where they exist; stamp now() for new ones.
      const prev = (() => {
        try {
          const raw = window.localStorage.getItem(STORAGE_KEY);
          return raw ? (JSON.parse(raw) as Record<string, number>) : {};
        } catch { return {}; }
      })();
      justEnriched.forEach((id) => {
        map[id] = typeof prev[id] === 'number' ? prev[id] : now;
      });
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
    } catch {
      /* storage quota / disabled — non-fatal */
    }
  }, [justEnriched]);

  // Re-emit when leads list shape changes (filter / sort change) so the header
  // checkbox + button label stay in sync with what's actually on screen.
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent(AV_LEAD_SELECTION_EVENT, { detail: { auditIds: Array.from(selected) } })
    );
  }, [selected]);

  // Listen for batch-finished events from BatchEnrichAllButton. Auto-deselect
  // + mark visually.
  useEffect(() => {
    function onJustEnriched(e: Event) {
      const detail = (e as CustomEvent<{ auditIds?: string[] }>).detail;
      const ids = Array.isArray(detail?.auditIds) ? detail.auditIds : [];
      if (ids.length === 0) return;
      setSelected((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      });
      setJustEnriched((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.add(id));
        return next;
      });
    }
    window.addEventListener('av-leads-just-enriched', onJustEnriched);
    return () => window.removeEventListener('av-leads-just-enriched', onJustEnriched);
  }, []);

  const visibleIds = leads.map((l) => l.auditId);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const someVisibleSelected = visibleIds.some((id) => selected.has(id));

  function toggleAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        visibleIds.forEach((id) => next.delete(id));
      } else {
        visibleIds.forEach((id) => next.add(id));
      }
      return next;
    });
  }
  function toggleOne(auditId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(auditId)) next.delete(auditId);
      else next.add(auditId);
      return next;
    });
  }

  const COLUMNS: Column<AvLead>[] = [
    {
      key: '__select',
      header: (
        <input
          type="checkbox"
          checked={allVisibleSelected}
          ref={(el) => {
            if (el) el.indeterminate = !allVisibleSelected && someVisibleSelected;
          }}
          onChange={toggleAllVisible}
          className="cursor-pointer w-4 h-4 accent-amber-400"
          title={allVisibleSelected ? 'Unselect all visible' : 'Select all visible'}
          aria-label="Select all visible leads"
        />
      ),
      render: (r) => (
        <div className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={selected.has(r.auditId)}
            onChange={() => toggleOne(r.auditId)}
            className="cursor-pointer w-4 h-4 accent-amber-400"
            aria-label={`Select ${r.company}`}
          />
          {justEnriched.has(r.auditId) && (
            <span
              className="text-amber-400 text-sm"
              title="Enriched in this session (Smart + Places + IG + WHOIS)"
              aria-label="just enriched"
            >
              ✨
            </span>
          )}
        </div>
      )
    },
    {
      key: 'company',
      header: <SortableHeader label="Company" sortKey="company" currentSort={sortKey} currentDirection={sortDirection} />,
      render: (r) => (
        <Link href={`/admin/av/${r.auditId}`} className="text-brand hover:underline font-medium">
          {r.company}
        </Link>
      )
    },
    {
      key: 'target',
      header: (
        <span
          className="text-xs uppercase tracking-wider text-muted"
          title="Which pipeline this lead belongs to. AV+EBW means notes are shared between both views."
        >
          For
        </span>
      ),
      render: (r) => <TargetBadge target={r.targetBusiness} />
    },
    {
      key: 'contact',
      header: <SortableHeader label="Contact" sortKey="contact" currentSort={sortKey} currentDirection={sortDirection} />,
      render: (r) => (
        <div>
          <div>{r.contactName ?? <span className="text-muted">—</span>}</div>
          {r.contactTitle && <div className="text-xs text-muted">{r.contactTitle}</div>}
        </div>
      )
    },
    {
      key: 'email',
      header: <SortableHeader label="Email" sortKey="email" currentSort={sortKey} currentDirection={sortDirection} />,
      render: (r) => <span className="text-sm">{r.email}</span>
    },
    {
      key: 'industry',
      header: <SortableHeader label="Industry" sortKey="industry" currentSort={sortKey} currentDirection={sortDirection} />,
      render: (r) => r.industry ?? <span className="text-muted">—</span>
    },
    {
      key: 'status',
      header: <SortableHeader label="Stage" sortKey="status" currentSort={sortKey} currentDirection={sortDirection} />,
      render: (r) => <StatusBadge value={r.leadStatus} />
    },
    {
      key: 'ai',
      header: <SortableHeader label="AI Score" sortKey="score" currentSort={sortKey} currentDirection={sortDirection} />,
      render: (r) => {
        if (!r.aiScoreBand) return <span className="text-muted text-xs">pending</span>;
        // Living Score: visible number is ai_combined_score when present;
        // ai_score is the static fit fallback. Engagement delta gets a small
        // directional badge so the sales team can see the lead is moving.
        const visible = r.aiCombinedScore ?? r.aiScore;
        const delta = r.aiEngagementScore ?? 0;
        return (
          <div className="flex items-center gap-1.5">
            <StatusBadge value={r.aiScoreBand} />
            {visible !== null && (
              <span className="text-xs text-muted tabular-nums">{visible}</span>
            )}
            {delta !== 0 && (
              <span
                className={
                  delta > 0
                    ? 'text-[10px] tabular-nums text-emerald-300'
                    : 'text-[10px] tabular-nums text-rose-300'
                }
                title={`Engagement ${delta > 0 ? '+' : ''}${delta} since last fit-score`}
              >
                {delta > 0 ? '+' : ''}{delta}
              </span>
            )}
          </div>
        );
      }
    },
    {
      key: 'enrichment',
      header: <SortableHeader label="Enriched" sortKey="enriched" currentSort={sortKey} currentDirection={sortDirection} />,
      render: (r) => <EnrichmentCell lead={r} />
    },
    {
      key: 'completeness',
      header: (
        <span
          className="text-xs uppercase tracking-wider text-muted"
          title="Data completeness — name, real email, phone, website. Green = present."
        >
          Data
        </span>
      ),
      render: (r) => <CompletenessBadge lead={r} />
    },
    {
      key: 'date',
      header: <SortableHeader label="Submitted" sortKey="submitted" currentSort={sortKey} currentDirection={sortDirection} />,
      render: (r) =>
        new Date(r.submissionDate).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric'
        })
    },
    {
      key: 'archive',
      header: <span className="sr-only">Archive</span>,
      render: (r) => <ArchiveButton auditId={r.auditId} company={r.company} />
    }
  ];

  return (
    <DataTable
      columns={COLUMNS}
      rows={leads}
      emptyMessage="No leads match the current filter. Leads arrive via the atlanticandvine.com audit form."
      // (#285) Tint rows that were enriched in this browser session so val
      // can scan the table and instantly see which leads she's already hit.
      rowClassName={(row) => (justEnriched.has(row.auditId) ? 'bg-amber-400/[0.04]' : '')}
    />
  );
}
