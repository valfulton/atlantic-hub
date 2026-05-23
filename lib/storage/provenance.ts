/**
 * lib/storage/provenance.ts
 *
 * The asset persistence + provenance pipeline. Turns an ephemeral provider URL
 * (e.g. a Grok asset URL that expires) into a durable, fingerprinted record:
 *
 *   download -> SHA-256 hash -> store in hot storage -> record on the asset row.
 *
 * The DB row (grok_imagine_assets, schema 035) is the source of truth:
 * content_hash (immutable fingerprint), hot_storage_key (durable copy),
 * permanent_uri (Arweave, Phase 2), lineage + campaign pointers.
 *
 * Everything here is BEST-EFFORT and never throws into the caller's happy path:
 * a persistence hiccup must not break generation or serving.
 */
import { createHash } from 'node:crypto';
import { getAvDb } from '@/lib/db/av';
import { getHotStorage, getPermanence } from '@/lib/storage/provider';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';

const HOT_STORE = 'creative-assets';

export function sha256Hex(bytes: Buffer | Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function extFor(assetType: string, contentType: string): string {
  if (assetType === 'video' || contentType.includes('mp4')) return 'mp4';
  if (contentType.includes('png')) return 'png';
  if (contentType.includes('webp')) return 'webp';
  return 'jpg';
}

export function hotKeyFor(assetId: number, ext: string): string {
  return `grok/${assetId}.${ext}`;
}

interface AssetRow extends RowDataPacket {
  id: number;
  asset_type: 'image' | 'video';
  storage_url: string | null;
  hot_storage_key: string | null;
  content_hash: string | null;
}

/**
 * Ensure an asset's bytes are persisted to durable hot storage + fingerprinted.
 * Idempotent: if hot_storage_key is already set and present, it's a no-op.
 * Returns the hot key (or null if it could not be persisted, e.g. the source
 * URL already expired).
 */
export async function ensureAssetPersisted(assetId: number): Promise<string | null> {
  const db = getAvDb();
  const [rows] = await db.execute<AssetRow[]>(
    `SELECT id, asset_type, storage_url, hot_storage_key, content_hash
       FROM grok_imagine_assets WHERE id = ? LIMIT 1`,
    [assetId]
  );
  const a = rows[0];
  if (!a) return null;

  const hot = getHotStorage(HOT_STORE);

  // Already persisted + present -> done.
  if (a.hot_storage_key) {
    try {
      if (await hot.has(a.hot_storage_key)) return a.hot_storage_key;
    } catch {
      /* fall through and re-persist */
    }
  }

  if (!a.storage_url) return null;

  let bytes: Buffer;
  let contentType = a.asset_type === 'video' ? 'video/mp4' : 'image/jpeg';
  try {
    const res = await fetch(a.storage_url);
    if (!res.ok) return null; // source likely expired
    contentType = res.headers.get('content-type') || contentType;
    bytes = Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }

  const hash = sha256Hex(bytes);
  const key = hotKeyFor(assetId, extFor(a.asset_type, contentType));
  try {
    await hot.put(key, bytes, contentType);
  } catch {
    return null;
  }

  await db
    .execute<ResultSetHeader>(
      `UPDATE grok_imagine_assets SET hot_storage_key = ?, content_hash = COALESCE(content_hash, ?) WHERE id = ?`,
      [key, hash, assetId]
    )
    .catch(() => {});

  return key;
}

/** Read an asset's durable bytes (persisting on first access if needed). */
export async function getAssetBytes(assetId: number): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  const key = await ensureAssetPersisted(assetId);
  if (!key) return null;
  const hot = getHotStorage(HOT_STORE);
  const bytes = await hot.getBytes(key);
  if (!bytes) return null;
  const contentType = key.endsWith('.mp4') ? 'video/mp4' : key.endsWith('.png') ? 'image/png' : 'image/jpeg';
  return { bytes, contentType };
}

/**
 * Mark an asset as a KEEPER (approved/published) and, when a permanence provider
 * is configured (Phase 2: Arweave/Irys), archive it permanently and record the
 * permanent_uri. Today permanence is a no-op, so this just sets the flag --
 * which is exactly the intended upgrade path (no chain logic required now).
 */
export async function markKeeper(assetId: number): Promise<{ keeper: true; permanentUri: string | null }> {
  const db = getAvDb();
  await db.execute<ResultSetHeader>(`UPDATE grok_imagine_assets SET is_keeper = 1 WHERE id = ?`, [assetId]).catch(() => {});

  const permanence = getPermanence();
  if (!permanence.available()) return { keeper: true, permanentUri: null };

  // Ensure we have the bytes, then archive permanently.
  const got = await getAssetBytes(assetId);
  if (!got) return { keeper: true, permanentUri: null };
  try {
    const result = await permanence.archive(got.bytes, got.contentType, { assetId: String(assetId) });
    await db
      .execute<ResultSetHeader>(`UPDATE grok_imagine_assets SET permanent_uri = ? WHERE id = ?`, [result.uri, assetId])
      .catch(() => {});
    return { keeper: true, permanentUri: result.uri };
  } catch {
    return { keeper: true, permanentUri: null };
  }
}
