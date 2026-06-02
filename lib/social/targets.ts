/**
 * lib/social/targets.ts (#45, val 2026-06-02)
 *
 * CRUD for social_targets -- the per-brand postable-identity layer that sits
 * on top of social_connections (the OAuth token store).
 *
 * Schema: schema/066_social_targets.sql.
 *
 * Lifecycle of a row:
 *   1. addSuggestedTarget()  -- val pastes URL OR scraper finds one;
 *                              row created with status='suggested'.
 *   2. confirmTarget()       -- client (or val) confirms it's the right account.
 *   3. attachConnection()    -- OAuth callback succeeds; row becomes 'connected'
 *                              with a connection_id and target_account_urn.
 *      (skipped for FB/IG/TikTok until those providers wire up;
 *       those targets sit at 'confirmed' as captured intelligence.)
 *   4. rejectTarget()        -- client says "not me"; status='rejected'.
 *
 * Side-effects on call: og:image is fetched lazily on suggest unless caller
 * passes one in. Failed og fetches don't fail the insert; we save status='ok'
 * with NULL avatar and a NULL og_fetched_at, then a later refresh can retry.
 *
 * SCOPING: every read takes either client_id (per-brand) OR tenant_id
 * (operator-level fallback). The publisher always queries by client_id when
 * posting for a brand; cross-brand bleed is impossible because the UNIQUE key
 * includes client_id.
 */
import { createHash } from 'crypto';
import { getAvDb } from '@/lib/db/av';
import { parseSocialUrl, type ParsedProvider, type ParsedKind } from '@/lib/social/url_parser';
import { fetchOgPreview } from '@/lib/social/og_fetch';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

export type TargetType = 'personal' | 'organization' | 'page';
export type TargetStatus = 'suggested' | 'confirmed' | 'connected' | 'rejected' | 'error';
export type TargetSource = 'val_intake' | 'client_intake' | 'scraper' | 'manual_add';

export interface SocialTarget {
  id: number;
  tenantId: string;
  clientId: number | null;
  connectionId: number | null;
  provider: ParsedProvider;
  targetType: TargetType;
  targetAccountUrn: string | null;
  targetAccountId: string | null;
  sourceUrl: string;
  displayName: string | null;
  avatarUrl: string | null;
  ogTitle: string | null;
  ogFetchedAt: Date | null;
  status: TargetStatus;
  source: TargetSource;
  addedAt: Date;
  confirmedAt: Date | null;
  connectedAt: Date | null;
  rejectedAt: Date | null;
  lastError: string | null;
}

interface TargetRow extends RowDataPacket {
  id: number;
  tenant_id: string;
  client_id: number | null;
  connection_id: number | null;
  provider: ParsedProvider;
  target_type: TargetType;
  target_account_urn: string | null;
  target_account_id: string | null;
  source_url: string;
  display_name: string | null;
  avatar_url: string | null;
  og_title: string | null;
  og_fetched_at: Date | null;
  status: TargetStatus;
  source: TargetSource;
  added_at: Date;
  confirmed_at: Date | null;
  connected_at: Date | null;
  rejected_at: Date | null;
  last_error: string | null;
}

function mapRow(r: TargetRow): SocialTarget {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    clientId: r.client_id,
    connectionId: r.connection_id,
    provider: r.provider,
    targetType: r.target_type,
    targetAccountUrn: r.target_account_urn,
    targetAccountId: r.target_account_id,
    sourceUrl: r.source_url,
    displayName: r.display_name,
    avatarUrl: r.avatar_url,
    ogTitle: r.og_title,
    ogFetchedAt: r.og_fetched_at,
    status: r.status,
    source: r.source,
    addedAt: r.added_at,
    confirmedAt: r.confirmed_at,
    connectedAt: r.connected_at,
    rejectedAt: r.rejected_at,
    lastError: r.last_error
  };
}

function hashUrl(s: string): string {
  return createHash('sha1').update(s).digest('hex');
}

// ---- Reads -----------------------------------------------------------------

/**
 * All targets for a brand, newest first. The operator panel + the per-brand
 * intake block both call this.
 */
export async function listTargetsForBrand(clientId: number): Promise<SocialTarget[]> {
  if (!clientId || !Number.isFinite(clientId) || clientId <= 0) return [];
  const db = getAvDb();
  const [rows] = await db.query<TargetRow[]>(
    `SELECT * FROM social_targets
       WHERE client_id = ?
       ORDER BY provider, added_at DESC, id DESC`,
    [clientId]
  );
  return rows.map(mapRow);
}

/**
 * Connected, postable targets for a brand on a given provider. Used by the
 * publisher when picking the URN to post AS.
 */
