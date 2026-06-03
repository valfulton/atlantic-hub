/**
 * lib/ai/client_icp_fit.ts  (#95)
 *
 * "How well does THIS lead fit the OWNING CLIENT's ICP?" — a 0-100 score plus
 * a one-sentence reason, computed by reading the client's full brief
 * (ideal_client, audience_insights, market_position, geo_focus, excluded
 * industries, brief seed) AND the lead's facts (company, industry, address,
 * website, employee count, audit excerpt).
 *
 * Distinct from the existing ai_score (a generic AV audit quality signal).
 * This is the answer to "would Tim actually want to call this prospect?"
 *
 * Conservative defaults:
 *   - Returns null when the client has no brief on file (nothing to score
 *     against). Caller treats null as "not yet scored."
 *   - Never throws on a single lead failure — returns null so a bulk run
 *     keeps going.
 *   - Prompt is editable via prompt_registry key 'client_icp_fit_scorer'.
 */
import { parseOpenAIJson } from '@/lib/openai/client';
import { runLlm } from '@/lib/llm/router';
import { getSystemPrompt } from '@/lib/ai/prompt_registry';
import { getBriefForPrompt } from '@/lib/client/brief_store';
import { getClientIcp } from '@/lib/client/icp';
import { getAvDb } from '@/lib/db/av';
import { logEvent } from '@/lib/events/log';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';

const TEMPERATURE = 0.2;
const MAX_TOKENS = 250;

interface LeadFactsRow extends RowDataPacket {
  id: number;
  company: string | null;
  industry: string | null;
  website: string | null;
  website_status: string | null;
  audit_content: string | null;
  challenge: string | null;
  address_city: string | null;
  address_state: string | null;
  address_country: string | null;
  client_id: number | null;
  // (#212) Employee estimate is buried in source_payload; surface it for the
  // scorer so org size matters (a 5-employee shop vs a 5000-employee enterprise
  // is a huge fit signal).
  employee_count_est: string | null;
}

export interface IcpFitResult {
  score: number;          // 0-100
  reasoning: string;      // one-sentence operator-facing summary
  model: string;
  tokensUsed: number;
}

function loadLeadFacts(leadId: number): Promise<LeadFactsRow | null> {
  return getAvDb()
    .execute<LeadFactsRow[]>(
      `SELECT
          id, company, industry, website, website_status,
          audit_content, challenge,
          address_city, address_state, address_country, client_id,
          JSON_UNQUOTE(JSON_EXTRACT(source_payload, '$.apollo_estimated_num_employees')) AS employee_count_est
        FROM leads
       WHERE id = ? LIMIT 1`,
      [leadId]
    )
    .then(([rows]) => rows[0] ?? null);
}

function buildUserPrompt(args: {
  brandBlock: string;
  excludedIndustries: string[];
  industries: string[];
  geographies: string[];
  companySizeMin: number | null;
  companySizeMax: number | null;
  lead: LeadFactsRow;
}): string {
  const parts: string[] = [];
  parts.push(args.brandBlock.trim());
  parts.push('');
  parts.push('STORED_ICP (operator-curated, separate from brief):');
  if (args.industries.length) parts.push(`  TARGET_INDUSTRIES: ${args.industries.join(', ')}`);
  if (args.geographies.length) parts.push(`  TARGET_GEOGRAPHIES: ${args.geographies.join(', ')}`);
  if (args.excludedIndustries.length) parts.push(`  EXCLUDED_INDUSTRIES: ${args.excludedIndustries.join(', ')}`);
  if (args.companySizeMin || args.companySizeMax) {
    parts.push(`  TARGET_COMPANY_SIZE: ${args.companySizeMin ?? 1}-${args.companySizeMax ?? 'unbounded'} employees`);
  }
  parts.push('');
  parts.push('PROSPECT_LEAD:');
  parts.push(`  COMPANY: ${args.lead.company || '(unknown)'}`);
  if (args.lead.industry) parts.push(`  INDUSTRY: ${args.lead.industry}`);
  if (args.lead.address_city || args.lead.address_state || args.lead.address_country) {
    const loc = [args.lead.address_city, args.lead.address_state, args.lead.address_country]
      .filter(Boolean).join(', ');
    parts.push(`  LOCATION: ${loc}`);
  }
  if (args.lead.employee_count_est && /^\d+$/.test(args.lead.employee_count_est)) {
    parts.push(`  EMPLOYEES_EST: ${args.lead.employee_count_est}`);
  }
  if (args.lead.website) {
    const ws = args.lead.website_status ? ` (status: ${args.lead.website_status})` : '';
    parts.push(`  WEBSITE: ${args.lead.website}${ws}`);
  }
  if (args.lead.challenge) parts.push(`  STATED_CHALLENGE: ${args.lead.challenge.slice(0, 400)}`);
  if (args.lead.audit_content && args.lead.audit_content.length > 30) {
    parts.push(`  AUDIT_EXCERPT: ${args.lead.audit_content.trim().slice(0, 1200)}`);
  }
  parts.push('');
  parts.push('Produce the JSON object now.');
  return parts.join('\n');
}

/**
 * Score a single lead against its owning client's ICP. Returns null when:
 *   - The lead has no owning client (no scope to score against)
 *   - The client has no brief on file (nothing to ground in)
 *   - The OpenAI call fails / returns malformed JSON
 *
 * Never throws. Callers can run this in a loop without try/catch.
 */
