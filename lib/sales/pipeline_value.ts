/**
 * lib/sales/pipeline_value.ts
 *
 * Pipeline $ rollup math for the excitement layer at the top of /admin/av.
 * The number every sales team wants to see go up.
 *
 * Approach: each unarchived non-lost lead carries an expected revenue
 * value based on (a) tier-floor price and (b) probability of converting,
 * which we infer from ai_combined_score / 100.
 *
 *   per_lead_value = Sprint floor price ($1,995) * (ai_combined_score / 100)
 *
 * Sprint is the right floor because that is the entry-tier monthly fee
 * (per docs/PRODUCT_VISION.md). We could weight by industry or pain
 * profile later; for now one weight keeps the number explainable to a
 * sales team without a finance degree.
 *
 * Excluded:
 *   - archived (soft-deleted)
 *   - lost
 *   - converted (those count toward closed revenue, separate number)
 *
 * Outputs:
 *   liveValueCents      -- sum of per-lead values across live pipeline
 *   liveLeadCount       -- how many leads contribute
 *   hotValueCents       -- subset where ai_score_band = 'hot'
 *   nurtureValueCents   -- subset in nurture/not_now (potential, not active)
 *   topLead             -- the single highest-value lead, for the card
 *                         to surface ("Best opportunity: X at $Y")
 */

import { getAvDb } from '@/lib/db/av';
import type { RowDataPacket } from 'mysql2';

const SPRINT_MONTHLY_USD = 1995;

export interface PipelineValue {
  liveValueCents: number;
  liveLeadCount: number;
  hotValueCents: number;
  hotLeadCount: number;
  warmValueCents: number;
  warmLeadCount: number;
  nurtureValueCents: number;
  nurtureLeadCount: number;
  topLead: {
    auditId: string;
    company: string;
    estimatedValueCents: number;
    score: number;
  } | null;
  computedAt: string;
}

interface LeadRow extends RowDataPacket {
  id: number;
  audit_id: string;
  company: string;
  lead_status: string;
  ai_score_band: 'hot' | 'warm' | 'cool' | null;
  ai_combined_score: number | null;
  ai_score: number | null;
}

const LIVE_STATUSES = new Set(['new', 'contacted', 'qualified']);
const NURTURE_STATUSES = new Set(['nurture', 'not_now']);

function perLeadCents(score: number | null): number {
  if (score === null || score <= 0) return 0;
  const clamped = Math.min(100, Math.max(0, score));
  return Math.round(SPRINT_MONTHLY_USD * 100 * (clamped / 100));
}

export async function computePipelineValue(): Promise<PipelineValue> {
  const db = getAvDb();
  const [rows] = await db.execute<LeadRow[]>(
    `SELECT id, audit_id, company, lead_status, ai_score_band, ai_combined_score, ai_score
       FROM leads
      WHERE archived_at IS NULL
        AND lead_status NOT IN ('lost', 'converted')`
  );

  let liveValueCents = 0;
  let liveLeadCount = 0;
  let hotValueCents = 0;
  let hotLeadCount = 0;
  let warmValueCents = 0;
  let warmLeadCount = 0;
  let nurtureValueCents = 0;
  let nurtureLeadCount = 0;
  let topLead: PipelineValue['topLead'] = null;

  for (const r of rows) {
    const score = r.ai_combined_score ?? r.ai_score;
    const cents = perLeadCents(score);
    const status = r.lead_status;

    if (LIVE_STATUSES.has(status)) {
      liveValueCents += cents;
      liveLeadCount += 1;
      if (r.ai_score_band === 'hot') {
        hotValueCents += cents;
        hotLeadCount += 1;
      } else if (r.ai_score_band === 'warm') {
        warmValueCents += cents;
        warmLeadCount += 1;
      }
      if (cents > 0 && (!topLead || cents > topLead.estimatedValueCents)) {
        topLead = {
          auditId: r.audit_id,
          company: r.company,
          estimatedValueCents: cents,
          score: score ?? 0
        };
      }
    } else if (NURTURE_STATUSES.has(status)) {
      nurtureValueCents += cents;
      nurtureLeadCount += 1;
    }
  }

  return {
    liveValueCents,
    liveLeadCount,
    hotValueCents,
    hotLeadCount,
    warmValueCents,
    warmLeadCount,
    nurtureValueCents,
    nurtureLeadCount,
    topLead,
    computedAt: new Date().toISOString()
  };
}

export function formatUsd(cents: number): string {
  const dollars = Math.round(cents / 100);
  return dollars.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}
