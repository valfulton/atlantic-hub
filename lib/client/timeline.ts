/**
 * lib/client/timeline.ts
 *
 * Per-client activity timeline (#185). Unifies four streams of "what the system
 * actually did for this client" into a single ordered list val can scroll
 * through with Skip or Mike sitting beside her:
 *
 *   1. system_events    — every AI call, enrichment, discovery, error
 *   2. content_artifacts — every blog, post, release, deliverable
 *   3. intelligence_objects — every typed tag (founder_story, proof_points, ...)
 *   4. call_log         — every logged call outcome
 *
 * All reads are scoped to leads CURRENTLY owned by this client_id (so it
 * doesn't surface stale entries from when a lead lived elsewhere — same
 * no-bleed posture as guidance.ts after #188).
 *
 * Read-only. Operator-only. No external API; pure DB.
 */
import { getAvDb } from '@/lib/db/av';
import type { RowDataPacket } from 'mysql2';

// ─── Public types ────────────────────────────────────────────────────────

export type TimelineKind =
  | 'ai_call'         // AI work — audit gen, scoring, intel extraction, guidance compose
  | 'discovery'       // lead found / enriched
  | 'content'         // an artifact was drafted / published
  | 'intel'           // an intelligence_object was written
  | 'outreach'        // call logged
  | 'system'          // cron, error, status
  | 'other';

export interface TimelineItem {
  /** Stable key for React. */
  key: string;
  /** When this happened (ISO). */
  at: string;
  /** Bucketing for color + icon. */
  kind: TimelineKind;
  /** Compact event title (≤ 60 chars). */
  title: string;
  /** Optional secondary line — model used, outcome, lead it touched, etc. */
  detail?: string;
  /** Status pill — success / failure / partial / pending. */
  status: 'success' | 'failure' | 'partial' | 'pending' | 'info';
  /** Optional one-line preview of the payload (for expanding). */
  preview?: string;
  /** Lead-id this touched (if any). */
  leadId?: number | null;
  /** Source label — apollo / openai / hunter / clay / cron / manual / ... */
  source?: string | null;
  /** Where the row came from (so the panel can group / filter). */
  table: 'system_events' | 'content_artifacts' | 'intelligence_objects' | 'call_log';
}

// ─── Categorization ──────────────────────────────────────────────────────

/** Map a system_events.event_type to a timeline kind + readable title. */
function kindForEvent(eventType: string): { kind: TimelineKind; title: string } {
  // AI work
  if (eventType.startsWith('ai.') || eventType.includes('extracted') || eventType.includes('composed')) {
    return { kind: 'ai_call', title: humanizeEvent(eventType) };
  }
  // Discovery + enrichment
  if (eventType.startsWith('lead.') || eventType.startsWith('enrichment.') || eventType.startsWith('discovery.')) {
    return { kind: 'discovery', title: humanizeEvent(eventType) };
  }
  // Content engine
  if (
    eventType.startsWith('artifact.') ||
    eventType.startsWith('content.') ||
    eventType.startsWith('social.') ||
    eventType.startsWith('pr.')
  ) {
    return { kind: 'content', title: humanizeEvent(eventType) };
  }
  // Errors + cron + status
  if (eventType.startsWith('api.') || eventType.startsWith('scoring.') || eventType.includes('cron')) {
    return { kind: 'system', title: humanizeEvent(eventType) };
  }
  return { kind: 'other', title: humanizeEvent(eventType) };
}

function humanizeEvent(eventType: string): string {
  // lead.enrichment_failed -> "Lead — enrichment failed"
  const [head, ...tailParts] = eventType.split('.');
  const tail = tailParts.join('.').replace(/_/g, ' ');
  if (!tail) return cap(head);
  return `${cap(head)} — ${tail}`;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ');
}

function safeIso(d: string | Date | null | undefined): string {
  if (!d) return '';
  if (typeof d === 'string') return d;
  try { return d.toISOString(); } catch { return ''; }
}

function compactJson(v: unknown, max = 220): string {
  if (v == null) return '';
  try {
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s;
  } catch { return ''; }
}

// ─── Loader ──────────────────────────────────────────────────────────────

interface TimelineOpts {
  clientId: number;
  /** Cap on total rows returned per stream. Default 80. */
  limit?: number;
}

