/**
 * lib/brand_kit/types.ts
 *
 * Shared types for the per-lead Brand Kit feature. The kit holds the
 * uploaded logo + composite settings; the compositor uses them to
 * overlay the logo onto Grok Imagine assets on download / publish.
 *
 * Phase 1 (this build): images via `sharp`.
 * Phase 2 (next session): videos via `ffmpeg-static`.
 */

export type LogoPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export interface BrandKitRecord {
  id: number;
  leadId: number;
  hasLogo: boolean;
  logoMimeType: string | null;
  logoFilename: string | null;
  logoWidth: number | null;
  logoHeight: number | null;
  /** Data URL of the logo if hasLogo. Used by the preview UI. */
  logoDataUrl?: string;
  defaultPosition: LogoPosition;
  defaultOpacity: number;   // 0-1
  defaultScale: number;     // 0-1, logo width as fraction of base frame width
  defaultPadding: number;   // px
  autoApply: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BrandKitUpsertInput {
  leadId: number;
  logoBuffer?: Buffer;
  logoMimeType?: string;
  logoFilename?: string;
  logoWidth?: number;
  logoHeight?: number;
  defaultPosition?: LogoPosition;
  defaultOpacity?: number;
  defaultScale?: number;
  defaultPadding?: number;
  autoApply?: boolean;
  createdByUserId?: number | null;
}