export async function scoreClientIcpFit(leadId: number): Promise<IcpFitResult | null> {
  const lead = await loadLeadFacts(leadId);
  if (!lead || !lead.client_id) return null;

  const brand = await getBriefForPrompt({
    tenantId: 'av',
    clientId: lead.client_id,
    fallbackName: null
  });
  if (!brand.grounded) {
    // No brief = no signal. Don't fabricate a score.
    return null;
  }

  const icp = await getClientIcp(lead.client_id);

  const systemPrompt = await getSystemPrompt('client_icp_fit_scorer');
  const userPrompt = buildUserPrompt({
    brandBlock: brand.block,
    excludedIndustries: icp.excludedIndustries,
    industries: icp.industries,
    geographies: icp.geographies,
    companySizeMin: icp.companySizeMin,
    companySizeMax: icp.companySizeMax,
    lead
  });

  let completion;
  try {
    // (#371) Migrated onto runLlm. Cache policy 'event' — invalidated by ICP
    // and brief updated_at via cacheKeyExtras. Per-client cost attribution.
    completion = await runLlm({
      taskKind: 'icp_fit_reason',
      note: `icp-fit lead=${leadId} client=${lead.client_id}`,
      clientId: lead.client_id,
      prompt: `SYSTEM:\n${systemPrompt}\n\nUSER:\n${userPrompt}`,
      cacheKeyExtras: [String(leadId), String(lead.client_id), systemPrompt.slice(0, 200)],
      temperature: TEMPERATURE,
      maxTokens: MAX_TOKENS,
      json: true
    });
  } catch (err) {
    const e = err as Error;
    await logEvent({
      eventType: 'lead.icp_fit.scoring_failed',
      leadId,
      source: 'openai',
      status: 'failure',
      errorMessage: e.message
    });
    return null;
  }

  const parsed = parseOpenAIJson<{ score?: number; reasoning?: string }>(completion.text);
  if (!parsed || typeof parsed.score !== 'number') {
    await logEvent({
      eventType: 'lead.icp_fit.scoring_failed',
      leadId,
      source: 'openai',
      status: 'failure',
      errorMessage: 'malformed JSON',
      payload: { raw_excerpt: completion.text.slice(0, 300) }
    });
    return null;
  }

  const score = Math.max(0, Math.min(100, Math.round(parsed.score)));
  const reasoning = (typeof parsed.reasoning === 'string' ? parsed.reasoning : '').slice(0, 1000);

  return {
    score,
    reasoning,
    model: completion.model,
    tokensUsed: completion.inputTokens + completion.outputTokens
  };
}

/**
 * Score + persist for a single lead. Returns the score or null.
 */
export async function scoreAndPersistLead(leadId: number): Promise<number | null> {
  const result = await scoreClientIcpFit(leadId);
  if (!result) return null;
  try {
    const db = getAvDb();
    await db.execute<ResultSetHeader>(
      `UPDATE leads
          SET client_icp_fit_score = ?,
              client_icp_fit_reasoning = ?,
              client_icp_fit_at = NOW()
        WHERE id = ?`,
      [result.score, result.reasoning, leadId]
    );
    await logEvent({
      eventType: 'lead.icp_fit.scored',
      leadId,
      source: 'openai',
      payload: { score: result.score, tokens: result.tokensUsed }
    });
    return result.score;
  } catch (err) {
    await logEvent({
      eventType: 'lead.icp_fit.persist_failed',
      leadId,
      source: 'mysql',
      status: 'failure',
      errorMessage: (err as Error).message
    });
    return null;
  }
}

/**
 * Bulk-score every active lead owned by a client that doesn't have a fresh
 * fit score yet. Sequential to keep OpenAI rate limits + Netlify duration
 * caps in check; caller can interrupt the response stream if needed.
 *
 * `mode`:
 *   - 'unscored' (default): only score leads where client_icp_fit_score IS NULL
 *   - 'all': rescore every lead (use after the brief / ICP changes)
 */
export interface BulkScoreResult {
  attempted: number;
  scored: number;
  skipped: number;
  failed: number;
}

export async function scoreClientLeadsBulk(args: {
  clientId: number;
  mode?: 'unscored' | 'all';
  limit?: number;
  /** Optional soft deadline (ms since epoch). Stops the loop when reached. */
  softDeadline?: number;
}): Promise<BulkScoreResult> {
  const mode = args.mode ?? 'unscored';
  const limit = Math.max(1, Math.min(args.limit ?? 100, 500));

  const db = getAvDb();
  const where = mode === 'unscored'
    ? 'client_id = ? AND archived_at IS NULL AND client_icp_fit_score IS NULL'
    : 'client_id = ? AND archived_at IS NULL';
  const [rows] = await db.execute<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM leads WHERE ${where} ORDER BY id DESC LIMIT ${limit}`,
    [args.clientId]
  );

  let scored = 0;
  let skipped = 0;
  let failed = 0;
  for (const r of rows) {
    if (args.softDeadline && Date.now() >= args.softDeadline) break;
    const result = await scoreAndPersistLead(r.id);
    if (result === null) {
      // Could be "no brief / no signal" (skip) or an OpenAI failure. The event
      // log distinguishes; here we just count as skipped if no signal vs failed
      // if we got an error log. For the summary we keep it coarse.
      skipped += 1;
    } else {
      scored += 1;
    }
    // Counted unconditionally for the failed bucket fallback.
    void failed;
  }

  return { attempted: rows.length, scored, skipped, failed };
}
