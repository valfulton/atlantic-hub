/**
 * lib/copy/store.ts  (newsroom team, 2026-06-04)
 *
 * General-purpose, operator-editable site copy. The wider sibling of
 * lib/welcome/copy.ts (#408 popup_copy). Every client-facing string can be
 * overridden in the DB and edited at /admin/av/copy, with a hardcoded
 * DEFAULTS safety net so a fresh/empty DB always renders sane copy.
 *
 * Resolution priority (most specific wins):
 *   1. (key, clientId, stage)   exact override
 *   2. (key, clientId, '')      per-client default
 *   3. (key, 0,        stage)   global stage default
 *   4. (key, 0,        '')      global default
 *   5. DEFAULTS[key]            hardcoded fallback
 *
 * Sentinels (see schema/072): client_id 0 = global, stage '' = any. The
 * public API speaks `clientId?: number` / `stage?: string`; undefined maps
 * to the sentinel. Reads are SERVER-SIDE only — never leak one tenant's
 * overrides to another.
 */
import { getAvDb } from '@/lib/db/av';
import type { RowDataPacket } from 'mysql2';

export interface CopyCtx {
  clientId?: number | null;
  stage?: string | null;
}

const GLOBAL = 0;     // client_id sentinel for "all clients"
const ANY = '';       // stage sentinel for "any stage"

/* ------------------------------------------------------------------ *
 * DEFAULTS — same key namespace as newsroom_editable.html, namespaced
 * by surface (newsroom.*, dashboard.*, …). Keep these honest: they are
 * the live fallback when no DB row exists.
 * ------------------------------------------------------------------ */
export const DEFAULTS: Record<string, string> = {
  // ---- newsroom (public + in-app) ----
  'newsroom.nav.cta': 'Apply Now',
  'newsroom.wire.title': 'The Wire',
  'newsroom.wire.sub': 'stories worth stopping for.',
  'newsroom.live.badge': 'Live',
  'newsroom.hero.kicker': 'Featured',
  'newsroom.hero.title': "Everyone's booking the waterfront before summer even ends.",
  'newsroom.hero.dek': 'Our desk caught the fall-2026 offsite rush early — and traced it straight to three live client campaigns.',
  'newsroom.hero.desk': 'Atlantic & Vine · Market Desk',
  'newsroom.sec.trending': 'Trending now',
  'newsroom.sec.briefs': 'Market Briefs',
  'newsroom.footer.tagline': 'Strategic marketing for ambitious companies. Founded by Val Fulton.',
  'newsroom.footer.signoff': 'Deeply rooted. Visions of freedom.',
  'newsroom.footer.copyright': '© 2026 Atlantic & Vine. All rights reserved.',
  // ---- channel page ----
  'channel.verified': '✦ Verified on the Wire',
  'channel.network.strip': 'Part of the Atlantic & Vine network — every story here builds the shared authority that lifts the whole roster.',
  'channel.sec.commercials': 'Their commercials',
  'channel.sec.briefs': 'Market briefs on their campaigns',
  // ---- client dashboard ----
  'dashboard.greeting': 'Good morning, {firstName}.',
  'dashboard.hero.eyebrow': "✦ This week's strongest signal",
  'dashboard.sec.watchlist': 'Your *watchlist*',
  'dashboard.sec.leads': 'Fresh *leads*',
  'dashboard.empty': 'No entries yet. As your public-records sources fire, the strongest signals will land here.',
  // ---- leads ----
  'leads.eyebrow': 'Your pipeline',
  'leads.h1': 'Your pipeline, *{firstName}.*',
  'leads.sec.hot': 'Hot fits',
  'leads.sec.pipeline': 'In your pipeline',
  // ---- watchlist ---- (headlines use *accent* word; {firstName} interpolated)
  'watchlist.eyebrow': 'Your watchlist',
  'watchlist.h1': "Who's about to need you, *{firstName}.*",
  'watchlist.lede': 'Businesses showing public signals of distress, ranked every morning. Open one to see who they are and how to reach out.',
  'watchlist.empty': "Your watchlist is empty. Court filings, suspensions, vendor exposure, and review trends post here as they're filed.",
  // ---- pr ----
  'pr.eyebrow': 'Your press queue',
  'pr.h1': 'Your press is *moving.*',
  'pr.lede': 'When a journalist needs an expert on what you cover, a drafted pitch lands here. You approve before anything goes out.',
  // ---- intake (framing only; field labels stay in intake_fields.ts) ----
  'intake.eyebrow': 'Your details',
  'intake.h1': 'Tell us about *your business.*',
  'intake.lede': "Review and perfect what we've prefilled for you. Every save keeps a restore point.",
};

/* ------------------------------------------------------------------ */

interface CopyRow extends RowDataPacket {
  client_id: number;
  stage: string;
  value_text: string;
}

function specificity(clientId: number, stage: string): number {
  return (clientId !== GLOBAL ? 2 : 0) + (stage !== ANY ? 1 : 0);
}

