/**
 * lib/client/intel_inventory.ts
 *
 * Operator-facing "what intelligence do we have on this client, where did it
 * come from, and who reads it?" inventory. Read-only. Built so val can answer
 * the simple question: "are we using everything we collected?"
 *
 * Pulls three layers:
 *   1. intelligence_objects  — the typed/tagged objects (founder_story etc)
 *   2. creative_briefs.brief_payload — canonical brief fields
 *   3. client_users.intake_payload  — the raw 50-field intake the client submitted
 *
 * And carries a static consumer-map so each piece can be labelled with what
 * actually reads it elsewhere in the codebase. The map is hardcoded
 * intentionally — it's a documentation surface, not a runtime trace. When
 * consumers move, update this file.
 */
import { getAvDb } from '@/lib/db/av';
import { getBriefPayload } from '@/lib/client/brief_store';
import type { RowDataPacket } from 'mysql2';

// ──────────────────────────────────────────────────────────────────────────
// Consumer map — intelligence_objects (by object_type)
// Encoded from grep across lib/* + app/* in May 2026. Update when the
// consuming code moves.
// ──────────────────────────────────────────────────────────────────────────
export const INTEL_OBJECT_CONSUMERS: Record<string, string[]> = {
  founder_story:               ['Intake mapping (intake_brief)', 'Client guidance'],
  authority_positioning:       ['Client guidance'],
  pain_point_profile:          ['Lives on leads table — feeds call scripts + lead audit'],
  audience_psychology:         [],
  seasonal_opportunities:      ['Client guidance'],
  competitive_weaknesses:      [],
  market_positioning:          [],
  differentiators:             ['Intake mapping (intake_brief)', 'New client form'],
  preferred_narrative_angles:  ['Client guidance'],
  proof_points:                ['Intake mapping (intake_brief)', 'Add-brand flow'],
  engagement_patterns:         ['PR sources sweep'],
  authority_topics:            ['PR engine (artifacts)', 'Client guidance'],
  media_friendly_topics:       ['PR discovery', 'Client guidance'],

  // Produced by lib/client/guidance.ts, consumed by the client dashboard's
  // "Here's where to focus" + momentum cards. Not in the canonical 13-type
  // registry; included here because they're real and persisted per-client.
  next_best_moves:             ['Client dashboard — "Here\'s where to focus" cards'],
  momentum_signals:            ['Client dashboard — momentum card']
};

// ──────────────────────────────────────────────────────────────────────────
// Consumer map — raw intake fields (by field name in intake_payload)
// Built from extractBriefSeedFromIntake() in lib/client/intake_brief.ts.
// Anything NOT in this map is "captured but unused" — the panel highlights it.
// ──────────────────────────────────────────────────────────────────────────
export const INTAKE_FIELD_CONSUMERS: Record<string, string[]> = {
  // direct → canonical brief fields
  key_message:        ['Brief — key message + narrative line thesis'],
  target_audience:    ['Brief — audience + narrative line audience'],
  audience_insights:  ['Brief — audience insights'],
  why_advertise:      ['Brief — why advertise'],
  goals:              ['Brief — goals'],
  message_support:    ['Brief — proof points'],
  differentiators:    ['Brief — differentiators', 'Intelligence object'],
  competitors:        ['Brief — competitors'],
  brand_voice:        ['Brief — brand voice + narrative emotional driver'],
  preferred_channels: ['Brief — channels + narrative best channels'],
  brand_colors:       ['Brief — brand colors'],
  busy_seasons:       ['Brief — seasonality + narrative seasonality'],

  // fallbacks (used when the canonical field is empty)
  market_position:    ['Brief fallback for key_message + differentiators', 'Intelligence object'],
  ideal_client:       ['Brief fallback for target_audience'],
  proof_points:       ['Brief fallback for message_support', 'Intelligence object'],
  press_awards:       ['Brief fallback for message_support'],
  client_results:     ['Brief fallback for message_support + audience_insights'],
  client_problems:    ['Brief fallback for audience_insights'],
  founder_story:      ['Brief fallback for why_advertise', 'Intelligence object'],
  website_goals:      ['Brief fallback for goals'],
  content_platforms:  ['Brief fallback for preferred_channels'],
  key_dates:          ['Brief fallback for seasonality'],
  timeline:           ['Brief fallback for seasonality (last-resort)'],

  // PR block — all preserved on brief, consumed by PR engine
  pr_goals:           ['Brief — PR engine'],
  pr_expert_topics:   ['Brief — PR engine'],
  pr_news_hooks:      ['Brief — PR engine'],
  pr_dream_outlets:   ['Brief — PR engine'],
  pr_spokesperson:    ['Brief — PR engine'],

  // misc preserved
  notable_clients:    ['Brief — notable clients'],

  // company-identity fields that land directly on leads/clients, not via brief
  company:            ['Lead row — company name'],
  contact_name:       ['Lead row — contact name'],
  email:              ['Lead row — email'],
  industry:           ['Lead row — industry']
};

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────
export interface IntelligenceObjectRow {
  id: number;
  object_type: string;
  object_json: unknown;
  source: string | null;
  confidence: number | null;
  updated_at: string;
}

