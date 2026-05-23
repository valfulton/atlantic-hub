/**
 * lib/storage/branded_blobs.ts
 *
 * Stores rendered branded videos in Netlify Blobs (free, built into the Netlify
 * runtime -- no S3 account, matching val's "no SaaS until justified" rule). On
 * deployed Netlify, getStore() picks up site context automatically.
 *
 * Keys look like `branded/<assetId>.mp4`. The serve route streams them back.
 */
// Lazy-load so a typecheck/CI without node_modules doesn't require the package;
// Netlify installs @netlify/blobs from package.json before build.
async function store() {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore -- resolved at runtime on Netlify
  const mod = await import('@netlify/blobs');
  return mod.getStore(STORE_NAME);
}

const STORE_NAME = 'branded-videos';

export function brandedVideoKey(assetId: number): string {
  return `branded/${assetId}.mp4`;
}

export async function putBrandedVideo(key: string, data: Buffer): Promise<void> {
  const s = await store();
  // Netlify Blobs accepts ArrayBuffer; hand it a clean slice of the Buffer.
  const ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  await s.set(key, ab, { metadata: { contentType: 'video/mp4' } });
}

export async function getBrandedVideo(key: string): Promise<Uint8Array | null> {
  const s = await store();
  const data = (await s.get(key, { type: 'arrayBuffer' })) as ArrayBuffer | null;
  return data ? new Uint8Array(data) : null;
}
