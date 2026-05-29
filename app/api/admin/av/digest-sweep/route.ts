/**
 * POST /api/admin/av/digest-sweep  (#216 v2)
 *
 * Cron sweep target: iterate active clients and send each their weekly digest.
 *
 * Triggered by /api/admin/cron/run?group=weekly (HostGator pings once per
 * week on Friday morning). Authenticates via x-cron-secret =
 * ENRICHMENT_CRON_SECRET (the shared cron-only secret). Exempted from the
 * operator wall in middleware.ts (PUBLIC_WEBHOOK_PATHS).
 *
 * Behavior:
 *   - Walks every active client (clients.archived_at IS NULL) that has at
 *     least one non-archived client_user with an email.
 *   - For each, calls sendClientDigest (empty weeks skipped automatically
 *     unless force=true).
 *   - Returns a per-client summary so the dispatcher response is auditable.
 *
 * Hard ceiling: 55s soft deadline so we always return a useful response
 * even if SMTP gets slow. Untouched clients on a slow day get caught next
 * Friday.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAvDb } from '@/lib/db/av';
import { sendClientDigest } from '@/lib/client/weekly_digest';
import { logEvent } from '@/lib/events/log';
import type { RowDataPacket } from 'mysql2';

export const runtime = 'nodejs';
export const maxDuration = 60;

const SOFT_DEADLINE_MS = 55_000;

interface ClientRow extends RowDataPacket {
  client_id: number;
  client_name: string | null;
}

interface PerClientResult {
  clientId: number;
  clientName: string;
  sent: boolean;
  empty?: boolean;
  reason?: string;
}

export async function POST(req: NextRequest) {
  // Auth: cron-only via shared secret. Be lenient on missing body — the
  // dispatcher posts an empty JSON object.
  const gate = process.env.ENRICHMENT_CRON_SECRET;
  if (!gate) {
    return NextResponse.json({ ok: false, error: 'cron_secret_missing' }, { status: 500 });
  }
  if ((req.headers.get('x-cron-secret') || '') !== gate) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  // Optional knobs (body): { force?: boolean, only?: number[] }
  //   - force: send even when a client's week is empty
  //   - only: limit to a specific subset of client_ids (testing)
  let body: { force?: boolean; only?: unknown } = {};
  try { body = await req.json(); } catch { /* empty body fine */ }
  const force = body.force === true;
  const only: number[] = Array.isArray(body.only)
    ? body.only.filter((n): n is number => typeof n === 'number' && Number.isInteger(n) && n > 0)
    : [];

  const startedAt = Date.now();
  const softDeadline = startedAt + SOFT_DEADLINE_MS;

  let clients: ClientRow[] = [];
  try {
    const db = getAvDb();
    if (only.length > 0) {
      const placeholders = only.map(() => '?').join(',');
      const [rows] = await db.execute<ClientRow[]>(
        `SELECT c.client_id, c.client_name
           FROM clients c
          WHERE c.archived_at IS NULL
            AND c.client_id IN (${placeholders})
          ORDER BY c.client_id ASC`,
        only
      );
      clients = rows;
    } else {
      // Active clients with at least one client_user that has an email.
      const [rows] = await db.execute<ClientRow[]>(
        `SELECT DISTINCT c.client_id, c.client_name
           FROM clients c
           JOIN client_users cu ON cu.client_id = c.client_id
          WHERE c.archived_at IS NULL
            AND cu.archived_at IS NULL
            AND cu.email IS NOT NULL AND cu.email <> ''
          ORDER BY c.client_id ASC`
      );
      clients = rows;
    }
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: 'client_query_failed', detail: (err as Error).message },
      { status: 500 }
    );
  }

  const results: PerClientResult[] = [];
  let sentCount = 0;
  let skippedEmpty = 0;
  let failedCount = 0;
  let stoppedEarly = false;

  for (const c of clients) {
    if (Date.now() >= softDeadline) {
      stoppedEarly = true;
      break;
    }
    try {
      const { build, send } = await sendClientDigest(c.client_id, { force });
      if (send.sent) {
        sentCount += 1;
        results.push({ clientId: c.client_id, clientName: c.client_name || `Client #${c.client_id}`, sent: true });
      } else if (build.isEmpty && !force) {
        skippedEmpty += 1;
        results.push({
          clientId: c.client_id,
          clientName: c.client_name || `Client #${c.client_id}`,
          sent: false,
          empty: true,
          reason: 'empty_week_skipped'
        });
      } else {
        failedCount += 1;
        results.push({
          clientId: c.client_id,
          clientName: c.client_name || `Client #${c.client_id}`,
          sent: false,
          reason: 'reason' in send ? send.reason : 'unknown'
        });
      }
    } catch (err) {
      failedCount += 1;
      results.push({
        clientId: c.client_id,
        clientName: c.client_name || `Client #${c.client_id}`,
        sent: false,
        reason: (err as Error).message
      });
    }
  }

  await logEvent({
    eventType: 'cron.digest_sweep_completed',
    source: 'cron',
    executionTimeMs: Date.now() - startedAt,
    payload: {
      attempted: clients.length,
      sent: sentCount,
      skipped_empty: skippedEmpty,
      failed: failedCount,
      stopped_early: stoppedEarly
    }
  });

  return NextResponse.json({
    ok: true,
    attempted: clients.length,
    sent: sentCount,
    skippedEmpty,
    failed: failedCount,
    stoppedEarly,
    results
  });
}
