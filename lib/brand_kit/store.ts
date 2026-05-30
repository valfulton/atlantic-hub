/**
 * lib/brand_kit/store.ts
 *
 * DB helpers for `lead_brand_kits`. One row per lead; UPSERT pattern.
 *
 * The logo bytes live INLINE as LONGBLOB in v1 for zero new-storage
 * cost. Phase 2 swaps for an object-store URL once the asset rehosting
 * work lands; the API surface here stays the same.
 *
 * Never throws on a missing row — readers get null and decide what to
 * do.
 */
import { getAvDb } from '@/lib/db/av';
import type { BrandKitRecord, BrandKitUpsertInput, LogoPosition } from '@/lib/brand_kit/types';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';

interface BrandKitRow extends RowDataPacket {
  id: number;
  lead_id: number;
  logo_data: Buffer | null;
  logo_mime_type: string | null;
  logo_filename: string | null;
  logo_width: number | null;
  logo_height: number | null;
  default_position: LogoPosition;
  default_opacity: string | number;
  default_scale: string | number;
  default_padding: number;
  auto_apply: 0 | 1;
  created_at: string;
  updated_at: string;
  created_by_user_id: number | null;
}

function rowToRecord(row: BrandKitRow, includeDataUrl: boolean): BrandKitRecord {
  const hasLogo = Boolean(row.logo_data && row.logo_mime_type);
  const rec: BrandKitRecord = {
    id: row.id,
    leadId: row.lead_id,
    hasLogo,
    logoMimeType: row.logo_mime_type,
    logoFilename: row.logo_filename,
    logoWidth: row.logo_width,
    logoHeight: row.logo_height,
    defaultPosition: row.default_position,
    defaultOpacity: Number(row.default_opacity),
    defaultScale: Number(row.default_scale),
    defaultPadding: row.default_padding,
    autoApply: Boolean(row.auto_apply),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
  if (includeDataUrl && hasLogo && row.logo_data && row.logo_mime_type) {
    rec.logoDataUrl = `data:${row.logo_mime_type};base64,${row.logo_data.toString('base64')}`;
  }
  return rec;
}

/** Latest brand kit for a lead. Returns null if none exists. */
export async function getBrandKitForLead(
  leadId: number,
  options: { includeDataUrl?: boolean } = {}
): Promise<BrandKitRecord | null> {
  const db = getAvDb();
  try {
    const [rows] = await db.execute<BrandKitRow[]>(
      `SELECT id, lead_id, logo_data, logo_mime_type, logo_filename, logo_width,
              logo_height, default_position, default_opacity, default_scale,
              default_padding, auto_apply, created_at, updated_at, created_by_user_id
       FROM lead_brand_kits
       WHERE lead_id = ?
       LIMIT 1`,
      [leadId]
    );
    return rows[0] ? rowToRecord(rows[0], !!options.includeDataUrl) : null;
  } catch (err) {
    // Table missing (schema 023 not applied yet) -> null, not crash.
    const msg = (err as Error).message || '';
    if (msg.includes("Table") && msg.includes("doesn't exist")) return null;
    throw err;
  }
}

/** Fetch just the raw logo buffer + mime, no decoded settings. */
export async function getBrandKitLogoBuffer(
  leadId: number
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  const db = getAvDb();
  try {
    const [rows] = await db.execute<
      (RowDataPacket & { logo_data: Buffer | null; logo_mime_type: string | null })[]
    >(
      `SELECT logo_data, logo_mime_type
       FROM lead_brand_kits
       WHERE lead_id = ? AND logo_data IS NOT NULL
       LIMIT 1`,
      [leadId]
    );
    const row = rows[0];
    if (!row || !row.logo_data || !row.logo_mime_type) return null;
    return { buffer: row.logo_data, mimeType: row.logo_mime_type };
  } catch (err) {
    const msg = (err as Error).message || '';
    if (msg.includes("Table") && msg.includes("doesn't exist")) return null;
    throw err;
  }
}

/**
 * (#61 Inc 1) Latest brand kit for ANY of a customer's leads — used when we
 * need to brand an asset that isn't tied to one specific lead (line-born
 * commercials). Strategy: pick the most recently UPDATED kit among leads
 * owned by this client_id, on the theory that the freshest kit is the
 * customer's current logo/treatment. House lines (clientId=null) fall back
 * to the most recent kit across all operator leads — the brand's own logo.
 *
 * Returns null when there's no kit anywhere for the customer (UI surfaces
 * an honest message asking val to set one up). Fails soft on missing table.
 */
export async function getBrandKitForClient(
  clientId: number | null,
  options: { includeDataUrl?: boolean } = {}
): Promise<BrandKitRecord | null> {
  const db = getAvDb();
  try {
    const where = clientId && clientId > 0 ? 'l.client_id = ?' : 'l.client_id IS NULL';
    const params: unknown[] = clientId && clientId > 0 ? [clientId] : [];
    const [rows] = await db.execute<BrandKitRow[]>(
      `SELECT bk.id, bk.lead_id, bk.logo_data, bk.logo_mime_type, bk.logo_filename,
              bk.logo_width, bk.logo_height, bk.default_position, bk.default_opacity,
              bk.default_scale, bk.default_padding, bk.auto_apply, bk.created_at,
              bk.updated_at, bk.created_by_user_id
         FROM lead_brand_kits bk
         JOIN leads l ON l.id = bk.lead_id
        WHERE ${where}
          AND bk.logo_data IS NOT NULL
        ORDER BY bk.updated_at DESC
        LIMIT 1`,
      params
    );
    return rows[0] ? rowToRecord(rows[0], !!options.includeDataUrl) : null;
  } catch (err) {
    const msg = (err as Error).message || '';
    if (msg.includes("Table") && msg.includes("doesn't exist")) return null;
    throw err;
  }
}

/** Same as getBrandKitForClient but returns just the logo bytes — used in
 *  hot paths (video compositor) that don't need the rest of the record. */
export async function getBrandKitLogoBufferForClient(
  clientId: number | null
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  const db = getAvDb();
  try {
    const where = clientId && clientId > 0 ? 'l.client_id = ?' : 'l.client_id IS NULL';
    const params: unknown[] = clientId && clientId > 0 ? [clientId] : [];
    const [rows] = await db.execute<
      (RowDataPacket & { logo_data: Buffer | null; logo_mime_type: string | null })[]
    >(
      `SELECT bk.logo_data, bk.logo_mime_type
         FROM lead_brand_kits bk
         JOIN leads l ON l.id = bk.lead_id
        WHERE ${where}
          AND bk.logo_data IS NOT NULL
        ORDER BY bk.updated_at DESC
        LIMIT 1`,
      params
    );
    const row = rows[0];
    if (!row || !row.logo_data || !row.logo_mime_type) return null;
    return { buffer: row.logo_data, mimeType: row.logo_mime_type };
  } catch (err) {
    const msg = (err as Error).message || '';
    if (msg.includes("Table") && msg.includes("doesn't exist")) return null;
    throw err;
  }
}

/**
 * Create or update the brand kit for a lead. Idempotent on lead_id.
 * Only fields explicitly set in input are written; nulls are kept where
 * the caller did not provide a value.
 */
export async function upsertBrandKit(input: BrandKitUpsertInput): Promise<BrandKitRecord> {
  const db = getAvDb();
  // Pull existing row (if any) to merge with the input.
  const existing = await getBrandKitForLead(input.leadId);

  const merged = {
    logoBuffer: input.logoBuffer ?? null,
    logoMimeType: input.logoMimeType ?? existing?.logoMimeType ?? null,
    logoFilename: input.logoFilename ?? existing?.logoFilename ?? null,
    logoWidth: input.logoWidth ?? existing?.logoWidth ?? null,
    logoHeight: input.logoHeight ?? existing?.logoHeight ?? null,
    defaultPosition: input.defaultPosition ?? existing?.defaultPosition ?? 'bottom-right',
    defaultOpacity: input.defaultOpacity ?? existing?.defaultOpacity ?? 1.0,
    defaultScale: input.defaultScale ?? existing?.defaultScale ?? 0.15,
    defaultPadding: input.defaultPadding ?? existing?.defaultPadding ?? 24,
    autoApply: input.autoApply ?? existing?.autoApply ?? true
  };

  if (existing) {
    // UPDATE: include logo_data only if the caller passed a fresh buffer.
    if (merged.logoBuffer) {
      await db.execute<ResultSetHeader>(
        `UPDATE lead_brand_kits
         SET logo_data = ?, logo_mime_type = ?, logo_filename = ?, logo_width = ?, logo_height = ?,
             default_position = ?, default_opacity = ?, default_scale = ?, default_padding = ?,
             auto_apply = ?
         WHERE lead_id = ?`,
        [
          merged.logoBuffer,
          merged.logoMimeType,
          merged.logoFilename,
          merged.logoWidth,
          merged.logoHeight,
          merged.defaultPosition,
          merged.defaultOpacity,
          merged.defaultScale,
          merged.defaultPadding,
          merged.autoApply ? 1 : 0,
          input.leadId
        ]
      );
    } else {
      await db.execute<ResultSetHeader>(
        `UPDATE lead_brand_kits
         SET default_position = ?, default_opacity = ?, default_scale = ?, default_padding = ?,
             auto_apply = ?
         WHERE lead_id = ?`,
        [
          merged.defaultPosition,
          merged.defaultOpacity,
          merged.defaultScale,
          merged.defaultPadding,
          merged.autoApply ? 1 : 0,
          input.leadId
        ]
      );
    }
  } else {
    // INSERT
    await db.execute<ResultSetHeader>(
      `INSERT INTO lead_brand_kits
         (lead_id, logo_data, logo_mime_type, logo_filename, logo_width, logo_height,
          default_position, default_opacity, default_scale, default_padding,
          auto_apply, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.leadId,
        merged.logoBuffer,
        merged.logoMimeType,
        merged.logoFilename,
        merged.logoWidth,
        merged.logoHeight,
        merged.defaultPosition,
        merged.defaultOpacity,
        merged.defaultScale,
        merged.defaultPadding,
        merged.autoApply ? 1 : 0,
        input.createdByUserId ?? null
      ]
    );
  }

  const after = await getBrandKitForLead(input.leadId);
  if (!after) throw new Error('failed to read back brand kit after upsert');
  return after;
}

/** Remove the logo bytes only -- keeps the settings row. */
export async function clearBrandKitLogo(leadId: number): Promise<void> {
  const db = getAvDb();
  await db.execute<ResultSetHeader>(
    `UPDATE lead_brand_kits
     SET logo_data = NULL, logo_mime_type = NULL, logo_filename = NULL,
         logo_width = NULL, logo_height = NULL
     WHERE lead_id = ?`,
    [leadId]
  );
}
