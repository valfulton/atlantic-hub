/**
 * lib/brand_kit/compositor.ts
 *
 * Image compositor: takes a source asset URL + the lead's brand kit
 * (logo bytes + position + scale + opacity + padding) and returns a
 * fresh PNG/JPEG buffer with the logo overlaid in the chosen corner.
 *
 * Uses `sharp` -- listed as a dependency in package.json. On Netlify
 * Functions sharp ships native binaries via @netlify/plugin-nextjs.
 *
 * Phase 1: IMAGES ONLY. Video composite via ffmpeg lands in Phase 2.
 *
 * Public entry: composeBrandedImage(sourceUrl, kit) -> { buffer, mime }
 */
// sharp is listed in package.json. We lazy-load it at call time so TS
// build in environments without node_modules populated (e.g. CI lint
// before npm install) doesn't fail. Netlify always runs npm install
// before next build.
async function loadSharp() {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore -- resolved at runtime
  const mod = await import('sharp');
  return mod.default;
}
import type { BrandKitRecord, LogoPosition } from '@/lib/brand_kit/types';
import { getBrandKitLogoBuffer } from '@/lib/brand_kit/store';

export interface ComposeImageInput {
  /** URL of the source asset returned by the AI engine. Must be publicly fetchable. */
  sourceUrl: string;
  /** Brand kit record (settings come from here). */
  kit: BrandKitRecord;
}

export interface ComposeImageResult {
  buffer: Buffer;
  mimeType: string;
  width: number;
  height: number;
  durationMs: number;
}

const POSITION_TO_GRAVITY: Record<LogoPosition, 'northwest' | 'northeast' | 'southwest' | 'southeast'> = {
  'top-left': 'northwest',
  'top-right': 'northeast',
  'bottom-left': 'southwest',
  'bottom-right': 'southeast'
};

/**
 * Fetch + composite. Streams the source asset over the network once,
 * does the work in-memory, returns a Buffer.
 */
export async function composeBrandedImage(input: ComposeImageInput): Promise<ComposeImageResult> {
  const startMs = Date.now();
  const { sourceUrl, kit } = input;

  if (!kit.hasLogo) {
    throw new Error('brand kit has no logo bytes to composite');
  }

  const logoRecord = await getBrandKitLogoBuffer(kit.leadId);
  if (!logoRecord) throw new Error('brand kit logo bytes vanished between read and composite');

  const sourceResponse = await fetch(sourceUrl);
  if (!sourceResponse.ok) {
    throw new Error(`source asset fetch failed: HTTP ${sourceResponse.status}`);
  }
  const sourceArrayBuffer = await sourceResponse.arrayBuffer();

  const sharp = await loadSharp();
  const base = sharp(Buffer.from(sourceArrayBuffer));
  const baseMeta = await base.metadata();
  const baseWidth = baseMeta.width ?? 1024;
  const baseHeight = baseMeta.height ?? 1024;

  // Resize the logo to the target scale fraction of the base width.
  const targetLogoWidth = Math.max(16, Math.round(baseWidth * kit.defaultScale));
  // Convert opacity (0-1) to sharp ensureAlpha + linear multiply.
  const logoPipeline = sharp(logoRecord.buffer)
    .resize({ width: targetLogoWidth, withoutEnlargement: false })
    .ensureAlpha();
  // Apply opacity by scaling the alpha channel. linear() multiplies pixel
  // values; the easier path: use composite blend 'over' with a tinted PNG.
  let logoBuffer: Buffer;
  if (kit.defaultOpacity < 1) {
    const alphaPct = Math.round(Math.max(0, Math.min(1, kit.defaultOpacity)) * 255);
    const meta = await logoPipeline.clone().metadata();
    const w = meta.width ?? targetLogoWidth;
    const h = meta.height ?? targetLogoWidth;
    // Build a translucent overlay by replacing the alpha channel.
    const rgbaBuffer = await logoPipeline.raw().toBuffer({ resolveWithObject: false });
    // raw() returns interleaved RGBA when alpha is present. Multiply alpha bytes.
    const out = Buffer.from(rgbaBuffer);
    for (let i = 3; i < out.length; i += 4) {
      out[i] = Math.round((out[i] * alphaPct) / 255);
    }
    logoBuffer = await sharp(out, { raw: { width: w, height: h, channels: 4 } })
      .png()
      .toBuffer();
  } else {
    logoBuffer = await logoPipeline.png().toBuffer();
  }

  const gravity = POSITION_TO_GRAVITY[kit.defaultPosition];

  // sharp's composite gravity already snaps to the corner; padding moves
  // the logo inward. Build it as { top, left } so we have exact control.
  const logoMeta = await sharp(logoBuffer).metadata();
  const lw = logoMeta.width ?? targetLogoWidth;
  const lh = logoMeta.height ?? targetLogoWidth;
  const pad = Math.max(0, kit.defaultPadding);

  let top: number;
  let left: number;
  switch (gravity) {
    case 'northwest':
      top = pad;
      left = pad;
      break;
    case 'northeast':
      top = pad;
      left = baseWidth - lw - pad;
      break;
    case 'southwest':
      top = baseHeight - lh - pad;
      left = pad;
      break;
    case 'southeast':
    default:
      top = baseHeight - lh - pad;
      left = baseWidth - lw - pad;
      break;
  }

  // Detect output format. PNG preserves logo edges cleanly when source is PNG;
  // JPEG sources stay JPEG to keep file size sane.
  const isJpegSource = (baseMeta.format ?? '').toLowerCase().includes('jpeg') ||
                       (baseMeta.format ?? '').toLowerCase().includes('jpg');
  const outputPipeline = base.composite([{ input: logoBuffer, top, left, blend: 'over' }]);
  const finalBuffer = isJpegSource
    ? await outputPipeline.jpeg({ quality: 92 }).toBuffer()
    : await outputPipeline.png().toBuffer();

  return {
    buffer: finalBuffer,
    mimeType: isJpegSource ? 'image/jpeg' : 'image/png',
    width: baseWidth,
    height: baseHeight,
    durationMs: Date.now() - startMs
  };
}
