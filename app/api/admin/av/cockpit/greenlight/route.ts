/**
 * POST /api/admin/av/cockpit/greenlight  (#569, Tier 1.2 — real dispatch)
 *
 * Body accepts EITHER:
 *   { clientId, approvalId: number, action: 'green' | 'kill' }
 *     → operate on an existing cockpit_approvals row
 *   { clientId, approval: { kind, title, source, angle }, action: 'green' }
 *     → for in-memory cockpit cards that haven't been persisted yet: create
 *       the row + immediately approve + dispatch in one call. This is how
 *       the cockpit's initial brief-grounded cards (still in React state)
 *       graduate to real persisted artifacts when val greenlights them.
 *
 * Dispatch on approve (per approval_kind):
 *   press_release → INSERT press_touches (status='drafted')
 *                   so it appears in the PressTouchesPanel and the
 *                   /admin/av/clients/[id]/press operator surface.
 *   social         → INSERT social_outbox row, status='draft' (publisher
 *                   cron picks it up if scheduled_at set; otherwise lives
 *                   as a queued draft val can review).
 *   commercial    → INSERT social_outbox with a 'commercial' content type
 *                   marker. v3 routes through the video pipeline.
 *   op_ed         → INSERT into content_artifacts (own_brand_post) for the
 *                   newsroom publisher to consider.
 *
 * Soft-fail philosophy: dispatch failures don't roll back the approval. The
 * approval stays approved + a console error is logged. Better to have a
 * green-lit artifact with a missing downstream than to silently drop the
 * operator's intent.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import {
  approveApproval,
  createApproval,
  killApproval,
  linkDispatch,
  type ApprovalKind
} from '@/lib/av/cockpit_approvals';
import { logPressTouch } from '@/lib/client/press_touches';
import { getAvDb } from '@/lib/db/av';
import type { ResultSetHeader } from 'mysql2';

export const runtime = 'nodejs';

interface InlineApproval {
  kind: ApprovalKind;
  title: string;
  source?: string | null;
  angle?: string | null;
}

interface Body {
  clientId?: number;
  approvalId?: number;
  approval?: InlineApproval;
  action?: 'green' | 'kill';
}

function isValidKind(v: unknown): v is ApprovalKind {
  return v === 'commercial' || v === 'press_release' || v === 'op_ed' || v === 'social';
}

export async function POST(req: NextRequest) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/av/cockpit/greenlight:POST', tenantId: 'av' });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }

  const { clientId, action } = body;
  if (!Number.isFinite(clientId) || !action || (action !== 'green' && action !== 'kill')) {
    return NextResponse.json({ error: 'clientId + action(green|kill) required' }, { status: 400 });
  }

  const actorId = Number(guard.actor.userId) || null;
  let approvalId = body.approvalId ?? 0;

  // Inline-approval path: create the row first, then proceed as normal.
  if (!approvalId && body.approval && isValidKind(body.approval.kind)) {
    approvalId = await createApproval({
      clientId: clientId as number,
      kind: body.approval.kind,
      title: body.approval.title,
      source: body.approval.source ?? null,
      angle: body.approval.angle ?? null,
      status: 'pending'
    });
    if (!approvalId) {
      return NextResponse.json({ error: 'could not persist approval' }, { status: 500 });
    }
  }

  if (!approvalId) {
    return NextResponse.json({ error: 'approvalId or approval payload required' }, { status: 400 });
  }

  // Kill path — soft-mark and return.
  if (action === 'kill') {
    const ok = await killApproval(approvalId, actorId);
    return NextResponse.json({ ok, approvalId, action });
  }

  // Approve path — flip status, then dispatch by kind. Read back the row to
  // know what we just approved.
  const approved = await approveApproval(approvalId, actorId);
  if (!approved) {
    return NextResponse.json({ ok: false, error: 'could not approve (already approved or missing?)' });
  }

  const db = getAvDb();
  const [rows] = await db.execute<({ approval_kind: ApprovalKind; title: string; source: string | null; client_id: number } & import('mysql2').RowDataPacket)[]>(
    `SELECT approval_kind, title, source, client_id FROM cockpit_approvals WHERE approval_id = ?`,
    [approvalId]
  );
  const a = rows[0];
  if (!a) {
    return NextResponse.json({ ok: true, approvalId, dispatched: false, note: 'approval not readable post-update' });
  }

  // Dispatch — best-effort. Each branch logs to console on failure but does
  // not unwind the approval.
  const dispatch: { pressTouchId?: number; outboxId?: number; calendarId?: number } = {};
  try {
    if (a.approval_kind === 'press_release') {
      const touchId = await logPressTouch({
        clientId: a.client_id,
        journalist: 'Unassigned',  // val fills in via PressTouchesEditor
        outlet: 'Target outlet TBD',
        beat: null,
        channel: 'email',
        status: 'drafted',
        subject: a.title,
        notes: a.source ? `[Cockpit green-light] ${a.source}` : '[Cockpit green-light]',
        relatedBriefKey: 'key_message',
        createdByUserId: actorId
      });
      if (touchId) dispatch.pressTouchId = touchId;
    } else if (a.approval_kind === 'social' || a.approval_kind === 'commercial') {
      // Minimal outbox row. Once the publisher schema is confirmed we'll route
      // through the real social_outbox upsert lib; for now write a thin row.
      try {
        const [res] = await db.execute<ResultSetHeader>(
          `INSERT INTO social_outbox
             (tenant_id, client_id, content_type, status, draft_text, source_label, created_at, updated_at)
           VALUES ('av', ?, ?, 'draft', ?, ?, NOW(), NOW())`,
          [a.client_id, a.approval_kind === 'commercial' ? 'commercial' : 'social_post', a.title, a.source]
        );
        if (res.insertId) dispatch.outboxId = res.insertId;
      } catch (err) {
        console.error('[cockpit:greenlight:dispatch:outbox]', (err as Error).message);
      }
    } else if (a.approval_kind === 'op_ed') {
      try {
        const [res] = await db.execute<ResultSetHeader>(
          `INSERT INTO content_artifacts
             (tenant_id, artifact_type, title, body_text, status, created_at, updated_at)
           VALUES (?, 'own_brand_post', ?, NULL, 'draft', NOW(), NOW())`,
          [`client:${a.client_id}`, a.title]
        );
        if (res.insertId) {
          // We don't have a direct artifact-id link column on cockpit_approvals,
          // but the artifact carries tenant_id=client:N so the newsroom desk
          // surfaces will find it. (v3 adds a direct FK.)
        }
      } catch (err) {
        console.error('[cockpit:greenlight:dispatch:op_ed]', (err as Error).message);
      }
    }
  } catch (err) {
    console.error('[cockpit:greenlight:dispatch]', (err as Error).message);
  }

  await linkDispatch(approvalId, dispatch);

  return NextResponse.json({
    ok: true,
    approvalId,
    action: 'green',
    dispatched: dispatch
  });
}
