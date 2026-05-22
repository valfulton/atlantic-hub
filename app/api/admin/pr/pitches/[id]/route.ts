/**
 * PATCH /api/admin/pr/pitches/[id]
 *
 * Edit a drafted pitch's body text. Operators refine the AI draft before it is
 * queued/published. Only draft/approved pitches are editable. Owner + staff only.
 *
 * Body: { bodyText: string }
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { getAvDb } from '@/lib/db/av';
import { logEvent } from '@/lib/events/log';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

export const runtime = 'nodejs';

interface PitchRow extends RowDataPacket {
  id: number;
  lead_id: number | null;
  status: string;
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/pr/pitches/[id]:PATCH', tenantId: 'av' });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const id = Number.parseInt(params.id, 10);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const bodyText = typeof body.bodyText === 'string' ? body.bodyText.trim() : '';
  if (!bodyText) return NextResponse.json({ error: 'bodyText required' }, { status: 400 });

  try {
    const db = getAvDb();
    const [rows] = await db.execute<PitchRow[]>(
      `SELECT id, lead_id, status FROM pr_pitches WHERE id = ? LIMIT 1`,
      [id]
    );
    const pitch = rows[0];
    if (!pitch) return NextResponse.json({ error: 'pitch not found' }, { status: 404 });
    if (pitch.status === 'sent') {
      return NextResponse.json({ error: 'cannot edit a sent pitch' }, { status: 409 });
    }

    await db.execute<ResultSetHeader>(
      `UPDATE pr_pitches SET body_text = ?, updated_at = NOW() WHERE id = ?`,
      [bodyText, id]
    );
    await logEvent({
      eventType: 'pr.pitch.edited',
      leadId: pitch.lead_id,
      userId: guard.actor.userId,
      source: 'pr_desk',
      payload: { pitch_id: id, length: bodyText.length }
    });
    return NextResponse.json({ ok: true, id, bodyText });
  } catch (err) {
    console.error('[pr:pitches:patch]', (err as Error).message);
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}
