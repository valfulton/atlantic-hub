/**
 * POST /api/admin/av/clients/[client_id]/sharpen-icp  (#239)
 *
 * Two modes:
 *   - 'preview' -> read brief, run LLM, return suggested ICP. No DB writes.
 *   - 'apply'   -> caller sends the (possibly operator-edited) suggestions
 *                  back; we persist via saveClientIcp with provenance
 *                  'ai_intake' so the IcpEditor chips render distinctly.
 *
 * Apply mode supports `mergeMode`:
 *   - 'fill_blanks' (default): only set fields the current ICP doesn't have
 *     values for. Val's hand-curated values are never touched.
 *   - 'replace': overwrite everything with the suggestions (used when val
 *     hits "Replace with these" intentionally).
 *
 * Owner / staff only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { getAvDb } from '@/lib/db/av';
import { getClientIcp, saveClientIcp, type IcpItemSource, type IcpProvenance, type ClientIcp } from '@/lib/client/icp';
import { sharpenIcpFromBrief } from '@/lib/client/icp_sharpener';
import { maybeRescoreAfterIcpChange } from '@/lib/client/autopilot';
import { logEvent } from '@/lib/events/log';
import type { RowDataPacket } from 'mysql2';

export const runtime = 'nodejs';
export const maxDuration = 30;

interface PreviewBody { mode: 'preview' }
interface ApplyBody {
  mode: 'apply';
  industries: string[];
  geographies: string[];
  excludedIndustries: string[];
  companySizeMin: number | null;
  companySizeMax: number | null;
  mergeMode?: 'fill_blanks' | 'replace';
}

async function loadClientName(clientId: number): Promise<string> {
  try {
    const db = getAvDb();
    const [rows] = await db.execute<(RowDataPacket & { client_name: string | null })[]>(
      `SELECT client_name FROM clients WHERE client_id = ? LIMIT 1`,
      [clientId]
    );
    return rows[0]?.client_name?.trim() || `Client #${clientId}`;
  } catch {
    return `Client #${clientId}`;
  }
}

export async function POST(req: NextRequest, { params }: { params: { client_id: string } }) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/clients/[client_id]/sharpen-icp:POST',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const clientId = Number.parseInt(params.client_id, 10);
  if (!Number.isFinite(clientId) || clientId <= 0) {
    return NextResponse.json({ error: 'invalid client_id' }, { status: 400 });
  }

  let body: PreviewBody | ApplyBody;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }

  // -------- PREVIEW --------
  if (body.mode === 'preview') {
    const brandName = await loadClientName(clientId);
    const result = await sharpenIcpFromBrief({ clientId, brandName });
    if (!result) {
      return NextResponse.json({
        error: 'no_signal',
        detail: 'No brief or intake content to read for this client yet. Fill their intake first.'
      }, { status: 422 });
    }
    const current = await getClientIcp(clientId);
    return NextResponse.json({
      ok: true,
      ...result,
      currentSnapshot: {
        industries: current.industries,
        geographies: current.geographies,
        excludedIndustries: current.excludedIndustries,
        companySizeMin: current.companySizeMin,
        companySizeMax: current.companySizeMax
      }
    });
  }

  // -------- APPLY --------
  if (body.mode === 'apply') {
    const merge: 'fill_blanks' | 'replace' = body.mergeMode === 'replace' ? 'replace' : 'fill_blanks';
    try {
      const current = await getClientIcp(clientId);

      // Strings come in as plain arrays; the persisted shape uses
      // Record<string, IcpItemSource>. Build the next maps so existing
      // provenance is preserved and new AI-sourced items are tagged.
      const buildMap = (
        suggested: string[],
        existing: string[]
      ): string[] => {
        if (merge === 'replace') return Array.from(new Set(suggested));
        if (existing.length > 0) return existing; // fill_blanks: leave it alone
        return Array.from(new Set(suggested));
      };

      const nextIndustries  = buildMap(body.industries || [],         current.industries);
      const nextGeographies = buildMap(body.geographies || [],        current.geographies);
      const nextExcluded    = buildMap(body.excludedIndustries || [], current.excludedIndustries);

      const writtenIndustries  = nextIndustries.filter(  (v) => !current.industries.includes(v));
      const writtenGeographies = nextGeographies.filter( (v) => !current.geographies.includes(v));
      const writtenExcluded    = nextExcluded.filter(    (v) => !current.excludedIndustries.includes(v));

      const nextMin = merge === 'replace'
        ? (body.companySizeMin ?? null)
        : (current.companySizeMin ?? body.companySizeMin ?? null);
      const nextMax = merge === 'replace'
        ? (body.companySizeMax ?? null)
        : (current.companySizeMax ?? body.companySizeMax ?? null);

      // Build the ClientIcp the writer expects. The icp.ts ClientIcp type uses
      // string[] for the value lists -- provenance is a parallel structure.
      const nextIcp: ClientIcp = {
        industries: nextIndustries,
        geographies: nextGeographies,
        excludeGeographies: [], // sharpener doesn't suggest these
        excludedIndustries: nextExcluded,
        // (#252) Sharpener never touches operator-curated title preferences.
        preferredContactTitles: current.preferredContactTitles,
        excludedContactTitles: current.excludedContactTitles,
        description: current.description,
        companySizeMin: nextMin,
        companySizeMax: nextMax
      };

      // Provenance: per-item authorship. Newly-written items tagged 'ai_intake'.
      const tagSource = (list: string[], writtenSet: Set<string>, existingMap: Record<string, IcpItemSource>): Record<string, IcpItemSource> => {
        const out: Record<string, IcpItemSource> = {};
        for (const v of list) {
          if (writtenSet.has(v)) out[v] = 'ai_intake';
          else out[v] = existingMap[v] ?? 'operator';
        }
        return out;
      };

      // Get the existing per-item provenance from the DB to merge cleanly.
      const provExisting = await loadIcpProvenance(clientId);
      const provenance: IcpProvenance = {
        industries:        tagSource(nextIndustries,  new Set(writtenIndustries),  provExisting.industries),
        geographies:       tagSource(nextGeographies, new Set(writtenGeographies), provExisting.geographies),
        excludeGeographies: provExisting.excludeGeographies, // untouched
        excludedIndustries: tagSource(nextExcluded,   new Set(writtenExcluded),    provExisting.excludedIndustries),
        // (#252) Title preferences untouched by sharpener.
        preferredContactTitles: provExisting.preferredContactTitles,
        excludedContactTitles: provExisting.excludedContactTitles,
        description: provExisting.description
      };

      await saveClientIcp(clientId, nextIcp, guard.actor.userId, provenance);

      // (#314) Stale-reason fix: any fit scores already on this client's leads
      // were computed against the pre-sharpener ICP and are now stale (this
      // is exactly what burned Tim's gym leads — sharpener added gyms to ICP,
      // existing leads kept their old "industry not in target" reasoning).
      // Fire-and-forget invalidate + bulk rescore (limit 60 / 45s deadline).
      // Only fired when something was actually written — fill_blanks no-ops
      // get no rescore so we don't burn LLM credits for nothing.
      const anythingWritten =
        writtenIndustries.length > 0 ||
        writtenGeographies.length > 0 ||
        writtenExcluded.length > 0 ||
        nextMin !== current.companySizeMin ||
        nextMax !== current.companySizeMax;
      if (anythingWritten) {
        void maybeRescoreAfterIcpChange({ clientId });
      }

      await logEvent({
        eventType: 'icp.sharpen.applied',
        userId: guard.actor.userId,
        source: 'operator',
        status: 'success',
        payload: {
          client_id: clientId,
          merge_mode: merge,
          written_industries: writtenIndustries.length,
          written_geographies: writtenGeographies.length,
          written_excluded: writtenExcluded.length
        }
      });

      return NextResponse.json({
        ok: true,
        merge,
        writtenCounts: {
          industries: writtenIndustries.length,
          geographies: writtenGeographies.length,
          excludedIndustries: writtenExcluded.length,
          companySize: nextMin !== current.companySizeMin || nextMax !== current.companySizeMax
        }
      });
    } catch (err) {
      console.error('[sharpen-icp:apply]', (err as Error).message);
      return NextResponse.json(
        { error: 'apply failed', detail: (err as Error).message },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ error: 'invalid mode' }, { status: 400 });
}

/** Load the JSON provenance column directly so we can preserve per-item authorship. */
async function loadIcpProvenance(clientId: number): Promise<IcpProvenance> {
  const empty: IcpProvenance = {
    industries: {},
    geographies: {},
    excludeGeographies: {},
    excludedIndustries: {},
    preferredContactTitles: {},
    excludedContactTitles: {},
    description: null
  };
  try {
    const db = getAvDb();
    const [rows] = await db.execute<(RowDataPacket & { provenance: string | null })[]>(
      `SELECT provenance FROM client_icps WHERE client_id = ? LIMIT 1`,
      [clientId]
    );
    const raw = rows[0]?.provenance;
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Partial<IcpProvenance>;
    return {
      industries: parsed.industries || {},
      geographies: parsed.geographies || {},
      excludeGeographies: parsed.excludeGeographies || {},
      excludedIndustries: parsed.excludedIndustries || {},
      preferredContactTitles: parsed.preferredContactTitles || {},
      excludedContactTitles: parsed.excludedContactTitles || {},
      description: parsed.description ?? null
    };
  } catch {
    return empty;
  }
}
