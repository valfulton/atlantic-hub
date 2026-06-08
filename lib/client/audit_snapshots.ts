/**
 * lib/client/audit_snapshots.ts  (#512, val 2026-06-08)
 *
 * Parse + persist + read website audit snapshots.
 *
 * The audit_website() LLM call (lib/client/intake_web_filler.ts) produces a
 * structured markdown audit with a "## Verdict at a glance" table. We parse
 * the 7 axis scores out of that table and store them on a website_audit_
 * snapshots row, keyed by client_id + created_at. The KPI strip on the
 * operator client page reads the LATEST snapshot for that client.
 *
 * The parser is regex-based and tolerant: missing axes return null, malformed
 * tables fall back to {}. The audit still works without the parser.
 */
import { getAvDb } from '@/lib/db/av';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';

/** The 7 axes the website_audit prompt scores. Keep in lockstep with the
 *  prompt's markdown table in lib/ai/prompt_registry.ts → WEBSITE_AUDIT_DEFAULT. */
export const AUDIT_AXES = [
  'hero',
  'cta',
  'social_proof',
  'contact',
  'trust',
  'seo',
  'industry_fit'
] as const;
export type AuditAxis = (typeof AUDIT_AXES)[number];

/** Human-readable label for each axis (KPI strip headers). */
export const AXIS_LABEL: Record<AuditAxis, string> = {
  hero: 'Hero clarity',
  cta: 'CTA quality',
  social_proof: 'Social proof',
  contact: 'Contact clarity',
  trust: 'Trust signals',
  seo: 'SEO basics',
  industry_fit: 'Industry fit'
};

/** A row in the verdict table looks like:
 *    | Hero clarity | 4/10 | one sentence |
 *  Some models drop the trailing pipe; some use 4 / 10 with a space; some
 *  italicize the label. We normalize all of those. */
const AXIS_ROW_PATTERNS: Record<AuditAxis, RegExp[]> = {
  hero: [/hero\s*clarity/i, /hero/i],
  cta: [/cta\s*quality/i, /\bcta\b/i, /call[-\s]*to[-\s]*action/i],
  social_proof: [/social\s*proof/i, /testimonials?\s*\/?\s*case\s*studies?/i],
  contact: [/contact\s*clarity/i, /contact/i],
  trust: [/trust\s*signals?/i, /credentials/i],
  seo: [/seo\s*basics?/i, /\bseo\b/i],
  industry_fit: [/industry\s*fit/i, /industry\s*norms?/i, /vertical\s*fit/i]
};

const SCORE_PATTERN = /(\b(?:10|[0-9])(?:\.[0-9])?)\s*\/\s*10\b/;

export interface AuditScores {
  hero: number | null;
  cta: number | null;
  social_proof: number | null;
  contact: number | null;
  trust: number | null;
  seo: number | null;
  industry_fit: number | null;
  /** Average of non-null axes, rounded to 1 decimal. Null when nothing parsed. */
  overall_avg: number | null;
}

const EMPTY_SCORES: AuditScores = {
  hero: null,
  cta: null,
  social_proof: null,
  contact: null,
  trust: null,
  seo: null,
  industry_fit: null,
  overall_avg: null
};

/**
 * Parse the verdict table out of a markdown audit. Tolerant: skips lines that
 * don't match, accepts variations in axis label / score format.
 */
export function parseAuditScores(markdown: string | null | undefined): AuditScores {
  if (!markdown || typeof markdown !== 'string') return { ...EMPTY_SCORES };
  const out: AuditScores = { ...EMPTY_SCORES };
  const lines = markdown.split('\n');
  for (const raw of lines) {
    const line = raw.toLowerCase();
    // Heuristic: only consider lines that look like markdown table rows
    // (start with | or look like "axis: 5/10"). Skip section headers/prose.
    if (!line.includes('/10') && !line.includes('| ')) continue;
    for (const axis of AUDIT_AXES) {
      if (out[axis] !== null) continue;
      const labelHit = AXIS_ROW_PATTERNS[axis].some((re) => re.test(line));
      if (!labelHit) continue;
      const m = SCORE_PATTERN.exec(line);
      if (!m) continue;
      const n = Number.parseFloat(m[1]);
      if (Number.isFinite(n) && n >= 0 && n <= 10) {
        out[axis] = n;
      }
    }
  }
  const present = AUDIT_AXES.map((a) => out[a]).filter((v): v is number => v !== null);
  if (present.length > 0) {
    const avg = present.reduce((s, v) => s + v, 0) / present.length;
    out.overall_avg = Math.round(avg * 10) / 10;
  }
  return out;
}

/** Anything below this is a screaming weakness worth quoting them on. */
export const WEAK_AXIS_THRESHOLD = 5;

/** Returns the axes scored below WEAK_AXIS_THRESHOLD, by name. */
export function getWeakAxes(scores: AuditScores): AuditAxis[] {
  return AUDIT_AXES.filter((a) => {
    const v = scores[a];
    return typeof v === 'number' && v < WEAK_AXIS_THRESHOLD;
  });
}

