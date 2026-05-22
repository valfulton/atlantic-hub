/**
 * /api/admin/pr/sources
 *
 * Manage + run the active discovery lanes (Reddit, RSS) configured in
 * pr_discovery_sources (schema 027 -- no migration here).
 *
 *   GET  -> list configured sources for the tenant (config + last run status).
 *   POST -> { action: 'run' }     run all active reddit/rss sources now + the
 *                                 cross-layer performance sweep (lib/pr/sources/run.ts).
 *           { action: 'run', sourceId } run a single source.
 *           { action: 'upsert', kind, config, isActive?, secretRef? }
 *                                 create/update a reddit or rss source.
 *           { action: 'toggle', id, isActive } enable/disable a source.
 *
 * Owner + staff only. Reddit needs REDDIT_CLIENT_ID/REDDIT_CLIENT_SECRET in the
 * environment; if absent the lane reports itself disabled (it does not error).
 * v1 is operator-triggered (no cron, no extra middleware exemption); a scheduled
 * sweep is a clean follow-up.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { getAvDb } from '@/lib/db/av';
import { runExternalDiscovery } from '@/lib/pr/sources/run';
import { DEFAULT_TENANT } from '@/lib/pr/types';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';

export const runtime = 'nodejs';
export const maxDuration = 90;

interface SourceRow extends RowDataPacket {
  id: number;
  tenant_id: string;
  kind: string;
  config_json: unknown;
  secret_ref: string | null;
  is_active: number;
  last_run_at: string | null;
  last_status: string | null;
  last_detail: string | null;
  created_at: string;
  updated_at: string;
}

export async function GET(req: NextRequest) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/pr/sources', tenantId: 'av' });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const url = new URL(req.url);
  const tenantId = url.searchParams.get('tenant') || DEFAULT_TENANT;

  try {
    const db = getAvDb();
    const [rows] = await db.execute<SourceRow[]>(
      `SELECT id, tenant_id, kind, config_json, secret_ref, is_active,
              last_run_at, last_status, last_detail, created_at, updated_at
         FROM pr_discovery_sources
        WHERE tenant_id = ?
        ORDER BY id ASC
        LIMIT 100`,
      [tenantId]
    );
    return NextResponse.json({
      ok: true,
      items: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        config: coerceJson(r.config_json),
        secretRef: r.secret_ref,
        isActive: Number(r.is_active) === 1,
        lastRunAt: r.last_run_at,
        lastStatus: r.last_status,
        lastDetail: r.last_detail
      }))
    });
  } catch (err) {
    console.error('[pr:sources:list]', (err as Error).message);
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/pr/sources:POST', tenantId: 'av' });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const tenantId = typeof body.tenantId === 'string' && body.tenantId ? body.tenantId.slice(0, 64) : DEFAULT_TENANT;
  const action = typeof body.action === 'string' ? body.action : 'run';
  const db = getAvDb();

  try {
    if (action === 'run') {
      const sourceId = typeof body.sourceId === 'number' && body.sourceId > 0 ? body.sourceId : null;
      const result = await runExternalDiscovery({ tenantId, actorUserId: guard.actor.userId, sourceId });
      return NextResponse.json({ ok: true, ...result });
    }

    if (action === 'upsert') {
      const kind = body.kind === 'reddit' || body.kind === 'rss' ? body.kind : null;
      if (!kind) {
        return NextResponse.json({ error: "kind must be 'reddit' or 'rss'" }, { status: 400 });
      }
      const config = body.config && typeof body.config === 'object' ? body.config : {};
      const secretRef = typeof body.secretRef === 'string' ? body.secretRef.slice(0, 128) : null;
      const isActive = body.isActive === false ? 0 : 1;
      const id = typeof body.id === 'number' && body.id > 0 ? body.id : null;

      if (id) {
        await db.execute<ResultSetHeader>(
          `UPDATE pr_discovery_sources
              SET kind = ?, config_json = CAST(? AS JSON), secret_ref = ?, is_active = ?, updated_at = NOW()
            WHERE id = ? AND tenant_id = ?`,
          [kind, JSON.stringify(config), secretRef, isActive, id, tenantId]
        );
        return NextResponse.json({ ok: true, id });
      }
      const [res] = await db.execute<ResultSetHeader>(
        `INSERT INTO pr_discovery_sources (tenant_id, kind, config_json, secret_ref, is_active)
         VALUES (?, ?, CAST(? AS JSON), ?, ?)`,
        [tenantId, kind, JSON.stringify(config), secretRef, isActive]
      );
      return NextResponse.json({ ok: true, id: res.insertId });
    }

    if (action === 'toggle') {
      const id = typeof body.id === 'number' && body.id > 0 ? body.id : null;
      if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
      const isActive = body.isActive === false ? 0 : 1;
      await db.execute<ResultSetHeader>(
        `UPDATE pr_discovery_sources SET is_active = ?, updated_at = NOW() WHERE id = ? AND tenant_id = ?`,
        [isActive, id, tenantId]
      );
      return NextResponse.json({ ok: true, id, isActive: isActive === 1 });
    }

    return NextResponse.json({ error: `unknown action: ${action}` }, { status: 400 });
  } catch (err) {
    console.error('[pr:sources:post]', (err as Error).message);
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}

function coerceJson(v: unknown): unknown {
  if (v == null) return {};
  if (typeof v === 'string') {
    try {
      return JSON.parse(v);
    } catch {
      return {};
    }
  }
  return v;
}
