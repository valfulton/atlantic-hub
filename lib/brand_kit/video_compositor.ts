/**
 * lib/brand_kit/video_compositor.ts
 *
 * Phase 2 video branding: burn the brand-kit logo onto a generated commercial
 * video with ffmpeg. Companion to compositor.ts (images via sharp).
 *
 * Uses the `ffmpeg-static` binary (no system ffmpeg needed). Works in /tmp,
 * which is writable on Netlify Functions. NOTE: video processing is heavier than
 * an image composite -- run this from a route with a generous duration, or a
 * background function for longer clips. Commercials are short (1-15s), so a
 * single overlay pass is quick.
 *
 * Logo sizing/placement mirrors the image compositor: scale = fraction of video
 * width, positioned in the chosen corner with padding, at the chosen opacity.
 */
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { LogoPosition } from '@/lib/brand_kit/types';

// ffmpeg-static's default export is the absolute path to the bundled binary.
// Lazy-require so a CI lint without node_modules doesn't choke (Netlify installs
// before build), matching the sharp lazy-load in compositor.ts.
async function ffmpegPath(): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore -- resolved at runtime
  const mod = await import('ffmpeg-static');
  const p = (mod.default ?? mod) as unknown as string;
  if (!p || typeof p !== 'string') throw new Error('ffmpeg-static binary path unavailable');
  return p;
}

function overlayXY(position: LogoPosition, pad: number): string {
  switch (position) {
    case 'top-left':
      return `${pad}:${pad}`;
    case 'top-right':
      return `W-w-${pad}:${pad}`;
    case 'bottom-left':
      return `${pad}:H-h-${pad}`;
    case 'bottom-right':
    default:
      return `W-w-${pad}:H-h-${pad}`;
  }
}

export interface ComposeVideoInput {
  /** Publicly fetchable source video URL (the generated commercial). */
  videoUrl: string;
  /** Raw logo bytes (PNG/JPG) from the brand kit. */
  logoBuffer: Buffer;
  logoMime: string;
  position: LogoPosition;
  /** Logo width as a fraction of the video width (0-1). */
  scale: number;
  /** 0-1. */
  opacity: number;
  /** Padding from the edge, in pixels. */
  paddingPx: number;
}

export interface ComposeVideoResult {
  buffer: Buffer;
  mimeType: 'video/mp4';
  durationMs: number;
}

/** Download a URL to a temp file. */
async function download(url: string, dest: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch source video ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(dest, buf);
}

export async function composeBrandedVideo(input: ComposeVideoInput): Promise<ComposeVideoResult> {
  const started = Date.now();
  const bin = await ffmpegPath();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'brandvid-'));
  const inPath = path.join(dir, 'in.mp4');
  const logoExt = input.logoMime.includes('png') ? 'png' : input.logoMime.includes('svg') ? 'png' : 'png';
  const logoPath = path.join(dir, `logo.${logoExt}`);
  const outPath = path.join(dir, 'out.mp4');

  try {
    await download(input.videoUrl, inPath);
    await fs.writeFile(logoPath, input.logoBuffer);

    const scale = Math.max(0.02, Math.min(0.6, input.scale || 0.18));
    const opacity = Math.max(0, Math.min(1, input.opacity ?? 1));
    const pad = Math.max(0, Math.round(input.paddingPx || 24));
    const xy = overlayXY(input.position, pad);

    // [1] logo -> rgba + opacity; scale2ref to a fraction of the video width;
    // overlay onto the video; re-encode to a broadly compatible mp4.
    const filter =
      `[1:v]format=rgba,colorchannelmixer=aa=${opacity}[lo];` +
      `[lo][0:v]scale2ref=w=main_w*${scale}:h=ow/mdar[lg][base];` +
      `[base][lg]overlay=${xy}:format=auto,format=yuv420p[out]`;

    const args = [
      '-y',
      '-i', inPath,
      '-i', logoPath,
      '-filter_complex', filter,
      '-map', '[out]',
      '-map', '0:a?',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'copy',
      '-movflags', '+faststart',
      outPath
    ];

    await new Promise<void>((resolve, reject) => {
      const proc = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      proc.stderr.on('data', (d) => { stderr += d.toString(); if (stderr.length > 8000) stderr = stderr.slice(-8000); });
      proc.on('error', reject);
      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-600)}`));
      });
    });

    const buffer = await fs.readFile(outPath);
    return { buffer, mimeType: 'video/mp4', durationMs: Date.now() - started };
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
