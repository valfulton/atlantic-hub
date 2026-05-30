/**
 * lib/campaigns/lines_for_lead.ts  (#46 spine Inc 1)
 *
 * The narrative spine seen from the LEAD side. Given a lead, surface the active
 * narrative lines for the lead's owner (the client account, or the brand's own
 * house lines when client_id is null), tagged with:
 *   - link status (whether the lead is already linked, and with what role)
 *   - lightweight keyword overlap ("matched on: founder, retreats") to defend
 *     the suggestion the way line_fit defends order on the cockpit side.
 *
 * Used by the operator + (later) client lead detail page to make the spine
 * actionable at the point of decision. One-click link/unlink writes through
 * the canonical narrative_line_links join (schema 050).
 *
 * Pure data + small heuristic; never throws — empty array on lookup failure.
 */
import { getAvDb } from '@/lib/db/av';
import { listActiveLines, type NarrativeLane } from '@/lib/campaigns/store';
import type { LinkRole } from '@/lib/campaigns/line_links';
import type { RowDataPacket } from 'mysql2';

export interface LineForLead {
  lineId: number;
  name: string;
  state: NarrativeLane['state'];
  thesis: string | null;
  audience: string | null;
  /** Role this lead currently plays on the line, or null if not linked yet. */
  role: LinkRole | null;
  /** Up-to-5 keywords the lead's intelligence shares with the line — the "why". */
  shared: string[];
}

interface LeadRow extends RowDataPacket {
  id: number;
  company: string | null;
  industry: string | null;
  client_id: number | null;
  pain_point_profile: unknown;
}

interface LinkRow extends RowDataPacket {
  narrative_line_id: number;
  role: LinkRole;
}

// Same stopword/tokenize shape as line_fit so the "matched on" reasoning is
// consistent between cockpit and lead surfaces. Duplicated tiny — not exported
// from line_fit because that file's set is overgrown with cockpit-specific
// noise (brand, story, conversion …) we'd want to keep tunable separately later.
const STOP = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'their', 'your', 'from', 'into',
  'are', 'our', 'who', 'what', 'when', 'where', 'will', 'have', 'has', 'they',
  'them', 'about', 'more', 'less',
  'business', 'businesses', 'company', 'companies', 'team', 'teams',
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
    let w = m[0];
    if (w.length > 4 && w.endsWith('s')) w = w.slice(0, -1);
    if (!STOP.has(w)) out.add(w);
  }
  return out;
}

function painText(raw: unknown): string {
  if (raw == null) return '';
  let v: unknown = raw;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return v as string; } }
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return [o.pain_category, o.summary, o.headline, o.primary_pain]
      .filter((x) => typeof x === 'string')
      .join(' ');
  }
  return '';
}

/**
 * For a single lead, return the lines its owner is steering on, each tagged
 * with link status + shared keywords. Empty array when the lead doesn't exist
 * or has no active lines for its owner — UI hides the panel in that case so
 * we don't add visual weight when there's nothing to do.
 */
export async function linesForLead(leadId: number): Promise<LineForLead[]> {
  if (!Number.isInteger(leadId) || leadId <= 0) return [];
  const db = getAvDb();

  // Resolve the lead's owner + the small bit of intel we'll use to compute
  // shared keywords. One SELECT; we don't need anything else from the lead.
  let lead: LeadRow | undefined;
  try {
    const [rows] = await db.execute<LeadRow[]>(
      `SELECT id, company, industry, client_id, pain_point_profile
         FROM leads WHERE id = ? AND archived_at IS NULL LIMIT 1`,
      [leadId]
    );
    lead = rows[0];
  } catch (err) {
    console.error('[lines_for_lead:lead]', (err as Error).message);
    return [];
  }
  if (!lead) return [];

  // The lines we'd ever offer for this lead: active + reinforcing, scoped to
  // the lead's owner. House lines (client_id NULL) for prospects, the client's
  // own lines for client-assigned leads.
  let lines: NarrativeLane[] = [];
  try {
    lines = await listActiveLines('av', lead.client_id ?? null);
  } catch (err) {
    console.error('[lines_for_lead:lanes]', (err as Error).message);
    return [];
  }
  if (lines.length === 0) return [];

  // Existing link rows for this lead (asset_type='lead'), keyed by line id ->
  // role. One query; lines without a link row come back unlinked.
  const linkedRole = new Map<number, LinkRole>();
  try {
    const [rows] = await db.execute<LinkRow[]>(
      `SELECT narrative_line_id, role FROM narrative_line_links
        WHERE asset_type = 'lead' AND asset_id = ?`,
      [leadId]
    );
    for (const r of rows) linkedRole.set(r.narrative_line_id, r.role);
  } catch (err) {
    console.error('[lines_for_lead:links]', (err as Error).message);
    // Continue — surface lines as unlinked. Missing data > empty panel.
  }

  // Cheap shared-keyword overlap so the panel can SAY why a line was offered.
  // Lead-side tokens come from company / industry / pain — same as line_fit.
  const leadTokens = tokenize(lead.company, lead.industry, painText(lead.pain_point_profile));

  return lines.map((line) => {
    const lineTokens = tokenize(
      line.name, line.thesis, line.audience, line.authorityAngle,
      line.emotionalDriver, line.proofPoints.join(' ')
    );
    const shared: string[] = [];
    for (const t of leadTokens) {
      if (lineTokens.has(t)) shared.push(t);
      if (shared.length >= 5) break;
    }
    return {
      lineId: line.id,
      name: line.name,
      state: line.state,
      thesis: line.thesis,
      audience: line.audience,
      role: linkedRole.get(line.id) ?? null,
      shared
    };
  });
}
