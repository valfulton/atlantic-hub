/**
 * AutopilotActivity  (#241)
 *
 * Operator-side widget on the client page that surfaces the last few
 * autopilot.* events for this client — so val can see at a glance what
 * the system has done automatically, instead of having to look at logs:
 *
 *   - "Sharpened Tim's ICP from intake (12 industries, 2 geos)" — 2 min ago
 *   - "Scored 18 leads for Tim from Apollo batch" — 30s ago
 *   - "Regenerated 5 stale audits after brief edit" — just now
 *
 * Server component: no client interactivity, no polling. Re-renders when val
 * refreshes the page. Renders nothing when there's no autopilot history yet
 * (a fresh client looks clean).
 */
import { getAvDb } from '@/lib/db/av';
import type { RowDataPacket } from 'mysql2';

interface EventRow extends RowDataPacket {
  event_type: string;
  payload: string | object | null;
  created_at: string | Date;
  status: string | null;
}

const FRIENDLY: Record<string, { icon: string; label: (p: Record<string, unknown>) => string }> = {
  'autopilot.icp_sharpened': {
    icon: '◉',
    label: (p) => {
      const i = Number(p.industries_count ?? 0);
      const g = Number(p.geographies_count ?? 0);
      const ex = Number(p.excluded_count ?? 0);
      const bits = [
        i > 0 && `${i} industr${i === 1 ? 'y' : 'ies'}`,
        g > 0 && `${g} geographie${g === 1 ? '' : 's'}`,
        ex > 0 && `${ex} exclude${ex === 1 ? '' : 's'}`
      ].filter(Boolean).join(', ');
      return `Sharpened ICP from intake${bits ? ` — ${bits}` : ''}`;
    }
  },
  'autopilot.discovery_scored': {
    icon: '◎',
    label: (p) => {
      const scored = Number(p.scored ?? 0);
      const inserted = Number(p.inserted_count ?? 0);
      return `Scored ${scored} of ${inserted} new leads against ICP`;
    }
  },
  'autopilot.audit_regen_started': {
    icon: '↻',
    label: (p) => {
      const n = Number(p.lead_count ?? 0);
      return `Started refreshing ${n} stale audit${n === 1 ? '' : 's'} after brief change`;
    }
  },
  'autopilot.audit_regen_completed': {
    icon: '✓',
    label: (p) => {
      const r = Number(p.regenerated ?? 0);
      const f = Number(p.failed ?? 0);
      const tail = f > 0 ? ` (${f} failed)` : '';
      return `Refreshed ${r} audit${r === 1 ? '' : 's'}${tail}`;
    }
  },
  'autopilot.brand_kit_extracted': {
    icon: '◇',
    label: (p) => {
      const c = Number(p.colors_count ?? 0);
      const hasLogo = !!p.logo_found;
      const bits = [c > 0 && `${c} color${c === 1 ? '' : 's'}`, hasLogo && 'logo'].filter(Boolean).join(' + ');
      return `Pulled brand kit from website${bits ? ` (${bits})` : ''}`;
    }
  },
  'autopilot.discovery_audit_started': {
    icon: '▸',
    label: (p) => {
      const n = Number(p.lead_count ?? 0);
      return `Started auditing ${n} top-fit new lead${n === 1 ? '' : 's'}`;
    }
  },
  'autopilot.discovery_audited': {
    icon: '✓',
    label: (p) => {
      const a = Number(p.audited ?? 0);
      const s = Number(p.scripted ?? 0);
      const f = Number(p.failed ?? 0);
      const tail = f > 0 ? ` (${f} failed)` : '';
      return `Audited ${a} + drafted ${s} call script${s === 1 ? '' : 's'} for top-fit new leads${tail}`;
    }
  },
  'autopilot.icp_sharpen_failed': { icon: '!', label: () => 'ICP sharpen failed (will retry next brief edit)' },
  'autopilot.discovery_score_failed': { icon: '!', label: () => 'Discovery-batch scoring failed' },
  'autopilot.discovery_audit_failed': { icon: '!', label: () => 'Discovery audit failed' },
  'autopilot.audit_regen_failed': { icon: '!', label: () => 'Audit regen failed' },
  'autopilot.brand_kit_extract_failed': { icon: '!', label: () => 'Brand-kit extraction failed' }
};

function parsePayload(raw: unknown): Record<string, unknown> {
  if (raw == null) return {};
  if (typeof raw === 'object') return raw as Record<string, unknown>;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) as Record<string, unknown>; } catch { return {}; }
  }
  return {};
}

function relativeTime(when: string | Date): string {
  const t = new Date(when).getTime();
  if (!Number.isFinite(t)) return '';
  const secs = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export default async function AutopilotActivity({ clientId }: { clientId: number }) {
  let rows: EventRow[] = [];
  try {
    const db = getAvDb();
    const [r] = await db.execute<EventRow[]>(
      `SELECT event_type, payload, created_at, status
         FROM system_events
        WHERE event_type LIKE 'autopilot.%'
          AND organization_id = ?
        ORDER BY created_at DESC
        LIMIT 5`,
      [clientId]
    );
    rows = r;
  } catch {
    /* non-fatal: widget stays hidden if the query fails */
  }

  if (rows.length === 0) return null;

  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="text-[11px] uppercase tracking-[0.12em] text-muted mb-1">
        Autopilot — recent activity
      </div>
      <div className="text-[12.5px] text-white/65 mb-3 leading-relaxed">
        What the system has done for this client without you clicking. Older runs scroll off.
      </div>
      <ul className="space-y-1.5">
        {rows.map((r, i) => {
          const def = FRIENDLY[r.event_type];
          const payload = parsePayload(r.payload);
          const text = def ? def.label(payload) : r.event_type;
          const tone = r.event_type.endsWith('_failed') || r.status === 'failure';
          return (
            <li
              key={`${r.event_type}-${i}`}
              className="flex items-center gap-2.5 rounded-md border border-white/10 bg-black/15 px-2.5 py-1.5"
            >
              <span
                aria-hidden="true"
                className="inline-flex items-center justify-center w-5 text-[13px] shrink-0"
                style={{ color: tone ? '#FF9AA8' : '#6ee7b7' }}
              >
                {def?.icon ?? '•'}
              </span>
              <span className="min-w-0 flex-1 text-[12px] text-white/85 truncate">{text}</span>
              <span className="text-[10.5px] text-white/40 shrink-0 tabular-nums">
                {relativeTime(r.created_at)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
