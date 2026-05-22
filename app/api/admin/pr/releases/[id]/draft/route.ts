/**
 * POST /api/admin/pr/releases/[id]/draft
 *
 * Re-draft (or first-draft) the body of an existing press release. Re-runs the
 * release drafter against the announcement + the client's accumulated
 * intelligence, overwrites title + body, UPSERTs derived intelligence objects.
 * A release can only be re-drafted while status = 'draft'.
 *
 * Body: { announcement: string, leadId?: number }
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
  status: string;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/pr/releases/[id]/draft:POST',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const id = Number.parseInt(params.id, 10);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const announcement = typeof body.announcement === 'string' ? body.announcement.trim() : '';
  if (announcement.length < 5) {
    return NextResponse.json({ error: 'announcement required to re-draft' }, { status: 400 });
  }

  try {
    const db = getAvDb();
    const [rows] = await db.execute<ReleaseRow[]>(
      `SELECT id, tenant_id, lead_id, status FROM press_releases WHERE id = ? LIMIT 1`,
      [id]
    );
    const rel = rows[0];
    if (!rel) return NextResponse.json({ error: 'release not found' }, { status: 404 });
    if (rel.status !== 'draft') {
      return NextResponse.json({ error: `cannot re-draft a ${rel.status} release` }, { status: 409 });
    }

    const tenantId = rel.tenant_id || DEFAULT_TENANT;
    const leadId = typeof body.leadId === 'number' ? body.leadId : rel.lead_id;

    const drafted = await draftRelease({ tenantId, leadId, announcement });
    await upsertIntelligenceObjects({ tenantId, leadId, objects: drafted.derivedObjects, source: 'press_release' });

    await db.execute<ResultSetHeader>(
      `UPDATE press_releases
          SET title = ?, body_text = ?, lead_id = COALESCE(?, lead_id), updated_at = NOW()
        WHERE id = ?`,
      [drafted.title, drafted.bodyText, leadId, id]
    );

    await logEvent({
      eventType: PR_EVENTS.releaseDrafted,
      leadId,
      userId: guard.actor.userId,
      source: 'pr_desk',
      payload: { release_id: id, redraft: true, grounded_on_intelligence: drafted.groundedOnIntelligence }
    });

    return NextResponse.json({
      ok: true,
      item: { id, tenantId, leadId, title: drafted.title, bodyText: drafted.bodyText, status: 'draft' },
      groundedOnIntelligence: drafted.groundedOnIntelligence
    });
  } catch (err) {
    console.error('[pr:releases:draft]', (err as Error).message);
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}