export interface IntakeFieldRow {
  key: string;
  value: unknown;
  consumers: string[];   // populated from INTAKE_FIELD_CONSUMERS
  unused: boolean;       // true when consumers is empty
}

export interface IntelInventory {
  clientId: number;
  intelligenceObjects: IntelligenceObjectRow[];
  briefFields: IntakeFieldRow[];
  rawIntakeFields: IntakeFieldRow[];
  intakeHas: boolean;
  briefHas: boolean;
  hasAnyExtractedIntel: boolean;
  /** Object types that exist in the canonical registry but have NO row yet. */
  missingIntelTypes: string[];
  /**
   * (#182) Tenant-level intel the PR engine wrote (lead_id IS NULL,
   * tenant_id = 'av', source = 'pr_discovery') filtered to industries
   * relevant to THIS client. The PR engine's media_friendly_topics output
   * lives here. Previously invisible on per-client surfaces because the
   * inventory only queried tenant_id IN ('client:<id>') and guidance.ts
   * deliberately skipped tenant-level intel to avoid leftover-test-artifact
   * bleed. This surface restores observability without removing that guard.
   */
  prDiscoveryObjects: IntelligenceObjectRow[];
  /** Industries this client claims — used to filter prDiscoveryObjects. */
  clientIndustries: string[];
}

// ──────────────────────────────────────────────────────────────────────────
// Loader
// ──────────────────────────────────────────────────────────────────────────
export async function loadIntelInventory(clientId: number): Promise<IntelInventory> {
  const db = getAvDb();

  // Resolve the representative client_user for this client_id. The codebase has
  // TWO tenancy conventions that both prefix `client:` but use different ids:
  //   • intake_extract.ts writes under  client:<clients.client_id>
  //   • guidance.ts writes under        client:<client_users.client_user_id>
  // For Skip, client_id=4 but client_user_id=5 (they're separate sequences).
  // To show everything the system has for this client we query BOTH tenants.
  // brand_members fallback handles ADDED brands that don't have a directly-
  // linked client_user (#101 multi-brand).
  let memberUserId: number | null = null;
  {
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
  }
  const tenants: string[] = [`client:${clientId}`];
  if (memberUserId && memberUserId !== clientId) {
    tenants.push(`client:${memberUserId}`);
  }

  // 1. intelligence_objects under either tenant convention.
  const tenantPlaceholders = tenants.map(() => '?').join(',');
  const [ioRows] = await db.execute<(IntelligenceObjectRow & RowDataPacket)[]>(
    `SELECT id, object_type, object_json, source, confidence, updated_at
       FROM intelligence_objects
      WHERE tenant_id IN (${tenantPlaceholders})
      ORDER BY object_type ASC, updated_at DESC`,
    tenants
  );
  const intelligenceObjects: IntelligenceObjectRow[] = ioRows.map((r) => ({
    id: r.id,
    object_type: r.object_type,
    object_json: r.object_json,
    source: r.source ?? null,
    confidence: r.confidence ?? null,
    updated_at: typeof r.updated_at === 'string' ? r.updated_at : (r.updated_at as Date).toISOString()
  }));

  const presentTypes = new Set(intelligenceObjects.map((o) => o.object_type));
  const missingIntelTypes = Object.keys(INTEL_OBJECT_CONSUMERS).filter((t) => !presentTypes.has(t));

  // 2. brief_payload (canonical)
  let brief: Record<string, unknown> = {};
  try {
    brief = (await getBriefPayload('av', clientId)) ?? {};
  } catch {
    brief = {};
  }
  const briefHas = Object.keys(brief).length > 0;

  // 3. raw intake_payload from the first client_user under this client
  let rawIntake: Record<string, unknown> = {};
  try {
    const [rows] = await db.execute<(RowDataPacket & { intake_payload: string | object | null })[]>(
      `SELECT intake_payload
         FROM client_users
        WHERE client_id = ? AND intake_payload IS NOT NULL
        ORDER BY client_user_id ASC
        LIMIT 1`,
      [clientId]
    );
    const ip = rows[0]?.intake_payload ?? null;
    if (ip) {
      const parsed = typeof ip === 'string' ? JSON.parse(ip) : ip;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        rawIntake = parsed as Record<string, unknown>;
      }
    }
  } catch {
    rawIntake = {};
  }
  const intakeHas = Object.keys(rawIntake).length > 0;

  // Brief fields — render every key in the payload with its consumer hints.
  const briefFields: IntakeFieldRow[] = Object.entries(brief)
    .filter(([, v]) => v !== null && v !== '' && (Array.isArray(v) ? v.length > 0 : true))
    .map(([key, value]) => {
      const consumers = INTAKE_FIELD_CONSUMERS[key] ?? [];
      return { key, value, consumers, unused: consumers.length === 0 };
    });

  // Raw intake fields — every key, marked unused if not in consumer map.
  // Skip pure-meta fields the intake form ships with (viewport, honeypots).
  const SKIP = new Set(['viewport', '_hp_url']);
  const rawIntakeFields: IntakeFieldRow[] = Object.entries(rawIntake)
    .filter(([k, v]) => !SKIP.has(k) && v !== null && v !== '' && (Array.isArray(v) ? v.length > 0 : true))
    .map(([key, value]) => {
      const consumers = INTAKE_FIELD_CONSUMERS[key] ?? [];
      return { key, value, consumers, unused: consumers.length === 0 };
    })
    .sort((a, b) => {
      // unused first, so the gap is visually obvious
      if (a.unused !== b.unused) return a.unused ? -1 : 1;
      return a.key.localeCompare(b.key);
    });

  // (#182) Pull tenant-level PR-discovery intel filtered to this client's
  // industries. PR discovery writes media_friendly_topics with lead_id NULL +
  // tenant 'av' + source 'pr_discovery'. The previous query above never saw
  // those rows because it scopes to tenant_id IN ('client:<id>'). Surface
  // them here so val can confirm the PR engine is actually producing intel
  // relevant to each client — answers "is the PR engine doing anything?"
  const clientIndustries = collectClientIndustries(brief, rawIntake);
  const prDiscoveryObjects: IntelligenceObjectRow[] = await loadTenantPrDiscoveryForClient(
    db,
    clientIndustries
  );

  return {
    clientId,
    intelligenceObjects,
    briefFields,
    rawIntakeFields,
    intakeHas,
    briefHas,
    hasAnyExtractedIntel: intelligenceObjects.length > 0,
    missingIntelTypes,
    prDiscoveryObjects,
    clientIndustries
  };
}

