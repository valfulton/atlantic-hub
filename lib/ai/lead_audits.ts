/**
 * lib/ai/lead_audits.ts
 *
 * Per-lens lead audits (no-drift). A lead can hold one audit + call-script per
 * SELLER lens, so generating for one seller never overwrites another's. See
 * schema/056_lead_audits.sql.
 *
 *   lens = 'av' | 'ebw' | 'hh' | 'client:<id>'
 *
 * The leads.audit_content / pain_point_profile columns remain the "current" view
 * (back-compat); this is the durable per-lens record.
 */
import { getAvDb } from '@/lib/db/av';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

/** The seller lens for a lead: a client's own lens if owned, else Atlantic & Vine. */
export function lensForClient(clientId: number | null | undefined): string {
  return clientId && clientId > 0 ? `client:${clientId}` : 'av';
}

export interface LeadAuditRow {
  lens: string;
  auditContent: string | null;
  painPointProfile: unknown;
  aiScore: number | null;
  aiScoreBand: string | null;
  generatedAt: string | null;
}

interface DbRow extends RowDataPacket {
  lens: string;
  audit_content: string | null;
  pain_point_profile: string | object | null;
  ai_score: number | null;
  ai_score_band: string | null;
  generated_at: Date | null;
}

function toRow(r: DbRow): LeadAuditRow {
  return {
    lens: r.lens,
    auditContent: r.audit_content,
    painPointProfile: typeof r.pain_point_profile === 'string'
      ? safeJson(r.pain_point_profile)
      : (r.pain_point_profile ?? null),
    aiScore: r.ai_score == null ? null : Number(r.ai_score),
    aiScoreBand: r.ai_score_band,
    generatedAt: r.generated_at ? new Date(r.generated_at).toISOString() : null
  };
}

function safeJson(s: string): unknown {
  try { return JSON.parse(s); } catch { return null; }
}

/** Upsert the audit for one lead under one lens. Never touches other lenses. */
export async function saveLeadAudit(params: {
  leadId: number;
  lens: string;
  auditContent?: string | null;
  painPointProfile?: unknown;
  aiScore?: number | null;
  aiScoreBand?: string | null;
}): Promise<void> {
  const db = getAvDb();
  const painJson = params.painPointProfile == null ? null : JSON.stringify(params.painPointProfile);
  await db.execute<ResultSetHeader>(
    `INSERT INTO lead_audits (lead_id, lens, audit_content, pain_point_profile, ai_score, ai_score_band)
       VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       audit_content      = COALESCE(VALUES(audit_content), audit_content),
       pain_point_profile = COALESCE(VALUES(pain_point_profile), pain_point_profile),
       ai_score           = COALESCE(VALUES(ai_score), ai_score),
       ai_score_band      = COALESCE(VALUES(ai_score_band), ai_score_band),
       generated_at       = CURRENT_TIMESTAMP`,
    [
      params.leadId,
      params.lens,
      params.auditContent ?? null,
      painJson,
      params.aiScore ?? null,
      params.aiScoreBand ?? null
    ]
  );
}

/** One lens's audit for a lead, or null. */
export async function getLeadAudit(leadId: number, lens: string): Promise<LeadAuditRow | null> {
  if (!leadId || leadId <= 0) return null;
  const db = getAvDb();
  const [rows] = await db.execute<DbRow[]>(
    `SELECT lens, audit_content, pain_point_profile, ai_score, ai_score_band, generated_at
       FROM lead_audits WHERE lead_id = ? AND lens = ? LIMIT 1`,
    [leadId, lens]
  );
  return rows[0] ? toRow(rows[0]) : null;
}

/** All lenses a lead has an audit for (for the lens picker). */
export async function listLeadAudits(leadId: number): Promise<LeadAuditRow[]> {
  if (!leadId || leadId <= 0) return [];
  const db = getAvDb();
  const [rows] = await db.execute<DbRow[]>(
    `SELECT lens, audit_content, pain_point_profile, ai_score, ai_score_band, generated_at
       FROM lead_audits WHERE lead_id = ? ORDER BY generated_at DESC`,
    [leadId]
  );
  return rows.map(toRow);
}
