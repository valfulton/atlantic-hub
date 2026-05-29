/**
 * lib/leads/intel_freshness.ts  (#204)
 *
 * Data access for the operator-side intel-freshness view: every lead with the
 * last-refreshed timestamps for each AI artifact (audit / call script / outreach).
 * Used to answer "which leads are running on stale prompts and need a refresh?".
 *
 * Three timestamps per lead:
 *   - ai_last_scored_at   -> when the audit + score were last regenerated
 *   - pain_extracted_at   -> when the call-script (pain profile) was last extracted
 *   - last_outreach_at    -> MAX(updated_at) over the lead's outreach_messages
 *                            (any status -- the freshness signal is "did we touch
 *                            an outreach draft recently for this lead at all")
 *
 * All optional (NULL = never generated). Caller renders age badges.
 */
import { getAvDb } from '@/lib/db/av';
import type { RowDataPacket } from 'mysql2';

export interface LeadIntelFreshness {
  id: number;
  auditId: string;
  company: string;
  industry: string | null;
  contactName: string | null;
  /** Owner client_id, or null for house leads. */
  clientId: number | null;
  clientName: string | null;
  aiScore: number | null;
  aiScoreBand: 'hot' | 'warm' | 'cool' | null;
  /** When the audit was last generated. NULL = never. */
  auditAt: string | null;
  /** When the call script (pain profile) was last extracted. NULL = never. */
  callScriptAt: string | null;
  /** When an outreach message was last created/touched. NULL = none on file. */
  outreachAt: string | null;
}

interface Row extends RowDataPacket {
  id: number;
  audit_id: string;
  company: string;
  industry: string | null;
  contact_name: string | null;
  client_id: number | null;
  client_name: string | null;
  ai_score: number | null;
  ai_score_band: 'hot' | 'warm' | 'cool' | null;
  audit_at: string | null;
  call_script_at: string | null;
  outreach_at: string | null;
}

const TS = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString() : typeof v === 'string' ? v : null;

/**
 * List every non-archived lead with its AI-intel freshness timestamps.
 *
 * @param opts.limit       max rows (default 500, cap 2000)
 * @param opts.clientId    optional filter to one client's leads
 * @param opts.onlyClients when true, drop unassigned house leads (client_id IS NULL)
 */
export async function listLeadsWithIntelFreshness(opts: {
  limit?: number;
  clientId?: number | null;
  onlyClients?: boolean;
} = {}): Promise<LeadIntelFreshness[]> {
  const limit = Math.max(1, Math.min(opts.limit ?? 500, 2000));
  const db = getAvDb();

  const filters: string[] = ['l.archived_at IS NULL'];
  const args: (number | string)[] = [];
  if (typeof opts.clientId === 'number') {
    filters.push('l.client_id = ?');
    args.push(opts.clientId);
  } else if (opts.onlyClients) {
    filters.push('l.client_id IS NOT NULL');
  }
  const whereSql = filters.join(' AND ');

  // Inline limit (mysql2 prepared LIMIT? is unreliable across versions).
  const safeLimit = Number.isInteger(limit) ? limit : 500;

  const [rows] = await db.execute<Row[]>(
    `SELECT
        l.id, l.audit_id, l.company, l.industry, l.contact_name, l.client_id,
        c.client_name, l.ai_score, l.ai_score_band,
        l.ai_last_scored_at AS audit_at,
        l.pain_extracted_at AS call_script_at,
        (SELECT MAX(om.updated_at) FROM outreach_messages om WHERE om.lead_id = l.id) AS outreach_at
       FROM leads l
       LEFT JOIN clients c ON c.client_id = l.client_id
      WHERE ${whereSql}
      ORDER BY
        /* Stalest first: NULL audit_at sorts last in MySQL ASC by default,
           but we want never-generated leads UP TOP because they are the
           most stale. Flip with a CASE. */
        CASE WHEN l.ai_last_scored_at IS NULL THEN 0 ELSE 1 END,
        l.ai_last_scored_at ASC,
        l.id DESC
      LIMIT ${safeLimit}`,
    args
  );

  return rows.map((r) => ({
    id: r.id,
    auditId: r.audit_id,
    company: r.company,
    industry: r.industry,
    contactName: r.contact_name,
    clientId: r.client_id,
    clientName: r.client_name,
    aiScore: r.ai_score,
    aiScoreBand: r.ai_score_band,
    auditAt: TS(r.audit_at),
    callScriptAt: TS(r.call_script_at),
    outreachAt: TS(r.outreach_at)
  }));
}
