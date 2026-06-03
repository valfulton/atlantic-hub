/**
 * GET /api/admin/av/clients/[client_id]/public-intel/records?kind=...
 *
 * Returns the most recent N records for this (client, kind). Optional limit
 * defaults to 25. Used by PublicIntelPanel's results viewer.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { getAvDb } from '@/lib/db/av';
import type { RowDataPacket } from 'mysql2';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { client_id: string } }) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/clients/public-intel/records:GET',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const clientId = Number.parseInt(params.client_id, 10);
  if (!Number.isFinite(clientId) || clientId <= 0) {
    return NextResponse.json({ error: 'invalid client id' }, { status: 400 });
  }

  const kind = req.nextUrl.searchParams.get('kind');
  const limit = Math.min(100, Math.max(1, parseInt(req.nextUrl.searchParams.get('limit') ?? '25', 10) || 25));

  try {
    const db = getAvDb();
    // (#383) Validated integer — safe to inline. mysql2 execute() rejects
    // bound LIMIT params as strings, causing 500s on the Show records call.
    const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
    const args: (string | number)[] = [clientId];
    let where = `client_id = ?`;
    if (kind) {
      where += ` AND source_kind = ?`;
      args.push(kind);
    }
    const [rows] = await db.execute<(RowDataPacket & {
      record_id: number;
      source_kind: string;
      entity_key: string;
      summary_label: string | null;
      region_code: string | null;
      record_json: string | object;
      fetched_at: Date;
      expires_at: Date | null;
    })[]>(
      `SELECT record_id, source_kind, entity_key, summary_label, region_code,
              record_json, fetched_at, expires_at
         FROM public_intel_records
        WHERE ${where}
        ORDER BY fetched_at DESC
        LIMIT ${safeLimit}`,
      args
    );

    const records = rows.map((r) => {
      let parsed: unknown = null;
      try {
        parsed = typeof r.record_json === 'string' ? JSON.parse(r.record_json) : r.record_json;
      } catch { parsed = null; }
      return {
        recordId: Number(r.record_id),
        sourceKind: r.source_kind,
        entityKey: r.entity_key,
        summaryLabel: r.summary_label,
        regionCode: r.region_code,
        record: parsed,
        fetchedAt: r.fetched_at,
        expiresAt: r.expires_at
      };
    });
    return NextResponse.json({ ok: true, records });
  } catch (err) {
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}