export async function loadClientTimeline(opts: TimelineOpts): Promise<TimelineItem[]> {
  const { clientId } = opts;
  // Limits are inlined into the SQL (not parameterized) because mysql2's
  // prepared-statement path rejects `LIMIT ?` on some MySQL versions/modes.
  // We sanitize to a positive integer first; no injection surface.
  const rawLimit = Math.max(1, Math.min(500, Math.floor(opts.limit ?? 80)));
  const limit = Number.isFinite(rawLimit) ? rawLimit : 80;
  const db = getAvDb();

  // Resolve a representative client_user. The codebase has TWO tenancy
  // conventions both prefixed `client:` — intake_extract uses client:<client_id>
  // while guidance uses client:<client_user_id>. We query BOTH tenants so the
  // timeline surfaces every per-client write site.
  let memberUserId: number | null = null;
  try {
    const [m1] = await db.execute<(RowDataPacket & { client_user_id: number })[]>(
      `SELECT client_user_id FROM client_users
        WHERE client_id = ? ORDER BY client_user_id ASC LIMIT 1`,
      [clientId]
    );
    memberUserId = m1[0]?.client_user_id ?? null;
    if (!memberUserId) {
      const [m2] = await db.execute<(RowDataPacket & { client_user_id: number })[]>(
        `SELECT client_user_id FROM brand_members
          WHERE client_id = ? AND role = 'owner'
          ORDER BY client_user_id ASC LIMIT 1`,
        [clientId]
      );
      memberUserId = m2[0]?.client_user_id ?? null;
    }
  } catch (e) {
    console.error('[timeline:member]', (e as Error).message);
  }
  const tenants: string[] = [`client:${clientId}`];
  if (memberUserId && memberUserId !== clientId) tenants.push(`client:${memberUserId}`);
  const tenantPlaceholders = tenants.map(() => '?').join(',');

  // Resolve which lead_ids currently belong to this client.
  // Defensive: each stream is wrapped in try/catch so one schema mismatch or
  // empty source can't crash the whole timeline render.
  let leadIds: number[] = [];
  try {
    const [leadRows] = await db.execute<(RowDataPacket & { id: number })[]>(
      `SELECT id FROM leads WHERE client_id = ? AND archived_at IS NULL LIMIT 500`,
      [clientId]
    );
    leadIds = leadRows.map((r) => r.id);
  } catch (e) {
    console.error('[timeline:leads]', (e as Error).message);
  }
  const leadPlaceholders = leadIds.length ? leadIds.map(() => '?').join(',') : null;

  // 1. system_events — scoped to this client's leads (or events tagged
  //    organization_id, when present, matching the client).
  type EvRow = RowDataPacket & {
    id: number;
    event_type: string;
    lead_id: number | null;
    source: string | null;
    payload: unknown;
    status: 'success' | 'failure' | 'partial' | 'pending';
    execution_time_ms: number | null;
    error_message: string | null;
    created_at: Date;
  };
  let evRows: EvRow[] = [];
  try {
    if (leadPlaceholders) {
      const [rows] = await db.execute<EvRow[]>(
        `SELECT id, event_type, lead_id, source, payload, status,
                execution_time_ms, error_message, created_at
           FROM system_events
          WHERE (lead_id IN (${leadPlaceholders}) OR organization_id = ?)
          ORDER BY created_at DESC
          LIMIT ${limit}`,
        [...leadIds, clientId]
      );
      evRows = rows;
    } else {
      const [rows] = await db.execute<EvRow[]>(
        `SELECT id, event_type, lead_id, source, payload, status,
                execution_time_ms, error_message, created_at
           FROM system_events
          WHERE organization_id = ?
          ORDER BY created_at DESC
          LIMIT ${limit}`,
        [clientId]
      );
      evRows = rows;
    }
  } catch (e) {
    console.error('[timeline:events]', (e as Error).message);
  }

  const fromEvents: TimelineItem[] = evRows.map((r) => {
    const k = kindForEvent(r.event_type);
    const detail = r.execution_time_ms
      ? `${r.execution_time_ms}ms${r.source ? ` · ${r.source}` : ''}`
      : r.source ?? undefined;
    return {
      key: `ev-${r.id}`,
      at: safeIso(r.created_at),
      kind: k.kind,
      title: k.title,
      detail,
      status: r.status,
      preview: r.error_message ?? compactJson(r.payload),
      leadId: r.lead_id,
      source: r.source,
      table: 'system_events'
    };
  });

  // 2. content_artifacts — pieces created for this client.
  type ArtRow = RowDataPacket & {
    id: number;
    artifact_type: string;
    title: string | null;
    status: string;
    model: string | null;
    lead_id: number | null;
    created_at: Date;
  };
  let artRows: ArtRow[] = [];
  try {
    const [rows] = await db.execute<ArtRow[]>(
      `SELECT id, artifact_type, title, status, model, lead_id, created_at
         FROM content_artifacts
        WHERE tenant_id IN (${tenantPlaceholders})
        ORDER BY created_at DESC
        LIMIT ${limit}`,
      tenants
    );
    artRows = rows;
  } catch (e) {
    console.error('[timeline:artifacts]', (e as Error).message);
  }

  const fromArtifacts: TimelineItem[] = artRows.map((r) => ({
    key: `art-${r.id}`,
    at: safeIso(r.created_at),
    kind: 'content',
    title: `${humanizeArtifactType(r.artifact_type)} — ${r.title?.slice(0, 60) || 'untitled'}`,
    detail: r.model ? `model: ${r.model}` : undefined,
    status: r.status === 'published' ? 'success' : 'info',
    leadId: r.lead_id,
    source: 'content_engine',
    table: 'content_artifacts'
  }));

  // 3. intelligence_objects — typed intel writes for this client.
  type IntelRow = RowDataPacket & {
    id: number;
    object_type: string;
    source: string | null;
    confidence: number | null;
    lead_id: number | null;
    updated_at: Date;
  };
  let intelRows: IntelRow[] = [];
  try {
    const [rows] = await db.execute<IntelRow[]>(
      `SELECT id, object_type, source, confidence, lead_id, updated_at
         FROM intelligence_objects
        WHERE tenant_id IN (${tenantPlaceholders})
        ORDER BY updated_at DESC
        LIMIT ${limit}`,
      tenants
    );
    intelRows = rows;
  } catch (e) {
    console.error('[timeline:intel]', (e as Error).message);
  }

  const fromIntel: TimelineItem[] = intelRows.map((r) => ({
    key: `io-${r.id}`,
    at: safeIso(r.updated_at),
    kind: 'intel',
    title: `Tagged — ${r.object_type.replace(/_/g, ' ')}`,
    detail: [
      r.source ? `source: ${r.source}` : null,
      r.confidence != null ? `conf: ${r.confidence}` : null
    ].filter(Boolean).join(' · ') || undefined,
    status: 'success',
    leadId: r.lead_id,
    source: r.source,
    table: 'intelligence_objects'
  }));

  // 4. call_log — every logged call for this client's leads.
  let fromCalls: TimelineItem[] = [];
  if (leadPlaceholders) {
    try {
      const [callRows] = await db.execute<(RowDataPacket & {
        call_log_id: number;
        lead_id: number;
        outcome: string;
        duration_seconds: number | null;
        notes: string | null;
        called_at: Date;
      })[]>(
        `SELECT call_log_id, lead_id, outcome, duration_seconds, notes, called_at
           FROM call_log
          WHERE lead_id IN (${leadPlaceholders})
          ORDER BY called_at DESC
          LIMIT ${limit}`,
        [...leadIds]
      );
      fromCalls = callRows.map((r) => ({
        key: `cl-${r.call_log_id}`,
        at: safeIso(r.called_at),
        kind: 'outreach',
        title: `Call logged — ${r.outcome.replace(/_/g, ' ')}`,
        detail: r.duration_seconds != null ? `${r.duration_seconds}s` : undefined,
        status: 'success',
        preview: r.notes ?? undefined,
        leadId: r.lead_id,
        source: 'manual',
        table: 'call_log'
      }));
    } catch (e) {
      console.error('[timeline:calls]', (e as Error).message);
    }
  }

  // ─── Merge + sort, newest first.
  const merged = [...fromEvents, ...fromArtifacts, ...fromIntel, ...fromCalls];
  merged.sort((a, b) => (a.at > b.at ? -1 : a.at < b.at ? 1 : 0));

  // Cap total returned so the page stays snappy. The UI can filter / paginate
  // from here without another DB call.
  return merged.slice(0, limit * 2);
}

function humanizeArtifactType(t: string): string {
  switch (t) {
    case 'blog_article': return 'Blog article';
    case 'seo_article': return 'SEO article';
    case 'own_brand_post': return 'Brand post';
    case 'press_release': return 'Press release';
    case 'client_deliverable': return 'Client deliverable';
    default: return t;
  }
}
