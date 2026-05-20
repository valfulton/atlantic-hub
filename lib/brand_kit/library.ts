/**
 * lib/brand_kit/library.ts
 *
 * Reusable logo library shared across leads. The operator uploads a
 * logo once with a friendly name (e.g. "Atlantic & Vine wordmark"),
 * then applies it to any lead's brand kit in one click. Each apply
 * bumps use_count + last_used_at so the most-used logos float to the
 * top of the picker.
 *
 * Apply = copy the library row's bytes + default settings into
 * lead_brand_kits via the existing upsertBrandKit() path.
 *
 * Phase 2 ideas (out of scope today): tenant-scoped ACLs, auto-suggest
 * the right logo based on the lead's target_business field, optional
 * gpt-4o-mini classifier that picks a logo from text cues.
 */

import { getAvDb } from '@/lib/db/av';
import { upsertBrandKit } from '@/lib/brand_kit/store';
import type { LogoPosition, BrandKitRecord } from '@/lib/brand_kit/types';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';

export interface LogoLibraryItem {
  id: number;
  displayName: string;
  tenantHint: string | null;
  hasLogo: true; // by definition -- rows without bytes don't exist
  logoMimeType: string;
  logoFilename: string | null;
  logoWidth: number | null;
  logoHeight: number | null;
  /** Data URL of the logo for thumbnail rendering. */
  logoDataUrl: string;
  defaultPosition: LogoPosition;
  defaultOpacity: number;
  defaultScale: number;
  defaultPadding: number;
  useCount: number;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface LibraryRow extends RowDataPacket {
  id: number;
  display_name: string;
  tenant_hint: string | null;
  logo_data: Buffer;
  logo_mime_type: string;
  logo_filename: string | null;
  logo_width: number | null;
  logo_height: number | null;
  default_position: LogoPosition;
  default_opacity: string | number;
  default_scale: string | number;
  default_padding: number;
  use_count: number;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

function rowToItem(row: LibraryRow): LogoLibraryItem {
  return {
    id: row.id,
    displayName: row.display_name,
    tenantHint: row.tenant_hint,
    hasLogo: true,
    logoMimeType: row.logo_mime_type,
    logoFilename: row.logo_filename,
    logoWidth: row.logo_width,
    logoHeight: row.logo_height,
    logoDataUrl: `data:${row.logo_mime_type};base64,${row.logo_data.toString('base64')}`,
    defaultPosition: row.default_position,
    defaultOpacity: Number(row.default_opacity),
    defaultScale: Number(row.default_scale),
    defaultPadding: row.default_padding,
    useCount: row.use_count,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/**
 * List active library logos, most-recently-used first (NULLS last). If
 * tenantHint is provided, items tagged with that hint sort above
 * untagged. The library tops out at 50 items by default.
 */
export async function listLibrary(opts: { limit?: number; tenantHint?: string | null } = {}): Promise<LogoLibraryItem[]> {
  const db = getAvDb();
  const limit = Math.max(1, Math.min(200, opts.limit ?? 50));
  try {
    if (opts.tenantHint) {
      const [rows] = await db.execute<LibraryRow[]>(
        `SELECT id, display_name, tenant_hint, logo_data, logo_mime_type, logo_filename,
                logo_width, logo_height, default_position, default_opacity, default_scale,
                default_padding, use_count, last_used_at, created_at, updated_at, archived_at
         FROM operator_logo_library
         WHERE archived_at IS NULL
         ORDER BY
           (tenant_hint = ?) DESC,
           CASE WHEN last_used_at IS NULL THEN 1 ELSE 0 END,
           last_used_at DESC,
           use_count DESC,
           created_at DESC
         LIMIT ?`,
        [opts.tenantHint, limit]
      );
      return rows.map(rowToItem);
    }
    const [rows] = await db.execute<LibraryRow[]>(
      `SELECT id, display_name, tenant_hint, logo_data, logo_mime_type, logo_filename,
              logo_width, logo_height, default_position, default_opacity, default_scale,
              default_padding, use_count, last_used_at, created_at, updated_at, archived_at
       FROM operator_logo_library
       WHERE archived_at IS NULL
       ORDER BY
         CASE WHEN last_used_at IS NULL THEN 1 ELSE 0 END,
         last_used_at DESC,
         use_count DESC,
         created_at DESC
       LIMIT ?`,
      [limit]
    );
    return rows.map(rowToItem);
  } catch (err) {
    const msg = (err as Error).message || '';
    if (msg.includes("Table") && msg.includes("doesn't exist")) return [];
    throw err;
  }
}

export interface AddToLibraryArgs {
  displayName: string;
  tenantHint?: string | null;
  logoBuffer: Buffer;
  logoMimeType: string;
  logoFilename?: string | null;
  logoWidth?: number | null;
  logoHeight?: number | null;
  defaultPosition?: LogoPosition;
  defaultOpacity?: number;
  defaultScale?: number;
  defaultPadding?: number;
  createdByUserId?: number | null;
}

export async function addToLibrary(args: AddToLibraryArgs): Promise<LogoLibraryItem> {
  const db = getAvDb();
  const [ins] = await db.execute<ResultSetHeader>(
    `INSERT INTO operator_logo_library
       (display_name, tenant_hint, logo_data, logo_mime_type, logo_filename,
        logo_width, logo_height, default_position, default_opacity, default_scale,
        default_padding, created_by_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      args.displayName,
      args.tenantHint ?? null,
      args.logoBuffer,
      args.logoMimeType,
      args.logoFilename ?? null,
      args.logoWidth ?? null,
      args.logoHeight ?? null,
      args.defaultPosition ?? 'bottom-right',
      args.defaultOpacity ?? 1.0,
      args.defaultScale ?? 0.15,
      args.defaultPadding ?? 24,
      args.createdByUserId ?? null
    ]
  );
  const items = await listLibrary({ limit: 1 });
  const created = items.find((i) => i.id === ins.insertId);
  if (!created) {
    // Fall back to a one-row fetch in case listLibrary's recency sort
    // pushes this one out (shouldn't happen since we just inserted).
    return (await listLibrary({ limit: 100 })).find((i) => i.id === ins.insertId)!;
  }
  return created;
}

/** Soft delete -- keeps audit trail but hides from the picker. */
export async function archiveLibraryItem(id: number): Promise<void> {
  const db = getAvDb();
  await db.execute<ResultSetHeader>(
    `UPDATE operator_logo_library SET archived_at = NOW() WHERE id = ?`,
    [id]
  );
}

/**
 * Apply a library item to a lead's brand kit. Copies the bytes +
 * default settings into lead_brand_kits, bumps use_count + last_used_at.
 * Returns the resulting brand kit so the UI can refresh.
 */
export async function applyLibraryItemToLead(args: {
  libraryItemId: number;
  leadId: number;
  actorUserId: number | null;
}): Promise<BrandKitRecord> {
  const db = getAvDb();
  // Load the library row's bytes + settings.
  const [rows] = await db.execute<LibraryRow[]>(
    `SELECT id, display_name, tenant_hint, logo_data, logo_mime_type, logo_filename,
            logo_width, logo_height, default_position, default_opacity, default_scale,
            default_padding, use_count, last_used_at, created_at, updated_at, archived_at
     FROM operator_logo_library
     WHERE id = ? AND archived_at IS NULL LIMIT 1`,
    [args.libraryItemId]
  );
  const row = rows[0];
  if (!row) throw new Error(`library item ${args.libraryItemId} not found or archived`);

  const kit = await upsertBrandKit({
    leadId: args.leadId,
    logoBuffer: row.logo_data,
    logoMimeType: row.logo_mime_type,
    logoFilename: row.logo_filename ?? undefined,
    logoWidth: row.logo_width ?? undefined,
    logoHeight: row.logo_height ?? undefined,
    defaultPosition: row.default_position,
    defaultOpacity: Number(row.default_opacity),
    defaultScale: Number(row.default_scale),
    defaultPadding: row.default_padding,
    autoApply: true,
    createdByUserId: args.actorUserId
  });

  // Bump recency + count -- fire and forget for snappy UI.
  await db.execute<ResultSetHeader>(
    `UPDATE operator_logo_library
     SET use_count = use_count + 1, last_used_at = NOW()
     WHERE id = ?`,
    [args.libraryItemId]
  );

  return kit;
}
