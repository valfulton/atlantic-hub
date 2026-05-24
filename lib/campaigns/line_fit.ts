/**
 * lib/campaigns/line_fit.ts
 *
 * Line ↔ lead FIT: how many of a customer's leads a narrative line actually
 * speaks to. This is what lets the operator DEFEND the order of pushes — push
 * the line that maps to the most (and hottest) leads first.
 *
 * PURE DATA, no LLM/API cost. v1 uses a transparent keyword-overlap heuristic
 * between the line's intelligence (name/thesis/audience/authority/driver/proof)
 * and each lead's (company/industry/pain). It's intentionally simple and
 * explainable ("matched on: retreats, leadership"); it can be upgraded to
 * embeddings/semantic matching later without changing the call site.
 */
import { getAvDb } from '@/lib/db/av';
import { getLane } from '@/lib/campaigns/store';
import type { RowDataPacket } from 'mysql2';

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'their', 'your', 'from', 'into', 'are', 'our',
  'who', 'what', 'when', 'where', 'will', 'have', 'has', 'they', 'them', 'about', 'more', 'less',
  'business', 'businesses', 'company', 'companies', 'team', 'teams', 'becoming', 'become', 'strategic',
  // generic words from the originally-seeded editorial lanes — matching on these
  // is noise ("matched on: brand"), so they don't count toward fit.
  'brand', 'story', 'stories', 'authority', 'expertise', 'education', 'educational',
  'seasonal', 'timely', 'community', 'partnership', 'partnerships', 'offer', 'offers',
  'conversion', 'wins', 'proof', 'client', 'clients', 'pain', 'point', 'points',
  'behind', 'scenes', 'content', 'marketing', 'social', 'media', 'general', 'other',
  'service', 'services', 'product', 'products', 'customer', 'customers'
]);

function tokenize(...parts: (string | null | undefined)[]): Set<string> {
  const text = parts.filter(Boolean).join(' ').toLowerCase();
  const out = new Set<string>();
  for (const m of text.matchAll(/[a-z]{4,}/g)) {
    const w = m[0];
    if (!STOPWORDS.has(w)) out.add(w);
  }
  return out;
}

function painText(raw: unknown): string {
  if (raw == null) return '';
  let v: unknown = raw;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return v as string; } }
  if (v && typeof v === 'object') {
    // pull the human-readable bits, not the whole JSON
    const o = v as Record<string, unknown>;
    return [o.pain_category, o.summary, o.headline, o.primary_pain].filter((x) => typeof x === 'string').join(' ');
  }
  return '';
}

/** The discrete pain_category label for a lead, if present. */
function painCategory(raw: unknown): string | null {
  let v: unknown = raw;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return null; } }
  if (v && typeof v === 'object') {
    const c = (v as Record<string, unknown>).pain_category;
    if (typeof c === 'string' && c.trim() && c.trim().toLowerCase() !== 'other') return c.trim();
  }
  return null;
}

/** Top-N (label, count) from a frequency map. */
function topCounts(map: Map<string, number>, n: number): Array<{ label: string; count: number }> {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([label, count]) => ({ label, count }));
}

export interface LineFitLead {
  leadId: number;
  company: string;
  band: string | null;
  score: number | null;
  sharedTerms: string[];
}

/** What the owner's leads are actually saying — to shape the line toward them. */
export interface LineNeeds {
  painThemes: Array<{ label: string; count: number }>;   // discrete pain categories
  industries: Array<{ label: string; count: number }>;
  keywords: Array<{ label: string; count: number }>;     // recurring words worth using
}

export interface LineFit {
  lineId: number;
  totalLeads: number;       // addressable: the owner's pipeline
  matchedCount: number;     // leads that share at least one theme word
  bands: { hot: number; warm: number; cool: number };  // among matched
  top: LineFitLead[];       // best matches, for the "why"
  needs: LineNeeds;         // what the leads need (to edit the line toward them)
}

interface LeadRow extends RowDataPacket {
  id: number; company: string | null; industry: string | null;
  ai_score_band: string | null; ai_combined_score: number | null; ai_score: number | null;
  pain_point_profile: unknown;
}

const EMPTY = (lineId: number): LineFit => ({
  lineId, totalLeads: 0, matchedCount: 0, bands: { hot: 0, warm: 0, cool: 0 }, top: [],
  needs: { painThemes: [], industries: [], keywords: [] }
});

export async function getLineLeadFit(lineId: number): Promise<LineFit> {
  const line = await getLane(lineId);
  if (!line) return EMPTY(lineId);

  // The addressable pipeline for this line's owner: a client account's leads, or
  // (house line) the operator's own pipeline (client_id IS NULL).
  const db = getAvDb();
  const ownerClause = line.clientId && line.clientId > 0 ? 'client_id = ?' : 'client_id IS NULL';
  const params = line.clientId && line.clientId > 0 ? [line.clientId] : [];
  const [rows] = await db.execute<LeadRow[]>(
    `SELECT id, company, industry, ai_score_band, ai_combined_score, ai_score, pain_point_profile
       FROM leads
      WHERE archived_at IS NULL AND ${ownerClause}
      ORDER BY ai_combined_score IS NULL ASC, ai_combined_score DESC, id DESC
      LIMIT 300`,
    params
  );

  const lineTokens = tokenize(
    line.name, line.thesis, line.audience, line.authorityAngle, line.emotionalDriver,
    line.proofPoints.join(' '), line.dontSay.length ? '' : '' // dontSay intentionally excluded
  );

  const matched: LineFitLead[] = [];
  const bands = { hot: 0, warm: 0, cool: 0 };
  // "What your leads need" tallies — computed across the WHOLE pipeline, not just
  // matches, so they reveal where the line SHOULD point.
  const painMap = new Map<string, number>();
  const indMap = new Map<string, number>();
  const kwMap = new Map<string, number>();
  for (const r of rows) {
    // needs tallies (all leads)
    const pc = painCategory(r.pain_point_profile);
    if (pc) painMap.set(pc, (painMap.get(pc) ?? 0) + 1);
    if (r.industry && r.industry.trim()) {
      const ind = r.industry.replace(/_/g, ' ').trim();
      indMap.set(ind, (indMap.get(ind) ?? 0) + 1);
    }
    const leadTokens = tokenize(r.company, r.industry, painText(r.pain_point_profile));
    for (const t of leadTokens) kwMap.set(t, (kwMap.get(t) ?? 0) + 1);

    // fit matching
    const shared: string[] = [];
    for (const t of leadTokens) if (lineTokens.has(t)) shared.push(t);
    if (shared.length === 0) continue;
    const band = r.ai_score_band;
    if (band === 'hot') bands.hot += 1;
    else if (band === 'warm') bands.warm += 1;
    else bands.cool += 1;
    matched.push({
      leadId: r.id,
      company: r.company || `Lead #${r.id}`,
      band,
      score: r.ai_combined_score != null ? Number(r.ai_combined_score) : r.ai_score != null ? Number(r.ai_score) : null,
      sharedTerms: shared.slice(0, 5)
    });
  }

  matched.sort((a, b) => b.sharedTerms.length - a.sharedTerms.length || (b.score ?? 0) - (a.score ?? 0));
  // Only surface keywords that recur (count >= 2) — single mentions are noise.
  const keywords = topCounts(kwMap, 12).filter((k) => k.count >= 2).slice(0, 8);

  return {
    lineId,
    totalLeads: rows.length,
    matchedCount: matched.length,
    bands,
    top: matched.slice(0, 6),
    needs: {
      painThemes: topCounts(painMap, 5),
      industries: topCounts(indMap, 5),
      keywords
    }
  };
}
