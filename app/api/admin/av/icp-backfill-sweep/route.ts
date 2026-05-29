/**
 * POST /api/admin/av/icp-backfill-sweep  (#245)
 *
 * Catch-up sweep for the ICP autopilot. The autopilot hook lives inside
 * saveBriefPayload — any path that BYPASSES that helper (raw SQL inserts,
 * direct DB writes, the SQL onboarding scripts for Tim / Skip / Mike /
 * Adriana) leaves the autopilot inert. Without this sweep, those clients
 * would have rich briefs but empty client_icps rows until val manually hit
 * "Sharpen from intake" per client.
 *
 * This sweep walks active clients where:
 *   - a brief exists (creative_briefs row present + non-trivial)
 *   - client_icps is missing OR empty (no industries AND no geographies)
 *
 * For each, fires maybeSharpenIcpAfterBriefSave (which respects "operator's
 * hand wins" — if anything's there, it skips). Sequential because the
 * sharpener costs one LLM call per client.
 *
 * Triggered via the daily dispatcher (/api/admin/cron/run?group=daily) or
 * directly by val from the operator UI. Auth via x-cron-secret =
 * ENRICHMENT_CRON_SECRET, exempted in middleware.ts.
 *
 * Hard ceiling: 55s soft deadline. Untouched clients catch up tomorrow.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAvDb } from '@/lib/db/av';
import { maybeSharpenIcpAfterBriefSave } from '@/lib/client/autopilot';
import { logEvent } from '@/lib/events/log';
import type { RowDataPacket } from 'mysql2';

export const runtime = 'nodejs';
export const maxDuration = 60;

const SOFT_DEADLINE_MS = 55_000;

interface CandidateRow extends RowDataPacket {
  client_id: number;
  client_name: string | null;
}

interface SweepResult {
  clientId: number;
  clientName: string;
  sharpened: boolean;
  reason?: string;
}

export async function POST(req: NextRequest) {
  const gate = process.env.ENRICHMENT_CRON_SECRET;
  if (!gate) {
    return NextResponse.json({ ok: false, error: 'cron_secret_missing' }, { status: 500 });
  }
  if ((req.headers.get('x-cron-secret') || '') !== gate) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  // Optional body: { only?: number[] } restricts to a specific client list
  // (useful for the "backfill just these" operator action).
  let body: { only?: unknown } = {};
  try { body = await req.json(); } catch { /* empty body fine */ }
  const only: number[] = Array.isArray(body.only)
    ? body.only.filter((n): n is number => typeof n === 'number' && Number.isInteger(n) && n > 0)
    : [];

  const startedAt = Date.now();
  const softDeadline = startedAt + SOFT_DEADLINE_MS;

  // Find clients with a brief but empty/missing ICP. The
  // JSON_LENGTH(JSON_KEYS(...)) > 0 check on the brief excludes empty
  // {} payloads; ICP-side we check both "no row" and "empty arrays".
  let candidates: CandidateRow[] = [];
  try {
    const db = getAvDb();
    const baseSql = `
      SELECT DISTINCT c.client_id, c.client_name
        FROM clients c
        JOIN creative_briefs cb
          ON cb.client_id = c.client_id
         AND cb.tenant_id = 'av'
         AND JSON_LENGTH(JSON_KEYS(cb.brief_payload)) > 2
        LEFT JOIN client_icps ic ON ic.client_id = c.client_id
       WHERE c.archived_at IS NULL
         AND (
                ic.client_id IS NULL
             OR (
                  COALESCE(JSON_LENGTH(ic.target_industries), 0) = 0
                  AND COALESCE(JSON_LENGTH(ic.target_geographies), 0) = 0
                )
             )
    `;
    if (only.length > 0) {
      const placeholders = only.map(() => '?').join(',');
      const [rows] = await db.execute<CandidateRow[]>(
        `${baseSql} AND c.client_id IN (${placeholders}) ORDER BY c.client_id ASC`,
        only
      );
      candidates = rows;
    } else {
      const [rows] = await db.execute<CandidateRow[]>(
        `${baseSql} ORDER BY c.client_id ASC`
      );
      candidates = rows;
    }
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: 'candidate_query_failed', detail: (err as Error).message },
      { status: 500 }
    );
  }

  const results: SweepResult[] = [];
  let sharpened = 0;
  let skipped = 0;
  let stoppedEarly = false;

  for (const c of candidates) {
    if (Date.now() >= softDeadline) {
      stoppedEarly = true;
      break;
    }
    try {
      // maybeSharpenIcpAfterBriefSave re-checks emptiness before firing AND
      // logs autopilot.icp_sharpened/autopilot.icp_sharpen_failed events on
      // its own — so we don't need to gate it ourselves.
      const before = await hasPopulatedIcp(c.client_id);
      if (before) {
        // A race: someone populated it between the candidate query and now.
        skipped += 1;
        results.push({ clientId: c.client_id, clientName: c.client_name || `Client #${c.client_id}`, sharpened: false, reason: 'already_populated' });
        continue;
      }
      await maybeSharpenIcpAfterBriefSave({ clientId: c.client_id, source: 'backfill_sweep' });
      const after = await hasPopulatedIcp(c.client_id);
      if (after) {
        sharpened += 1;
        results.push({ clientId: c.client_id, clientName: c.client_name || `Client #${c.client_id}`, sharpened: true });
      } else {
        skipped += 1;
        results.push({ clientId: c.client_id, clientName: c.client_name || `Client #${c.client_id}`, sharpened: false, reason: 'no_signal_from_brief' });
      }
    } catch (err) {
      skipped += 1;
      results.push({
        clientId: c.client_id,
        clientName: c.client_name || `Client #${c.client_id}`,
        sharpened: false,
        reason: (err as Error).message
      });
    }
  }

  await logEvent({
    eventType: 'cron.icp_backfill_completed',
    source: 'cron',
    executionTimeMs: Date.now() - startedAt,
    payload: {
      candidates: candidates.length,
      sharpened,
      skipped,
      stopped_early: stoppedEarly
    }
  });

  return NextResponse.json({
    ok: true,
    candidates: candidates.length,
    sharpened,
    skipped,
    stoppedEarly,
    results
  });
}

/** Quick check: does the client_icps row exist + have at least one industry or geo? */
async function hasPopulatedIcp(clientId: number): Promise<boolean> {
  try {
    const db = getAvDb();
    const [rows] = await db.execute<(RowDataPacket & { industries_len: number; geos_len: number })[]>(
      `SELECT
          COALESCE(JSON_LENGTH(target_industries), 0)  AS industries_len,
          COALESCE(JSON_LENGTH(target_geographies), 0) AS geos_len
         FROM client_icps WHERE client_id = ? LIMIT 1`,
      [clientId]
    );
    const r = rows[0];
    if (!r) return false;
    return Number(r.industries_len) > 0 || Number(r.geos_len) > 0;
  } catch {
    return false;
  }
}
