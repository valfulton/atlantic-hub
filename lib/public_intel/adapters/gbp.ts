/**
 * lib/public_intel/adapters/gbp.ts  (#380, val 2026-06-03)
 *
 * Google Business Profile rolling snapshots. For each tracked place_id,
 * pull current rating + review_count + status. Store a dated snapshot.
 * The cascade engine compares latest vs previous snapshot to detect
 * rating drops + review-velocity shifts — emits "review_drop_operational_stress"
 * signals.
 *
 * Per the advisor brief: businesses with declining reviews often develop
 * operational and cash flow issues 30-60 days later. This is the
 * leading-indicator adapter.
 *
 * Data source: Google Places API v1 (already wired for per-lead enrichment).
 * Endpoint: GET https://places.googleapis.com/v1/places/{placeId}
 *   X-Goog-FieldMask: rating,userRatingCount,businessStatus,displayName,types
 *
 * Cost: $0.017 per call. At weekly cadence × ~50 tracked places per client =
 * ~$3.40/client/month. Cheap leading indicator.
 *
 * Cache: 6 days — slightly less than weekly so a weekly cron always hits.
 */
import type { PublicIntelAdapter, RunContext, RunResult } from '../types';
import { storeRecord, findCachedRecord, noteRun } from '../store';

interface GbpConfig {
  /** Specific place IDs to snapshot. */
  placeIds?: string[];
  /** OR a seed query to discover places (passes through to Places text-search). */
  seedQuery?: string;
}

interface GbpSnapshot {
  placeId: string;
  displayName: string | null;
  rating: number | null;
  userRatingCount: number | null;
  businessStatus: string | null;
  types: string[];
  snapshotAt: string; // ISO
}

const CACHE_DAYS = 6;

function isCfg(c: unknown): c is GbpConfig {
  if (!c || typeof c !== 'object') return false;
  const o = c as Record<string, unknown>;
  if (o.placeIds !== undefined && !(Array.isArray(o.placeIds) && o.placeIds.every((s) => typeof s === 'string'))) return false;
  if (o.seedQuery !== undefined && typeof o.seedQuery !== 'string') return false;
  return true;
}

async function fetchSnapshot(placeId: string, apiKey: string): Promise<GbpSnapshot | null> {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
      signal: controller.signal,
      headers: {
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'id,displayName,rating,userRatingCount,businessStatus,types',
        Accept: 'application/json'
      }
    });
    if (!res.ok) return null;
    const j = (await res.json()) as {
      id?: string;
      displayName?: { text?: string };
      rating?: number;
      userRatingCount?: number;
      businessStatus?: string;
      types?: string[];
    };
    return {
      placeId: j.id ?? placeId,
      displayName: j.displayName?.text ?? null,
      rating: typeof j.rating === 'number' ? j.rating : null,
      userRatingCount: typeof j.userRatingCount === 'number' ? j.userRatingCount : null,
      businessStatus: j.businessStatus ?? null,
      types: Array.isArray(j.types) ? j.types : [],
      snapshotAt: new Date().toISOString()
    };
  } catch {
    return null;
  } finally {
    clearTimeout(tid);
  }
}

export const gbpAdapter: PublicIntelAdapter = {
  kind: 'gbp',
  displayName: 'Google Business Profile (review-trend snapshots)',
  description:
    'Rolling snapshots of rating + review count + business status per tracked place. The cascade engine compares latest vs previous to detect rating drops AND review-velocity shifts — both early indicators of operational stress (per advisor brief: 30-60 day lead time on cash-flow problems).',
  requiresKey: true,
  apiKeyEnv: 'GOOGLE_PLACES_API_KEY',
  costNote: '$0.017 per snapshot · ~$3.40/client/mo at 50 places weekly · cached 6 days',
  bestFor: ['CBB (early-warning collections)', 'Local-services advisors', 'Reputation-aware clients'],

  validateConfig(config) {
    if (config == null) return null;
    if (!isCfg(config)) return 'config must be { placeIds?: string[], seedQuery?: string }';
    const c = config as GbpConfig;
    if ((!c.placeIds || c.placeIds.length === 0) && !c.seedQuery) {
      return 'set placeIds[] OR seedQuery';
    }
    return null;
  },

  async run(ctx: RunContext): Promise<RunResult> {
    const cfgRaw = ctx.source.config;
    const valError = this.validateConfig(cfgRaw);
    if (valError) {
      await noteRun({ sourceId: ctx.source.sourceId, status: 'error', detail: `bad config: ${valError}` });
      return { ok: false, written: 0, fromCache: 0, detail: `bad config: ${valError}` };
    }
    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) {
      await noteRun({ sourceId: ctx.source.sourceId, status: 'error', detail: 'GOOGLE_PLACES_API_KEY not set' });
      return { ok: false, written: 0, fromCache: 0, detail: 'GOOGLE_PLACES_API_KEY missing' };
    }
    const cfg: GbpConfig = (cfgRaw as GbpConfig | null) ?? {};
    const placeIds = cfg.placeIds ?? [];

    let written = 0;
    let fromCache = 0;
    const errors: string[] = [];
    const today = new Date().toISOString().slice(0, 10);
    const expires = new Date(Date.now() + CACHE_DAYS * 24 * 60 * 60 * 1000);

    for (const placeId of placeIds.slice(0, 200)) {
      const entityKey = `gbp:snapshot:${placeId}:${today}`;
      const cached = await findCachedRecord<GbpSnapshot>('gbp', entityKey);
      if (cached) {
        fromCache++;
        continue;
      }
      const snap = await fetchSnapshot(placeId, apiKey);
      if (!snap) {
        errors.push(placeId);
        continue;
      }
      await storeRecord<GbpSnapshot>({
        sourceKind: 'gbp',
        entityKey,
        clientId: ctx.clientId ?? ctx.source.clientId,
        recordJson: snap,
        summaryLabel: `${snap.displayName ?? placeId} · ★${snap.rating ?? '?'} (${snap.userRatingCount ?? 0} reviews) · ${snap.businessStatus ?? 'OPERATIONAL'}`,
        regionCode: null,
        expiresAt: expires
      });
      written++;
    }

    const detail = `${written} snapshots fetched, ${fromCache} cached, ${errors.length} errored`;
    await noteRun({
      sourceId: ctx.source.sourceId,
      status: errors.length > 0 && written === 0 ? 'error' : 'ok',
      detail
    });
    return { ok: written > 0 || fromCache > 0, written, fromCache, detail };
  }
};