/**
 * (#182) Collect every plausible industry label this client claims.
 *
 * Sources, in order of trust:
 *   1. brief.industry / brief.target_industries
 *   2. rawIntake.industry / rawIntake.target_audience hints
 *
 * Lowercased + de-duplicated. Empty array when this client has no industry
 * recorded — caller short-circuits the SQL when that happens.
 */
function collectClientIndustries(
  brief: Record<string, unknown>,
  rawIntake: Record<string, unknown>
): string[] {
  const candidates = new Set<string>();
  const push = (v: unknown) => {
    if (typeof v === 'string' && v.trim()) {
      // Splitting on common list separators so multi-industry fields don't
      // become one giant string that never matches.
      for (const piece of v.split(/[,;|/]+/)) {
        const t = piece.trim().toLowerCase();
        if (t.length >= 3) candidates.add(t);
      }
    } else if (Array.isArray(v)) {
      for (const x of v) push(x);
    }
  };
  push(brief.industry);
  push(brief.target_industries);
  push(rawIntake.industry);
  push(rawIntake.target_audience);
  return [...candidates];
}

/**
 * (#182) Tenant-level PR-discovery rows whose JSON 'industry' field overlaps
 * any of the client's claimed industries. Capped + ordered by recency so the
 * UI surface stays bounded.
 *
 * Source filter ('pr_discovery') AND lead_id IS NULL together exclude:
 *   - lead-scoped client intel (already in `intelligenceObjects` above)
 *   - leftover test artifacts under tenant 'av' (different source values)
 * So this restores the PR signal without re-opening the bleed the guidance
 * guard was protecting against.
 */
async function loadTenantPrDiscoveryForClient(
  db: ReturnType<typeof getAvDb>,
  clientIndustries: string[]
): Promise<IntelligenceObjectRow[]> {
  if (clientIndustries.length === 0) return [];
  const [rows] = await db.execute<(IntelligenceObjectRow & RowDataPacket)[]>(
    `SELECT id, object_type, object_json, source, confidence, updated_at
       FROM intelligence_objects
      WHERE tenant_id = 'av'
        AND lead_id IS NULL
        AND source = 'pr_discovery'
      ORDER BY updated_at DESC
      LIMIT 80`
  );
  // App-side industry filter: JSON_EXTRACT in WHERE is brittle on shared
  // hosting + the row volume here is tiny (one row per industry×pain). Doing
  // it in code keeps the query simple and the filter readable.
  const matched: IntelligenceObjectRow[] = [];
  for (const r of rows) {
    const json = typeof r.object_json === 'string' ? safeJson(r.object_json) : (r.object_json as Record<string, unknown> | null);
    const rowIndustry = typeof json?.industry === 'string' ? json.industry.trim().toLowerCase() : '';
    if (!rowIndustry) continue;
    const hit = clientIndustries.some((ci) => rowIndustry.includes(ci) || ci.includes(rowIndustry));
    if (hit) {
      matched.push({
        id: r.id,
        object_type: r.object_type,
        object_json: json,
        source: r.source ?? null,
        confidence: r.confidence ?? null,
        updated_at: typeof r.updated_at === 'string' ? r.updated_at : (r.updated_at as Date).toISOString()
      });
    }
  }
  return matched.slice(0, 20);
}

function safeJson(s: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