export async function findPostableTargets(
  clientId: number,
  provider: ParsedProvider
): Promise<SocialTarget[]> {
  if (!clientId || !provider) return [];
  const db = getAvDb();
  const [rows] = await db.query<TargetRow[]>(
    `SELECT * FROM social_targets
       WHERE client_id = ? AND provider = ? AND status = 'connected'
       ORDER BY target_type = 'organization' DESC, target_type = 'page' DESC, added_at DESC`,
    [clientId, provider]
  );
  return rows.map(mapRow);
}

export async function getTargetById(id: number): Promise<SocialTarget | null> {
  if (!id || !Number.isFinite(id)) return null;
  const db = getAvDb();
  const [rows] = await db.query<TargetRow[]>(
    `SELECT * FROM social_targets WHERE id = ? LIMIT 1`,
    [id]
  );
  return rows.length ? mapRow(rows[0]) : null;
}

// ---- Writes ----------------------------------------------------------------

export interface AddSuggestedInput {
  tenantId: string;
  clientId: number | null;
  url: string;
  source: TargetSource;
  addedByUserId?: number | null;
  /** Skip the og:image fetch (caller will refresh later). */
  skipOgFetch?: boolean;
}

export interface AddSuggestedResult {
  ok: boolean;
  target: SocialTarget | null;
  /** When ok=false, why. When ok=true and the URL was duplicate, this is set. */
  note?: 'duplicate' | 'unrecognized' | 'parse_failed' | 'db_error';
}

/**
 * Insert a target row from a pasted URL or a scraper finding. Idempotent on
 * (client_id, provider, source_url_hash): re-adding the same URL for the same
 * brand returns the existing row without changing its status.
 *
 * og:image fetch is in-line by default but caller can defer with
 * skipOgFetch=true (e.g. when adding 10 URLs in one paste -- we want the row
 * to exist before slow network).
 */
export async function addSuggestedTarget(input: AddSuggestedInput): Promise<AddSuggestedResult> {
  const parseResult = parseSocialUrl(input.url);
  if (!parseResult.ok) {
    return { ok: false, target: null, note: parseResult.reason === 'unrecognized_platform' ? 'unrecognized' : 'parse_failed' };
  }
  const { parsed } = parseResult;
  const inferredType: TargetType = parsed.kind === 'company' ? 'organization' : parsed.kind === 'page' ? 'page' : 'personal';
  const urlHash = hashUrl(parsed.normalizedUrl);

  const db = getAvDb();

  // Check duplicate first to avoid a wasteful og:image fetch if the row exists.
  const [existing] = await db.query<TargetRow[]>(
    `SELECT * FROM social_targets
       WHERE client_id ${input.clientId == null ? 'IS NULL' : '= ?'}
         AND provider = ?
         AND source_url_hash = ?
       LIMIT 1`,
    input.clientId == null ? [parsed.provider, urlHash] : [input.clientId, parsed.provider, urlHash]
  );
  if (existing.length) {
    return { ok: true, target: mapRow(existing[0]), note: 'duplicate' };
  }

  // Fetch og preview unless caller defers.
  let ogImage: string | null = null;
  let ogTitle: string | null = null;
  let ogFetchedAt: Date | null = null;
  if (!input.skipOgFetch) {
    const preview = await fetchOgPreview(parsed.normalizedUrl);
    ogImage = preview.ogImage;
    ogTitle = preview.ogTitle;
    ogFetchedAt = preview.fetchedAt;
  }

  try {
    const [res] = await db.query<ResultSetHeader>(
      `INSERT INTO social_targets
         (tenant_id, client_id, provider, target_type, target_account_id,
          source_url, source_url_hash, display_name, avatar_url, og_title,
          og_fetched_at, status, source, added_by_user_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'suggested', ?, ?)`,
      [
        input.tenantId,
        input.clientId,
        parsed.provider,
        inferredType,
        parsed.accountId,
        parsed.normalizedUrl,
        urlHash,
        ogTitle,
        ogImage,
        ogTitle,
        ogFetchedAt,
        input.source,
        input.addedByUserId ?? null
      ]
    );
    const created = await getTargetById(res.insertId);
    return { ok: true, target: created };
  } catch (e) {
    // Race: another caller inserted the same URL between our SELECT and
    // INSERT. Re-fetch and treat as duplicate.
    const [retry] = await db.query<TargetRow[]>(
      `SELECT * FROM social_targets
         WHERE client_id ${input.clientId == null ? 'IS NULL' : '= ?'}
           AND provider = ?
           AND source_url_hash = ?
         LIMIT 1`,
      input.clientId == null ? [parsed.provider, urlHash] : [input.clientId, parsed.provider, urlHash]
    );
    if (retry.length) {
      return { ok: true, target: mapRow(retry[0]), note: 'duplicate' };
    }
    return { ok: false, target: null, note: 'db_error' };
  }
}

