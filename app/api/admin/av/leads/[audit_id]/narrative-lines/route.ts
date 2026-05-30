/**
 * /api/admin/av/leads/[audit_id]/narrative-lines   (#46 spine Inc 1)
 *
 * The narrative spine, seen from the lead.
 *   GET    -> { lines: LineForLead[] }  the active lines for this lead's owner
 *             tagged with link status + shared keywords.
 *   POST   -> link this lead to a line: { lineId, role? }   (default role: advances)
 *   DELETE -> unlink this lead from a line: { lineId }
 *
 * The auditId is in the path (matches the rest of the av/leads/* surface). We
 * resolve auditId -> internal leadId once and dispatch to the lib helpers.
 * Owner + staff only (no client_user); the client lead view will get its own
 * read-only surface later.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { isFlagEnabled } from '@/lib/feature-flags';
import { getAvDb } from '@/lib/db/av';
import { linesForLead, bestLineForLead } from '@/lib/campaigns/lines_for_lead';
import { linkAssetToLine, unlinkAssetFromLine, LINK_ROLES, type LinkRole } from '@/lib/campaigns/line_links';
import { getLane } from '@/lib/campaigns/store';
import type { RowDataPacket } from 'mysql2';

export const runtime = 'nodejs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolveLeadId(auditId: string): Promise<number | null> {
  try {
    const db = getAvDb();
    const [rows] = await db.execute<(RowDataPacket & { id: number })[]>(
      `SELECT id FROM leads WHERE audit_id = ? AND archived_at IS NULL LIMIT 1`,
      [auditId]
    );
    return rows[0]?.id ?? null;
  } catch {
    return null;
  }
}

async function commonGuard(req: NextRequest, auditId: string, verb: 'GET' | 'POST' | 'DELETE') {
  const guard = await guardAdminRequest(req, {
    targetResource: `/api/admin/av/leads/[audit_id]/narrative-lines:${verb}`,
    tenantId: 'av'
  });
  if (!guard.ok) return { ok: false as const, response: guard.response };
  if (guard.actor.role === 'client_user') {
    return { ok: false as const, response: NextResponse.json({ error: 'forbidden' }, { status: 403 }) };
  }
  if (!(await isFlagEnabled('tab_av_enabled'))) {
    return { ok: false as const, response: NextResponse.json({ error: 'av tab disabled' }, { status: 403 }) };
  }
  if (!UUID_RE.test(auditId)) {
    return { ok: false as const, response: NextResponse.json({ error: 'invalid audit_id' }, { status: 400 }) };
  }
  const leadId = await resolveLeadId(auditId);
  if (!leadId) return { ok: false as const, response: NextResponse.json({ error: 'lead not found' }, { status: 404 }) };
  return { ok: true as const, leadId };
}

export async function GET(req: NextRequest, { params }: { params: { audit_id: string } }) {
  const g = await commonGuard(req, params.audit_id, 'GET');
  if (!g.ok) return g.response;
  const lines = await linesForLead(g.leadId);
  return NextResponse.json({ ok: true, lines });
}

export async function POST(req: NextRequest, { params }: { params: { audit_id: string } }) {
  const g = await commonGuard(req, params.audit_id, 'POST');
  if (!g.ok) return g.response;

  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; }
  catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }

  // (#46 Inc 2) "✨ Suggest best" path — caller asks us to PICK the line by
  // keyword fit instead of naming one. Same write underneath; the picker
  // returns null + a soft message when nothing clears the overlap floor.
  if (body.suggest === true) {
    const best = await bestLineForLead(g.leadId);
    if (!best) {
      return NextResponse.json({
        ok: false,
        reason: 'No clear fit — the active lines don\'t share enough with this lead to suggest one confidently.',
        lines: await linesForLead(g.leadId)
      });
    }
    const line = await getLane(best.lineId);
    if (!line) return NextResponse.json({ error: 'line not found' }, { status: 404 });
    const ok = await linkAssetToLine({
      tenantId: line.tenantId,
      narrativeLineId: best.lineId,
      assetType: 'lead',
      assetId: g.leadId,
      role: 'advances',
      note: `suggested by fit (matched on: ${best.shared.join(', ')})`
    });
    if (!ok) return NextResponse.json({ error: 'could not link' }, { status: 500 });
    return NextResponse.json({
      ok: true,
      suggestedLineId: best.lineId,
      shared: best.shared,
      lines: await linesForLead(g.leadId)
    });
  }

  const lineId = Number.parseInt(String(body.lineId ?? ''), 10);
  if (!Number.isFinite(lineId) || lineId <= 0) {
    return NextResponse.json({ error: 'invalid lineId' }, { status: 400 });
  }
  const role: LinkRole = (LINK_ROLES as string[]).includes(String(body.role))
    ? (body.role as LinkRole)
    : 'advances';

  // The line gives us the tenant for the link row, and proves it still exists
  // (lines can be archived between page-render and click). Refuse loudly so
  // the UI can swap to "line archived" rather than silently no-op.
  const line = await getLane(lineId);
  if (!line) return NextResponse.json({ error: 'line not found' }, { status: 404 });

  const ok = await linkAssetToLine({
    tenantId: line.tenantId,
    narrativeLineId: lineId,
    assetType: 'lead',
    assetId: g.leadId,
    role,
    note: 'linked from lead detail'
  });
  if (!ok) return NextResponse.json({ error: 'could not link' }, { status: 500 });

  // Return the refreshed panel state so the UI doesn't need a second round trip.
  const lines = await linesForLead(g.leadId);
  return NextResponse.json({ ok: true, lines });
}

export async function DELETE(req: NextRequest, { params }: { params: { audit_id: string } }) {
  const g = await commonGuard(req, params.audit_id, 'DELETE');
  if (!g.ok) return g.response;

  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; }
  catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }

  const lineId = Number.parseInt(String(body.lineId ?? ''), 10);
  if (!Number.isFinite(lineId) || lineId <= 0) {
    return NextResponse.json({ error: 'invalid lineId' }, { status: 400 });
  }

  await unlinkAssetFromLine(lineId, 'lead', g.leadId);
  const lines = await linesForLead(g.leadId);
  return NextResponse.json({ ok: true, lines });
}
