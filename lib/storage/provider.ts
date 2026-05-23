/**
 * lib/storage/provider.ts
 *
 * Swappable storage abstraction for the creative provenance layer. Two concerns,
 * deliberately separated so each can change independently:
 *
 *   HotStorage        durable, fast, cheap. Serves bytes to the app. Today:
 *                     Netlify Blobs. Swappable for S3/R2 later with zero callers
 *                     changing.
 *   PermanenceProvider  pay-once-forever archival for KEEPER assets. Today: a
 *                     no-op (returns null). Phase 2: Arweave via Irys/Bundlr.
 *                     When wired, nothing else changes -- callers just start
 *                     getting a permanent_uri back.
 *
 * This is the seam the whole "AI-native creative OS" storage strategy hangs on:
 * hot vs permanent are providers, not hardcoded vendors.
 */

// ---------------------------------------------------------------------------
// Hot storage
// ---------------------------------------------------------------------------

export interface HotStorage {
  /** Store bytes under a key. Returns the key (callers build a serve URL). */
  put(key: string, bytes: Buffer | Uint8Array, contentType: string): Promise<string>;
  /** Read bytes back, or null if missing. */
  getBytes(key: string): Promise<Uint8Array | null>;
  /** Whether a key exists (cheap-ish; falls back to a get). */
  has(key: string): Promise<boolean>;
}

class NetlifyBlobsHot implements HotStorage {
  constructor(private storeName: string) {}

  private async store() {
    // Lazy import so a typecheck without node_modules doesn't require the pkg;
    // Netlify installs @netlify/blobs from package.json before build.
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore -- resolved at runtime on Netlify
    const mod = await import('@netlify/blobs');
    return mod.getStore(this.storeName);
  }

  async put(key: string, bytes: Buffer | Uint8Array, contentType: string): Promise<string> {
    const s = await this.store();
    const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    await s.set(key, ab, { metadata: { contentType } });
    return key;
  }

  async getBytes(key: string): Promise<Uint8Array | null> {
    const s = await this.store();
    const data = (await s.get(key, { type: 'arrayBuffer' })) as ArrayBuffer | null;
    return data ? new Uint8Array(data) : null;
  }

  async has(key: string): Promise<boolean> {
    return (await this.getBytes(key)) != null;
  }
}

/** The active hot-storage provider. Store name defaults to 'creative-assets'. */
export function getHotStorage(storeName = 'creative-assets'): HotStorage {
  return new NetlifyBlobsHot(storeName);
}

// ---------------------------------------------------------------------------
// Permanence (Phase 2: Arweave via Irys/Bundlr)
// ---------------------------------------------------------------------------

export interface PermanenceResult {
  /** e.g. ar://<txid> or https://arweave.net/<txid> */
  uri: string;
  provider: string;
}

export interface PermanenceProvider {
  /** Whether this provider can archive right now (configured + funded). */
  available(): boolean;
  /** Permanently archive bytes. Returns the permanent URI. */
  archive(bytes: Buffer | Uint8Array, contentType: string, meta: Record<string, string>): Promise<PermanenceResult>;
}

/**
 * No-op until Arweave/Irys is wired. `available()` is false, so the keeper
 * workflow records the intent (is_keeper=1) without failing. Phase 2 swaps this
 * for an IrysPermanence that uploads + returns ar://<txid>.
 */
class NoopPermanence implements PermanenceProvider {
  available(): boolean {
    return false;
  }
  async archive(): Promise<PermanenceResult> {
    throw new Error('permanence provider not configured (Phase 2: Arweave/Irys)');
  }
}

export function getPermanence(): PermanenceProvider {
  // Phase 2: if (process.env.IRYS_PRIVATE_KEY) return new IrysPermanence();
  return new NoopPermanence();
}