/** Many at once -- returns one result per input URL, order preserved. */
export async function addSuggestedTargets(
  tenantId: string,
  clientId: number | null,
  urls: string[],
  source: TargetSource,
  addedByUserId?: number | null
): Promise<AddSuggestedResult[]> {
  const out: AddSuggestedResult[] = [];
  for (const url of urls) {
    // Sequential -- og fetches dominate latency; we'd rather be polite than fast.
    // For 20 URLs that's ~20s worst case; the paste box is OK with that.
    // eslint-disable-next-line no-await-in-loop
    out.push(await addSuggestedTarget({ tenantId, clientId, url, source, addedByUserId }));
  }
  return out;
}

export async function confirmTarget(id: number): Promise<SocialTarget | null> {
  const db = getAvDb();
  await db.query<ResultSetHeader>(
    `UPDATE social_targets
        SET status='confirmed', confirmed_at=NOW(), rejected_at=NULL, last_error=NULL
      WHERE id = ?`,
    [id]
  );
  return getTargetById(id);
}

export async function rejectTarget(id: number): Promise<SocialTarget | null> {
  const db = getAvDb();
  await db.query<ResultSetHeader>(
    `UPDATE social_targets
        SET status='rejected', rejected_at=NOW(), connection_id=NULL,
            connected_at=NULL, target_account_urn=NULL
      WHERE id = ?`,
    [id]
  );
  return getTargetById(id);
}

export async function attachConnection(
  id: number,
  connectionId: number,
  targetAccountUrn: string | null
): Promise<SocialTarget | null> {
  const db = getAvDb();
  await db.query<ResultSetHeader>(
    `UPDATE social_targets
        SET connection_id = ?, target_account_urn = ?, status='connected',
            connected_at=NOW(), last_error=NULL
      WHERE id = ?`,
    [connectionId, targetAccountUrn, id]
  );
  return getTargetById(id);
}

export async function markTargetError(id: number, error: string): Promise<void> {
  const db = getAvDb();
  await db.query<ResultSetHeader>(
    `UPDATE social_targets SET status='error', last_error=? WHERE id = ?`,
    [error.slice(0, 500), id]
  );
}

/**
 * Operator-only: delete a target outright. Used when val pastes a wrong URL
 * and wants it gone, vs reject (which keeps it as a "not me" decision).
 */
export async function deleteTarget(id: number): Promise<void> {
  const db = getAvDb();
  await db.query<ResultSetHeader>(`DELETE FROM social_targets WHERE id = ?`, [id]);
}

// ---- Scraper wire-up -------------------------------------------------------

/**
 * Pull socials directly from a brand's website. lib/scraper/contact_page.ts
 * `findSocials()` already extracts IG/FB/LinkedIn/X URLs from a page's HTML --
 * we run the SAME scrape val's discovery uses, then auto-suggest whatever it
 * finds as targets for the brand.
 *
 * Dynamic import keeps the scraper module out of any caller that doesn't need
 * it. Each found URL goes through addSuggestedTarget (idempotent on dedup).
 */
export async function scrapeAndSuggestForBrand(
  clientId: number,
  websiteUrl: string,
  addedByUserId?: number | null
): Promise<{ found: number; saved: number; skipped: number }> {
  if (!clientId || !websiteUrl) return { found: 0, saved: 0, skipped: 0 };
  // Dynamic import to avoid pulling scraper deps into bundles that don't need them.
  const { scrapeContactPage } = await import('@/lib/scraper/contact_page');
  const scraped = await scrapeContactPage(websiteUrl);
  const urls: string[] = [];
  if (scraped.socials.instagram) urls.push(scraped.socials.instagram);
  if (scraped.socials.facebook) urls.push(scraped.socials.facebook);
  if (scraped.socials.linkedin) urls.push(scraped.socials.linkedin);
  if (scraped.socials.twitter) urls.push(scraped.socials.twitter);

  let saved = 0;
  let skipped = 0;
  for (const url of urls) {
    // eslint-disable-next-line no-await-in-loop
    const r = await addSuggestedTarget({
      tenantId: 'av',
      clientId,
      url,
      source: 'scraper',
      addedByUserId: addedByUserId ?? null
    });
    if (r.ok && r.note !== 'duplicate') saved += 1;
    else skipped += 1;
  }
  return { found: urls.length, saved, skipped };
}
