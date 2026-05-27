/**
 * lib/client/brief_store.ts
 *
 * The read/write layer for the editable Creative Brief (schema/045_creative_briefs.sql).
 *
 * ONE shape for everyone — the canonical 6-question brief payload (same keys as
 * client_users.intake_payload), keyed by:
 *   * a real client -> (tenant_id, client_id)
 *   * a house brand -> (tenant_id, client_id = NULL)   e.g. 'av' / 'ebw' / 'hh'
 *
 * Why this exists: until now val's OWN brands had no intake record, so the thesis
 * suggester and the PR drafter fell back to a hardcoded "Atlantic & Vine" label and
 * generic grounding. getBriefForPrompt() gives both call sites a single grounded
 * identity block to anchor on, so AV / EBW / HH each speak as themselves.
 *
 * Reuses extractBriefSeedFromIntake() so a brief_payload and an intake_payload are
 * interchangeable. Never throws out of the read path — a missing brief degrades to
 * "no brief on file yet" rather than blanking the caller.
 */
import { getAvDb } from '@/lib/db/av';
import { extractBriefSeedFromIntake, type BriefSeed } from '@/lib/client/intake_brief';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

/** Display names for the house brands (client_id NULL). */
export const HOUSE_BRAND_NAMES: Record<string, string> = {
  av: 'Atlantic & Vine',
  ebw: 'Events by Water',
  hh: 'HunterHoney'
};

export type BriefPayload = Record<string, unknown>;

/**
 * How a brand uses the PR / news intel — drives matching + default voice.
 *   self_promotion: win visibility FOR this brand (speak AS them).
 *   work_leads:     use intel to approach THEIR OWN prospects (reach out TO a lead).
 *   both:           either, depending on the opportunity.
 */
export type IntelPosture = 'self_promotion' | 'work_leads' | 'both';
/** The PR pitch voice (mirrors lib/pr/types PitchMode). */
export type IntelVoice = 'client_voice' | 'advisory' | 'congratulatory';

export interface IntelConfig {
  posture: IntelPosture | null;
  defaultVoice: IntelVoice | null;
}

const POSTURES: IntelPosture[] = ['self_promotion', 'work_leads', 'both'];
const VOICES: IntelVoice[] = ['client_voice', 'advisory', 'congratulatory'];

interface BriefRow extends RowDataPacket {
  brief_payload: string | BriefPayload | null;
}

interface IntakeRow extends RowDataPacket {
  intake_payload: string | BriefPayload | null;
}

interface ClientNameRow extends RowDataPacket {
  client_name: string | null;
}

function asPayload(raw: unknown): BriefPayload | null {
  if (raw == null) return null;
  let v: unknown = raw;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch { return null; }
  }
  return v && typeof v === 'object' ? (v as BriefPayload) : null;
}

/**
 * Read the brief payload for a scope. Resolution order:
 *   1. creative_briefs row for (tenant, client_id)  — the editable brief
 *   2. for a real client only: that client's client_users.intake_payload (legacy
 *      source, so existing clients still ground before they get a saved brief)
 *   3. null (no brief on file yet)
 */
export async function getBriefPayload(
  tenantId: string,
  clientId: number | null
): Promise<BriefPayload | null> {
  const db = getAvDb();
  try {
    const [rows] = await db.execute<BriefRow[]>(
      `SELECT brief_payload FROM creative_briefs
        WHERE tenant_id = ? AND client_id <=> ?
        ORDER BY updated_at DESC LIMIT 1`,
      [tenantId, clientId]
    );
    const payload = asPayload(rows[0]?.brief_payload ?? null);
    if (payload) return payload;
  } catch (err) {
    console.error('[brief_store:get]', (err as Error).message);
  }

  // Fall back to the client's intake answers (legacy source of truth).
  if (clientId != null) {
    try {
      const [rows] = await db.execute<IntakeRow[]>(
        `SELECT intake_payload FROM client_users
          WHERE client_id = ? AND intake_payload IS NOT NULL
          ORDER BY updated_at DESC LIMIT 1`,
        [clientId]
      );
      return asPayload(rows[0]?.intake_payload ?? null);
    } catch (err) {
      console.error('[brief_store:get:intake_fallback]', (err as Error).message);
    }
  }

  return null;
}

/**
 * Upsert the brief payload for a scope. Emulated upsert (SELECT then UPDATE/INSERT)
 * because MySQL does not dedupe NULL client_id in a unique index — same pattern as
 * intelligence_objects in lib/pr/drafter.ts. Returns true on a successful write.
 */
