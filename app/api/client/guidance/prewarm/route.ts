/**
 * POST /api/client/guidance/prewarm   (OPTIONAL pre-warm sweep, v1)
 *
 * Recomposes client guidance for every active client_user so the dashboard load
 * is always a warm-cache read. This keeps the guidance COMPOUNDING (persisted
 * intelligence_objects) instead of recomputing on every page hit (B4).
 *
 * AUTH: this path is NOT in the middleware matcher (and we do not touch
 * middleware), so the middleware session wall does not run here. Instead, this
 * route gates ITSELF on a shared cron secret in the `x-cron-secret` header --
 * the same self-secret pattern the inbound webhooks and the score-sweep cron
 * use. It REUSES the existing ENRICHMENT_CRON_SECRET so no new secret has to be
 * managed (matches netlify/functions/score-cron.mts). No client cookie is
 * accepted here; this is an operator/scheduler surface, not a client surface.
 *
 * It is OPTIONAL: the dashboard already self-heals a cold/stale cache on load.
 * This just removes the first-load compose latency.
 *
 * Search marker: [client-portal:guidance:prewarm].
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAvDb } from '@/lib/db/av';
import { composeClientGuidance, type ClientIdentity } from '@/lib/client/guidance';
import type { RowDataPacket } from 'mysql2';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

interface ClientUserLite extends RowDataPacket {
  client_user_id: number;
  client_id: number | null;
  email: string;
  tier: string;
  display_name: string | null;
}

export async function POST(req: NextRequest) {
  const expected = process.env.ENRICHMENT_CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ ok: false, error: 'cron_secret_missing' }, { status: 500 });
  }
  const provided = req.headers.get('x-cron-secret');
  if (!provided || provided !== expected) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  let limit = DEFAULT_LIMIT;
  try {
    const body = (await req.json()) as { limit?: number };
    if (typeof body?.limit === 'number' && Number.isFinite(body.limit)) {
      limit = Math.max(1, Math.min(MAX_LIMIT, Math.floor(body.limit)));
    }
  } catch {
    /* no body / not JSON -- use default */
  }

  const started = Date.now();
  let composed = 0;
  let failed = 0;

  try {
    const db = getAvDb();
    // LIMIT is an inlined integer (mysql2 + HostGator rejects a prepared LIMIT ?).
    const [rows] = await db.execute<ClientUserLite[]>(
      `SELECT client_user_id, client_id, email, tier, display_name
         FROM client_users
        WHERE archived_at IS NULL
        ORDER BY last_login_at DESC, client_user_id DESC
        LIMIT ${limit}`
    );

    for (const r of rows) {
      const identity: ClientIdentity = {
        clientUserId: r.client_user_id,
        clientId: r.client_id,
        email: r.email,
        tier: r.tier,
        displayName: r.display_name
      };
      try {
        await composeClientGuidance({ client: identity });
        composed++;
      } catch {
        failed++;
      }
    }

    return NextResponse.json({
      ok: true,
      composed,
      failed,
      scanned: rows.length,
      elapsed_ms: Date.now() - started
    });
  } catch (err) {
    console.error('[client-portal:guidance:prewarm] error:', (err as Error).message);
    return NextResponse.json({ ok: false, error: 'server error' }, { status: 500 });
  }
}
