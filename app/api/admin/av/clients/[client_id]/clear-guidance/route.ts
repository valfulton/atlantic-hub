/**
 * POST /api/admin/av/clients/[client_id]/clear-guidance  (#223)
 *
 * Surgical cache-clear for client dashboard guidance. Deletes the cached
 * `intelligence_objects` of type `next_best_moves` and `momentum_signals`
 * scoped to this client's client_users tenant -- nothing else.
 *
 * NO AI CALLS. NO scoreAndAuditLead. NO extractPainProfileForLead.
 * The dashboard guidance is composed on-the-fly from existing lead data;
 * the cache just speeds up dashboard loads. Nuking the cache forces the
 * next dashboard load to recompose from latest code + latest data.
 *
 * Use when:
 *   - You shipped a code fix to lib/client/guidance.ts and want clients to
 *     see the new behavior without burning OpenAI tokens (your case in
 *     #177 -- old guidance was cached under client:<id> tenant).
 *   - A client's dashboard cards look stale and you want a clean slate.
 *
 * Owner + staff only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { isFlagEnabled } from '@/lib/feature-flags';
import { getAvDb } from '@/lib/db/av';
import { logEvent } from '@/lib/events/log';
import type { ResultSetHeader } from 'mysql2';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: { client_id: string } }) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/clients/clear-guidance:POST',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  if (!(await isFlagEnabled('tab_av_enabled'))) {
    return NextResponse.json({ error: 'av tab disabled' }, { status: 403 });
  }

  const clientId = Number.parseInt(params.client_id, 10);
  if (!Number.isFinite(clientId) || clientId <= 0) {
    return NextResponse.json({ error: 'invalid client id' }, { status: 400 });
  }

  const start = Date.now();
  try {
    const db = getAvDb();
    const [res] = await db.execute<ResultSetHeader>(
      `DELETE FROM intelligence_objects
        WHERE object_type IN ('next_best_moves', 'momentum_signals')
          AND tenant_id IN (
            SELECT CONCAT('client:', client_user_id)
              FROM client_users
             WHERE client_id = ?
          )`,
      [clientId]
    );

    const elapsedMs = Date.now() - start;
    await logEvent({
      eventType: 'client.guidance_cache_cleared',
      userId: guard.actor.userId,
      source: 'manual',
      executionTimeMs: elapsedMs,
      payload: { client_id: clientId, rows_deleted: res.affectedRows }
    });

    return NextResponse.json({
      ok: true,
      clientId,
      rowsDeleted: res.affectedRows,
      elapsedMs,
      note: "Cache cleared. Next dashboard load will recompose from latest code + data. No AI calls were made."
    });
  } catch (err) {
    console.error('[clear-guidance]', (err as Error).message);
    return NextResponse.json(
      { error: 'clear_failed', message: (err as Error).message.slice(0, 300) },
      { status: 500 }
    );
  }
}
