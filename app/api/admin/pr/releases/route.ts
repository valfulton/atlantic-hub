/**
 * /api/admin/pr/releases
 *
 * GET  -> list press releases (newest first).
 * POST -> create a release. If { announcement } is provided, the drafter writes
 *         a full release (title + body) in the client's voice and UPSERTs any
 *         derived intelligence objects. Otherwise a blank draft shell is created
 *         from { title, bodyText }.
 *
 * Body: { tenantId?, leadId?, announcement?, title?, bodyText? }
 *
 * Owner + staff only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { getAvDb } from '@/lib/db/av';
import { logEvent } from '@/lib/events/log';
import { draftRelease, upsertIntelligenceObjects } from '@/lib/pr/drafter';
import { DEFAULT_TENANT, PR_EVENTS } from '@/lib/pr/types';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

export const runtime = 'nodejs';
export const maxDuration = 60;

interface ReleaseRow extends RowDataPacket {
  id: number;
  tenant_id: string;
  lead_id: number | null;
  title: string | null;
  body_text: string | null;
  status: string;
  created_by_user_id: number | null;
  created_at: string;
  updated_at: string;
}

function mapRelease(r: ReleaseRow) {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    leadId: r.lead_id,
    title: r.title,
    bodyText: r.body_text,
    status: r.status,
    createdByUserId: r.created_by_user_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
}

export async function GET(req: NextRequest) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/pr/releases', tenantId: 'av' });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const url = new URL(req.url);
  const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit')) || 100));
  const tenantId = url.searchParams.get('tenant') || DEFAULT_TENANT;

  try {
    const db = getAvDb();
    const [rows] = await db.execute<ReleaseRow[]>(
      `SELECT id, tenant_id, lead_id, title, body_text, status, created_by_user_id,
              created_at, updated_at
         FROM press_releases
        WHERE tenant_id = ?
        ORDER BY id DESC
        LIMIT ?`,
      [tenantId, limit]
    );
    return NextResponse.json({ ok: true, items: rows.map(mapRelease) });
  } catch (err) {
    console.error('[pr:releases:list]', (err as Error).message);
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/pr/releases:POST', tenantId: 'av' });
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
  const leadId = typeof body.leadId === 'number' ? body.leadId : null;
  const announcement = typeof body.announcement === 'string' ? body.announcement.trim() : '';

  try {
    const db = getAvDb();
    let title: string | null = null;
    let bodyText: string | null = null;

    if (announcement.length >= 5) {
      const drafted = await draftRelease({ tenantId, leadId, announcement });
      title = drafted.title;
      bodyText = drafted.bodyText;
      await upsertIntelligenceObjects({
        tenantId,
        leadId,
        objects: drafted.derivedObjects,
        source: 'press_release'
      });
    } else {
      title = typeof body.title === 'string' ? body.title.trim().slice(0, 300) : null;
      bodyText = typeof body.bodyText === 'string' ? body.bodyText : null;
      if (!title && !bodyText) {
        return NextResponse.json(
          { error: 'provide an announcement (to AI-draft) or a title/bodyText (manual shell)' },
          { status: 400 }
        );
      }
    }

    const [res] = await db.execute<ResultSetHeader>(
      `INSERT INTO press_releases
         (tenant_id, lead_id, title, body_text, status, created_by_user_id)
       VALUES (?, ?, ?, ?, 'draft', ?)`,
      [tenantId, leadId, title, bodyText, guard.actor.userId]
    );
    const id = res.insertId;

    await logEvent({
      eventType: PR_EVENTS.releaseDrafted,
      leadId,
      userId: guard.actor.userId,
      source: 'pr_desk',
      payload: { release_id: id, ai_drafted: announcement.length >= 5 }
    });

    const [rows] = await db.execute<ReleaseRow[]>(
      `SELECT id, tenant_id, lead_id, title, body_text, status, created_by_user_id,
              created_at, updated_at
         FROM press_releases WHERE id = ? LIMIT 1`,
      [id]
    );
    return NextResponse.json({ ok: true, item: rows[0] ? mapRelease(rows[0]) : { id } });
  } catch (err) {
    console.error('[pr:releases:create]', (err as Error).message);
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}
