/**
 * POST /api/admin/pr/artifacts/[id]/queue
 *
 * Queue an own_brand_post artifact onto the Campaign Timeline by writing
 * social_outbox rows (schema 017) for the selected connected profiles, and
 * storing the first outbox id back on content_artifacts.linked_outbox_id
 * (mirrors pr_opportunities.linked_outbox_id). The publisher cron (schema 028)
 * fires scheduled rows at their time -- there is NO separate publish path here.
 *
 * Honors the Approval Gate (SYSTEM_CONSTITUTION section 5): this QUEUES; it does
 * not publish. With scheduledFor the rows are 'scheduled' (cron will fire them);
 * without it they are 'draft' (operator publishes via the existing publisher).
 *
 * Only own_brand_post is queueable here -- it is legitimately the brand posting
 * on its OWN channel (client_voice). Other artifact types are owned content for
 * newsrooms/clients, not the brand's social outbox.
 *
 * Body: { connectionIds: number[], scheduledFor?: string (ISO) }
 * Owner + staff only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { getAvDb } from '@/lib/db/av';
import { logEvent } from '@/lib/events/log';
import { autoThreadAsset } from '@/lib/campaigns/line_links';
import { CONTENT_EVENTS } from '@/lib/pr/types';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

export const runtime = 'nodejs';

interface ArtifactRow extends RowDataPacket {
  id: number;
  tenant_id: string;
  artifact_type: string;
  lead_id: number | null;
  title: string | null;
  body_text: string | null;
  status: string;
  linked_outbox_id: number | null;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/pr/artifacts/[id]/queue:POST', tenantId: 'av' });
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

  const connectionIds = Array.isArray(body.connectionIds)
    ? body.connectionIds.filter((x): x is number => typeof x === 'number' && Number.isFinite(x))
    : [];
  if (!connectionIds.length) {
    return NextResponse.json({ error: 'connectionIds (a non-empty array) is required' }, { status: 400 });
  }
  let scheduledFor: string | null = null;
  if (typeof body.scheduledFor === 'string' && body.scheduledFor.trim()) {
    const d = new Date(body.scheduledFor);
    if (Number.isNaN(d.getTime())) {
      return NextResponse.json({ error: 'scheduledFor is not a valid date' }, { status: 400 });
    }
    scheduledFor = d.toISOString().slice(0, 19).replace('T', ' ');
  }

  try {
    const db = getAvDb();
    const [rows] = await db.execute<ArtifactRow[]>(
      `SELECT id, tenant_id, artifact_type, lead_id, title, body_text, status, linked_outbox_id
         FROM content_artifacts WHERE id = ? LIMIT 1`,
      [id]
    );
    const artifact = rows[0];
    if (!artifact) return NextResponse.json({ error: 'artifact not found' }, { status: 404 });
    if (artifact.artifact_type !== 'own_brand_post') {
      return NextResponse.json({ error: 'only own_brand_post artifacts can be queued to the social timeline' }, { status: 409 });
    }
    if (artifact.status === 'passed') {
      return NextResponse.json({ error: 'cannot queue a dismissed artifact' }, { status: 409 });
    }
    const text = (artifact.body_text ?? '').trim();
    if (!text) return NextResponse.json({ error: 'artifact has no body text to post' }, { status: 409 });

    // Only queue to connections that belong to this tenant and are active.
    const placeholders = connectionIds.map(() => '?').join(', ');
    const [conns] = await db.execute<(RowDataPacket & { id: number })[]>(
      `SELECT id FROM social_connections
        WHERE tenant_id = ? AND status = 'active' AND id IN (${placeholders})`,
      [artifact.tenant_id, ...connectionIds]
    );
    const validIds = conns.map((c) => c.id);
    if (!validIds.length) {
      return NextResponse.json(
        { error: 'no active connections matched for this brand. Connect/select profiles at /admin/social.' },
        { status: 409 }
      );
    }

    const status: 'draft' | 'scheduled' = scheduledFor ? 'scheduled' : 'draft';
    const outboxIds: number[] = [];
    for (const connId of validIds) {
      const [ins] = await db.execute<ResultSetHeader>(
        `INSERT INTO social_outbox
           (tenant_id, connection_id, lead_id, asset_id, body_text, media_url, media_type,
            status, scheduled_for, created_by_user_id)
         VALUES (?, ?, ?, NULL, ?, NULL, 'none', ?, ?, ?)`,
        [artifact.tenant_id, connId, artifact.lead_id, text, status, scheduledFor, guard.actor.userId]
      );
      outboxIds.push(ins.insertId);
      // Narrative spine: thread each queued post to the customer's active line (no-op if none).
      autoThreadAsset({ tenantId: artifact.tenant_id, leadId: artifact.lead_id, assetType: 'social_post', assetId: ins.insertId }).catch(() => {});
    }

    // Link the first outbox row back onto the artifact (graph traceability).
    const firstOutboxId = outboxIds[0] ?? null;
    if (firstOutboxId != null) {
      await db.execute<ResultSetHeader>(
        `UPDATE content_artifacts
            SET linked_outbox_id = COALESCE(linked_outbox_id, ?), updated_at = NOW()
          WHERE id = ?`,
        [firstOutboxId, id]
      );
    }

    await logEvent({
      eventType: CONTENT_EVENTS.artifactQueued,
      leadId: artifact.lead_id,
      userId: guard.actor.userId,
      source: 'pr_desk',
      payload: {
        artifact_id: id,
        tenant_id: artifact.tenant_id,
        status,
        scheduled_for: scheduledFor,
        outbox_ids: outboxIds,
        profiles: validIds.length
      }
    });

    return NextResponse.json({
      ok: true,
      id,
      queued: validIds.length,
      status,
      scheduledFor,
      outboxIds,
      linkedOutboxId: firstOutboxId,
      note: scheduledFor
        ? 'Scheduled to the Campaign timeline. The publisher cron fires it at the scheduled time.'
        : 'Queued as a draft on the Campaign timeline. Publish it from /admin/social or schedule a time.'
    });
  } catch (err) {
    console.error('[pr:artifacts:queue]', (err as Error).message);
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}
