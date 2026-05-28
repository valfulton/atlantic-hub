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
  media_friendly_topics:       ['PR discovery', 'Client guidance']
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
}

// ──────────────────────────────────────────────────────────────────────────
// Loader
// ──────────────────────────────────────────────────────────────────────────
export async function loadIntelInventory(clientId: number): Promise<IntelInventory> {
  const db = getAvDb();

  // 1. intelligence_objects under tenant 'client:<id>'
  const tenant = `client:${clientId}`;
  const [ioRows] = await db.execute<(IntelligenceObjectRow & RowDataPacket)[]>(
    `SELECT id, object_type, object_json, source, confidence, updated_at
       FROM intelligence_objects
      WHERE tenant_id = ?
      ORDER BY object_type ASC, updated_at DESC`,
    [tenant]
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

  return {
    clientId,
    intelligenceObjects,
    briefFields,
    rawIntakeFields,
    intakeHas,
    briefHas,
    hasAnyExtractedIntel: intelligenceObjects.length > 0,
    missingIntelTypes
  };
}