export async function saveBriefPayload(
  tenantId: string,
  clientId: number | null,
  payload: BriefPayload,
  opts: { changedBy?: string | null; source?: string } = {}
): Promise<boolean> {
  const db = getAvDb();
  const json = JSON.stringify(payload ?? {});
  try {
    // Snapshot the CURRENT effective payload as a restore point BEFORE overwriting,
    // so nothing is ever lost (covers operator edits and client resubmissions).
    await snapshotBriefVersion(tenantId, clientId, opts.source ?? 'operator', opts.changedBy ?? null);

    const [rows] = await db.execute<(RowDataPacket & { id: number })[]>(
      `SELECT id FROM creative_briefs
        WHERE tenant_id = ? AND client_id <=> ? LIMIT 1`,
      [tenantId, clientId]
    );
    if (rows[0]?.id) {
      await db.execute<ResultSetHeader>(
        `UPDATE creative_briefs
            SET brief_payload = CAST(? AS JSON), updated_at = NOW()
          WHERE id = ?`,
        [json, rows[0].id]
      );
    } else {
      await db.execute<ResultSetHeader>(
        `INSERT INTO creative_briefs (tenant_id, client_id, brief_payload)
         VALUES (?, ?, CAST(? AS JSON))`,
        [tenantId, clientId, json]
      );
    }
    return true;
  } catch (err) {
    console.error('[brief_store:save]', (err as Error).message);
    return false;
  }
}

export interface BriefVersion {
  id: number;
  source: string;
  changedBy: string | null;
  createdAt: string;
  payload: BriefPayload | null;
}

/**
 * Write a restore-point snapshot of the CURRENT effective payload for a scope.
 * No-op if there's nothing to snapshot. Never throws (versioning must not block a save).
 */
export async function snapshotBriefVersion(
  tenantId: string,
  clientId: number | null,
  source: string,
  changedBy: string | null
): Promise<void> {
  try {
    const current = await getBriefPayload(tenantId, clientId);
    if (!current || Object.keys(current).length === 0) return;
    const db = getAvDb();
    await db.execute<ResultSetHeader>(
      `INSERT INTO creative_brief_versions (tenant_id, client_id, brief_payload, source, changed_by)
       VALUES (?, ?, CAST(? AS JSON), ?, ?)`,
      [tenantId, clientId, JSON.stringify(current), source.slice(0, 24), changedBy]
    );
  } catch (err) {
    console.error('[brief_store:snapshot]', (err as Error).message);
  }
}

/** List restore points for a scope, newest first. */
export async function listBriefVersions(tenantId: string, clientId: number | null): Promise<BriefVersion[]> {
  try {
    const db = getAvDb();
    const [rows] = await db.execute<(RowDataPacket & { id: number; source: string; changed_by: string | null; created_at: string; brief_payload: string | BriefPayload | null })[]>(
      `SELECT id, source, changed_by, created_at, brief_payload
         FROM creative_brief_versions
        WHERE tenant_id = ? AND client_id <=> ?
        ORDER BY created_at DESC, id DESC
        LIMIT 50`,
      [tenantId, clientId]
    );
    return rows.map((r) => ({
      id: r.id,
      source: r.source,
      changedBy: r.changed_by,
      createdAt: typeof r.created_at === 'string' ? r.created_at : String(r.created_at),
      payload: asPayload(r.brief_payload)
    }));
  } catch (err) {
    console.error('[brief_store:listVersions]', (err as Error).message);
    return [];
  }
}

/**
 * Restore a prior version: snapshots the current payload first (so restore is itself
 * reversible), then writes the version's payload back as the live brief.
 */
export async function restoreBriefVersion(
  tenantId: string,
  clientId: number | null,
  versionId: number,
  changedBy: string | null
): Promise<boolean> {
  try {
    const db = getAvDb();
    const [rows] = await db.execute<(RowDataPacket & { brief_payload: string | BriefPayload | null })[]>(
      `SELECT brief_payload FROM creative_brief_versions
        WHERE id = ? AND tenant_id = ? AND client_id <=> ? LIMIT 1`,
      [versionId, tenantId, clientId]
    );
    const payload = asPayload(rows[0]?.brief_payload ?? null);
    if (!payload) return false;
    return await saveBriefPayload(tenantId, clientId, payload, { changedBy, source: 'restore' });
  } catch (err) {
    console.error('[brief_store:restore]', (err as Error).message);
    return false;
  }
}

/**
 * The PR intel posture + default voice for a scope, read from the brief payload.
 * Both null when unset (caller falls back to its own default). Editable any time
 * in the Creative Brief editor — val can change a brand's voice whenever.
 */