export interface SnapshotInput {
  tenantId?: string;
  clientId: number | null;
  homepageUrl: string;
  industryHint: string | null;
  auditMarkdown: string;
  pagesReached: number;
  pagesFlagged: number;
  discoveryMode: string | null;
  costMicrocents: number | null;
}

export interface SnapshotRow {
  id: number;
  client_id: number | null;
  homepage_url: string;
  industry_hint: string | null;
  scores: AuditScores;
  audit_markdown: string | null;
  pages_reached: number | null;
  pages_flagged: number | null;
  discovery_mode: string | null;
  cost_microcents: number | null;
  created_at: Date;
}

/**
 * Insert a snapshot. Returns the inserted id, or null on any error (the audit
 * still works without snapshotting).
 */
export async function insertAuditSnapshot(input: SnapshotInput): Promise<number | null> {
  if (!input.auditMarkdown || input.auditMarkdown.trim().length < 100) return null;
  const scores = parseAuditScores(input.auditMarkdown);
  try {
    const db = getAvDb();
    const [r] = await db.execute<ResultSetHeader>(
      `INSERT INTO website_audit_snapshots
         (tenant_id, client_id, homepage_url, industry_hint, scores,
          audit_markdown, pages_reached, pages_flagged, discovery_mode, cost_microcents)
       VALUES (?, ?, ?, ?, CAST(? AS JSON), ?, ?, ?, ?, ?)`,
      [
        input.tenantId ?? 'av',
        input.clientId,
        input.homepageUrl.slice(0, 1024),
        input.industryHint?.slice(0, 255) ?? null,
        JSON.stringify(scores),
        input.auditMarkdown.slice(0, 60_000),
        input.pagesReached,
        input.pagesFlagged,
        input.discoveryMode?.slice(0, 16) ?? null,
        input.costMicrocents
      ]
    );
    return r.insertId || null;
  } catch (err) {
    // Most likely cause: migration 078 hasn't been applied yet. Don't break
    // the audit; just skip persistence.
    console.error('[audit_snapshots:insert]', (err as Error).message);
    return null;
  }
}

/** Latest snapshot for a client, or null. */
export async function getLatestSnapshot(clientId: number): Promise<SnapshotRow | null> {
  try {
    const db = getAvDb();
    const [rows] = await db.execute<
      (RowDataPacket & {
        id: number;
        client_id: number | null;
        homepage_url: string;
        industry_hint: string | null;
        scores: unknown;
        audit_markdown: string | null;
        pages_reached: number | null;
        pages_flagged: number | null;
        discovery_mode: string | null;
        cost_microcents: number | null;
        created_at: Date;
      })[]
    >(
      `SELECT id, client_id, homepage_url, industry_hint, scores,
              audit_markdown, pages_reached, pages_flagged, discovery_mode,
              cost_microcents, created_at
         FROM website_audit_snapshots
        WHERE client_id = ?
        ORDER BY created_at DESC
        LIMIT 1`,
      [clientId]
    );
    const r = rows[0];
    if (!r) return null;
    let scores: AuditScores = { ...EMPTY_SCORES };
    if (r.scores) {
      try {
        const parsed = typeof r.scores === 'string' ? JSON.parse(r.scores) : r.scores;
        if (parsed && typeof parsed === 'object') {
          scores = { ...EMPTY_SCORES, ...(parsed as Partial<AuditScores>) };
        }
      } catch { /* keep EMPTY_SCORES */ }
    }
    return { ...r, scores };
  } catch {
    return null;
  }
}

/** Latest snapshot per client, for the cross-client roll-up dashboard. */
export async function getLatestSnapshotsByClient(
  tenantId: string = 'av'
): Promise<SnapshotRow[]> {
  try {
    const db = getAvDb();
    const [rows] = await db.execute<
      (RowDataPacket & {
        id: number;
        client_id: number | null;
        homepage_url: string;
        industry_hint: string | null;
        scores: unknown;
        audit_markdown: string | null;
        pages_reached: number | null;
        pages_flagged: number | null;
        discovery_mode: string | null;
        cost_microcents: number | null;
        created_at: Date;
      })[]
    >(
      `SELECT s.id, s.client_id, s.homepage_url, s.industry_hint, s.scores,
              s.audit_markdown, s.pages_reached, s.pages_flagged,
              s.discovery_mode, s.cost_microcents, s.created_at
         FROM website_audit_snapshots s
         JOIN (
           SELECT client_id, MAX(created_at) AS max_at
             FROM website_audit_snapshots
            WHERE tenant_id = ?
            GROUP BY client_id
         ) latest ON latest.client_id = s.client_id AND latest.max_at = s.created_at
        WHERE s.tenant_id = ?`,
      [tenantId, tenantId]
    );
    return rows.map((r) => {
      let scores: AuditScores = { ...EMPTY_SCORES };
      if (r.scores) {
        try {
          const parsed = typeof r.scores === 'string' ? JSON.parse(r.scores) : r.scores;
          if (parsed && typeof parsed === 'object') {
            scores = { ...EMPTY_SCORES, ...(parsed as Partial<AuditScores>) };
          }
        } catch { /* skip */ }
      }
      return { ...r, scores };
    });
  } catch {
    return [];
  }
}
