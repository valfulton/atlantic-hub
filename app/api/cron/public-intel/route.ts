/**
 * POST /api/cron/public-intel  (#380, val 2026-06-03)
 *
 * Worker-callable endpoint. The HostGator cron script POSTs with the
 * `Authorization: Bearer <WORKER_INTERNAL_TOKEN>` header and a body
 * specifying the task to run:
 *
 *   { task: 'daily-courtlistener' }
 *   { task: 'weekly-cfpb-sos-ucc' }
 *   { task: 'weekly-gbp' }
 *   { task: 'monthly-hmda-acs' }
 *   { task: 'nightly-distress' }
 *
 * For each enabled (client_id, source_kind) pair, runs the matching adapter,
 * then runs cascades, then rescores distress. Writes one worker_run_log
 * row per task. Auto-logs failures, never crashes the cron caller.
 *
 * NEVER call from a browser session — admin sessions don't pass the worker
 * token check; only the HostGator worker has it.
 */
import { NextRequest, NextResponse } from 'next/server';
import { checkWorkerToken } from '@/lib/cron/worker_auth';
import { getAvDb } from '@/lib/db/av';
import { listSourcesForClient } from '@/lib/public_intel/store';
import { getAdapter } from '@/lib/public_intel/registry';
import { runCascadesForClient } from '@/lib/public_intel/cascade';
import { rescoreClient } from '@/lib/public_intel/distress_engine';
import type { PublicIntelKind } from '@/lib/public_intel/types';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';

export const runtime = 'nodejs';
export const maxDuration = 60;

const TASK_TO_KINDS: Record<string, PublicIntelKind[]> = {
  'daily-courtlistener': ['courtlistener', 'pacer_docket'],
  'weekly-cfpb-sos-ucc': ['cfpb', 'ca_sos', 'ucc_ca'],
  'weekly-gbp': ['gbp'],
  'monthly-hmda-acs': ['hmda', 'census_acs']
};

interface ClientRow extends RowDataPacket {
  client_id: number;
}

async function listEnabledClientsFor(kinds: PublicIntelKind[]): Promise<number[]> {
  if (kinds.length === 0) return [];
  try {
    const db = getAvDb();
    const placeholders = kinds.map(() => '?').join(',');
    const [rows] = await db.execute<ClientRow[]>(
      `SELECT DISTINCT client_id
         FROM public_intel_sources
        WHERE enabled = 1
          AND client_id IS NOT NULL
          AND source_kind IN (${placeholders})`,
      kinds
    );
    return rows.map((r) => Number(r.client_id));
  } catch {
    return [];
  }
}

async function startLog(task: string, clientId: number | null): Promise<number | null> {
  try {
    const db = getAvDb();
    const [res] = await db.execute<ResultSetHeader>(
      `INSERT INTO worker_run_log (task, client_id, status) VALUES (?, ?, 'running')`,
      [task, clientId]
    );
    return res.insertId;
  } catch { return null; }
}

async function finishLog(logId: number | null, status: 'ok' | 'error' | 'partial', detail: string, stats: { adapterCount?: number; cascadeRecipesFired?: number; entitiesScored?: number } = {}): Promise<void> {
  if (!logId) return;
  try {
    const db = getAvDb();
    await db.execute(
      `UPDATE worker_run_log
          SET finished_at = NOW(),
              status = ?,
              detail = ?,
              adapter_count = ?,
              cascade_recipes_fired = ?,
              entities_scored = ?
        WHERE log_id = ?`,
      [
        status,
        detail.slice(0, 480),
        stats.adapterCount ?? 0,
        stats.cascadeRecipesFired ?? 0,
        stats.entitiesScored ?? 0,
        logId
      ]
    );
  } catch { /* non-fatal */ }
}

export async function POST(req: NextRequest) {
  if (!checkWorkerToken(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  let body: { task?: unknown } = {};
  try { body = (await req.json()) as typeof body; } catch { /* empty body fine */ }
  const task = typeof body.task === 'string' ? body.task : null;
  if (!task) return NextResponse.json({ error: 'task required' }, { status: 400 });

  // Nightly distress sweep: rescore every client with sources enabled, no adapter runs.
  if (task === 'nightly-distress') {
    const clients = await listEnabledClientsFor([
      'hmda', 'cfpb', 'census_acs', 'ca_sos', 'courtlistener', 'ucc_ca', 'pacer_docket', 'gbp'
    ]);
    const logId = await startLog(task, null);
    let totalScored = 0;
    for (const clientId of clients) {
      try {
        const r = await rescoreClient(clientId, 90);
        totalScored += r.entitiesScored;
      } catch { /* keep going */ }
    }
    await finishLog(logId, 'ok', `Rescored ${clients.length} clients · ${totalScored} entities total`, { entitiesScored: totalScored });
    return NextResponse.json({ ok: true, task, clientsRescored: clients.length, totalScored });
  }

  const kinds = TASK_TO_KINDS[task];
  if (!kinds) return NextResponse.json({ error: `unknown task: ${task}` }, { status: 400 });

  const clients = await listEnabledClientsFor(kinds);
  let totalAdapters = 0;
  let totalCascades = 0;
  let totalScored = 0;
  const detail: string[] = [];

  for (const clientId of clients) {
    const logId = await startLog(task, clientId);
    const sources = await listSourcesForClient(clientId);
    let adapterCount = 0;
    try {
      for (const src of sources) {
        if (!src.enabled) continue;
        if (!kinds.includes(src.sourceKind)) continue;
        const entry = getAdapter(src.sourceKind);
        if (!entry?.available) continue;
        try {
          await entry.adapter.run({ source: src, clientId });
          adapterCount++;
        } catch (e) {
          detail.push(`client=${clientId} ${src.sourceKind}: ${(e as Error).message.slice(0, 80)}`);
        }
      }
      // Sweep cascades + rescore after the client's adapters finish.
      const cascadeRes = await runCascadesForClient(clientId, 14);
      const distressRes = await rescoreClient(clientId, 90);
      totalAdapters += adapterCount;
      totalCascades += cascadeRes.recipesFired;
      totalScored += distressRes.entitiesScored;
      await finishLog(logId, 'ok', `${adapterCount} adapters · ${cascadeRes.recipesFired} cascades · ${distressRes.entitiesScored} scored`, {
        adapterCount,
        cascadeRecipesFired: cascadeRes.recipesFired,
        entitiesScored: distressRes.entitiesScored
      });
    } catch (e) {
      await finishLog(logId, 'error', (e as Error).message.slice(0, 480), { adapterCount });
    }
  }

  return NextResponse.json({
    ok: true,
    task,
    clientsProcessed: clients.length,
    totalAdapters,
    totalCascades,
    totalScored,
    errors: detail.slice(0, 20)
  });
}