export async function getIntelConfig(tenantId: string, clientId: number | null): Promise<IntelConfig> {
  const payload = await getBriefPayload(tenantId, clientId);
  const rawPosture = payload?.['intel_posture'];
  const rawVoice = payload?.['default_voice'];
  return {
    posture: POSTURES.includes(rawPosture as IntelPosture) ? (rawPosture as IntelPosture) : null,
    defaultVoice: VOICES.includes(rawVoice as IntelVoice) ? (rawVoice as IntelVoice) : null
  };
}

/** The brief payload parsed into the canonical BriefSeed (and starter line seed). */
export async function getBriefSeed(
  tenantId: string,
  clientId: number | null
): Promise<BriefSeed | null> {
  const payload = await getBriefPayload(tenantId, clientId);
  if (!payload) return null;
  return extractBriefSeedFromIntake(payload);
}

/** Resolve a human brand name for a scope: client_name for a client, else the house brand. */
async function resolveBrandName(
  tenantId: string,
  clientId: number | null,
  fallback?: string | null
): Promise<string> {
  if (clientId != null) {
    try {
      const db = getAvDb();
      const [rows] = await db.execute<ClientNameRow[]>(
        `SELECT client_name FROM clients WHERE client_id = ? LIMIT 1`,
        [clientId]
      );
      const name = rows[0]?.client_name?.trim();
      if (name) return name;
    } catch (err) {
      console.error('[brief_store:brandName]', (err as Error).message);
    }
  }
  return (fallback && fallback.trim()) || HOUSE_BRAND_NAMES[tenantId] || 'this brand';
}

/**
 * Build a grounded BRAND_IDENTITY block for an LLM prompt (thesis suggester, PR
 * drafter). Returns the brand's real identity from its brief; when no brief is on
 * file yet it says so explicitly, so the model grounds cautiously instead of
 * inventing — and never mislabels EBW/HH as "Atlantic & Vine".
 */
export async function getBriefForPrompt(args: {
  tenantId: string;
  clientId: number | null;
  fallbackName?: string | null;
}): Promise<{ brandName: string; grounded: boolean; block: string; seed: BriefSeed | null }> {
  const brandName = await resolveBrandName(args.tenantId, args.clientId, args.fallbackName);
  const seed = await getBriefSeed(args.tenantId, args.clientId);

  if (!seed) {
    return {
      brandName,
      grounded: false,
      seed: null,
      block: [
        `BRAND_IDENTITY:`,
        `  BRAND: ${brandName}`,
        `  (No creative brief on file yet for this brand — ground only in the brand name,`,
        `   the narrative line's own fields, and what its leads need. Do not invent positioning.)`
      ].join('\n')
    };
  }

  const lines: string[] = [`BRAND_IDENTITY:`, `  BRAND: ${brandName}`];
  const add = (label: string, v: string | null) => { if (v && v.trim()) lines.push(`  ${label}: ${v.trim()}`); };
  add('WHY_WE_ADVERTISE', seed.whyAdvertise);
  add('GOALS', seed.goals);
  add('AUDIENCE', seed.audience);
  add('AUDIENCE_INSIGHTS', seed.audienceInsights);
  add('KEY_MESSAGE', seed.keyMessage);
  add('PROOF_AND_SUPPORT', seed.messageSupport);
  add('VOICE', seed.brandVoice);
  add('DIFFERENTIATORS', seed.differentiators);
  add('COMPETITORS', seed.competitors);
  // PR & authority — what they can speak to, where they want to land, and the
  // proof that makes them quotable. Drives PR pitch/release grounding so a pitch
  // leads with THEIR expertise aimed at THEIR target outlets.
  add('PR_VISIBILITY_GOALS', seed.prGoals);
  add('PR_EXPERT_TOPICS', seed.prExpertTopics);
  add('PR_TIMELY_HOOKS', seed.prNewsHooks);
  add('PR_DREAM_OUTLETS', seed.prDreamOutlets);
  add('PR_SPOKESPERSON', seed.prSpokesperson);
  add('NOTABLE_CLIENTS', seed.notableClients);
  add('PRESS_AND_AWARDS', seed.pressAwards);

  const grounded = lines.length > 2; // more than BRAND_IDENTITY + BRAND
  if (!grounded) {
    lines.push(`  (Brief exists but is mostly empty — ground cautiously; do not invent positioning.)`);
  }

  return { brandName, grounded, seed, block: lines.join('\n') };
}