/**
 * Resolve a single copy slot. Returns the DB override if present, else the
 * hardcoded DEFAULT, else the key itself (so a missing default is visible,
 * not blank).
 */
export async function getCopy(key: string, ctx: CopyCtx = {}): Promise<string> {
  const clientId = ctx.clientId ?? GLOBAL;
  const stage = ctx.stage ?? ANY;
  try {
    const db = getAvDb();
    const [rows] = await db.execute<CopyRow[]>(
      `SELECT client_id, stage, value_text
         FROM site_copy
        WHERE copy_key = ?
          AND client_id IN (?, ${GLOBAL})
          AND stage IN (?, '')`,
      [key, clientId, stage]
    );
    if (rows.length) {
      let best: CopyRow | null = null;
      let bestScore = -1;
      for (const r of rows) {
        const s = specificity(r.client_id, r.stage);
        if (s > bestScore) { best = r; bestScore = s; }
      }
      if (best) return best.value_text;
    }
  } catch {
    // fall through to DEFAULTS — never crash a page on a copy lookup
  }
  return DEFAULTS[key] ?? key;
}

/**
 * Batch resolver — one query for many keys (use in page loaders to avoid N
 * round-trips). Returns a {key: value} map covering every requested key.
 */
export async function getCopyMap(keys: string[], ctx: CopyCtx = {}): Promise<Record<string, string>> {
  const clientId = ctx.clientId ?? GLOBAL;
  const stage = ctx.stage ?? ANY;
  const out: Record<string, string> = {};
  for (const k of keys) out[k] = DEFAULTS[k] ?? k; // seed with defaults
  if (!keys.length) return out;
  try {
    const db = getAvDb();
    const placeholders = keys.map(() => '?').join(',');
    const [rows] = await db.execute<CopyRow[]>(
      `SELECT copy_key, client_id, stage, value_text
         FROM site_copy
        WHERE copy_key IN (${placeholders})
          AND client_id IN (?, ${GLOBAL})
          AND stage IN (?, '')`,
      [...keys, clientId, stage]
    );
    const bestScore: Record<string, number> = {};
    for (const r of rows as Array<CopyRow & { copy_key: string }>) {
      const s = specificity(r.client_id, r.stage);
      if (s > (bestScore[r.copy_key] ?? -1)) {
        out[r.copy_key] = r.value_text;
        bestScore[r.copy_key] = s;
      }
    }
  } catch {
    // defaults already seeded
  }
  return out;
}

/**
 * Upsert an override. clientId/stage undefined → global/any sentinels.
 * Returns the effective (key, clientId, stage) that was written.
 */
export async function saveCopy(
  key: string,
  value: string,
  ctx: CopyCtx,
  actor: string | null
): Promise<{ key: string; clientId: number; stage: string }> {
  const clientId = ctx.clientId ?? GLOBAL;
  const stage = ctx.stage ?? ANY;
  const db = getAvDb();
  await db.execute(
    `INSERT INTO site_copy (copy_key, client_id, stage, value_text, updated_by)
          VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE value_text = VALUES(value_text), updated_by = VALUES(updated_by)`,
    [key, clientId, stage, value, actor]
  );
  return { key, clientId, stage };
}

/**
 * Remove an override so the slot falls back to the next-most-specific match
 * (Reset in the editor). No-op on the global/any row's DEFAULT (you can
 * clear the global override row; the hardcoded DEFAULT remains).
 */
export async function clearCopy(key: string, ctx: CopyCtx): Promise<void> {
  const clientId = ctx.clientId ?? GLOBAL;
  const stage = ctx.stage ?? ANY;
  const db = getAvDb();
  await db.execute(
    `DELETE FROM site_copy WHERE copy_key = ? AND client_id = ? AND stage = ?`,
    [key, clientId, stage]
  );
}

export interface CopyEdit {
  copy_key: string;
  client_id: number | null; // null = global (sentinel 0 mapped out)
  stage: string | null;     // null = any (sentinel '' mapped out)
  updated_by: string | null;
  updated_at: string;
}

/** Recent edits for the conductor's steering-wheel poll (D4). */
export async function getRecentEdits(sinceIso: string): Promise<CopyEdit[]> {
  const db = getAvDb();
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT copy_key, client_id, stage, updated_by, updated_at
       FROM site_copy
      WHERE updated_at > ?
      ORDER BY updated_at DESC
      LIMIT 200`,
    [new Date(sinceIso)]
  );
  return (rows as any[]).map((r) => ({
    copy_key: r.copy_key,
    client_id: r.client_id === GLOBAL ? null : Number(r.client_id),
    stage: r.stage === ANY ? null : r.stage,
    updated_by: r.updated_by ?? null,
    updated_at: new Date(r.updated_at).toISOString(),
  }));
}

/** All keys the editor groups/searches over (registry for D2 + D6). */
export const COPY_KEYS = Object.keys(DEFAULTS);
