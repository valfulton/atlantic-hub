/**
 * POST /api/admin/av/clients/[client_id]/preflight  (#358)
 *
 * Free readiness check — no LLM calls. Used by the "Check first" button so
 * val sees which Prep steps will succeed before spending tokens.
 *
 * Body: { websiteUrl?: string }
 * Returns: PreflightReport
 *
 * Owner / staff only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { getAvDb } from '@/lib/db/av';
import { getBriefPayload } from '@/lib/client/brief_store';
import { runPrepPreflight } from '@/lib/av/prep_preflight';
import type { RowDataPacket } from 'mysql2';

export const runtime = 'nodejs';
export const maxDuration = 10;

function pickWebsiteUrl(
  bodyUrl: string | null | undefined,
  briefPayload: Record<string, unknown> | null
): string | null {
  const raw =
    (typeof bodyUrl === 'string' && bodyUrl.trim()) ||
    (briefPayload && typeof briefPayload.website_url === 'string' && (briefPayload.website_url as string).trim()) ||
    (briefPayload && typeof briefPayload.websiteUrl === 'string' && (briefPayload.websiteUrl as string).trim()) ||
    (briefPayload && typeof briefPayload.website === 'string' && (briefPayload.website as string).trim()) ||
    '';
  if (!raw) return null;
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

export async function POST(req: NextRequest, { params }: { params: { client_id: string } }) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/clients/preflight:POST',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const clientId = Number.parseInt(params.client_id, 10);
  if (!Number.isFinite(clientId) || clientId <= 0) {
    return NextResponse.json({ error: 'invalid client id' }, { status: 400 });
  }

  let body: { websiteUrl?: unknown } = {};
  try { body = (await req.json()) as typeof body; } catch { /* empty body fine */ }

  const briefPayload = ((await getBriefPayload('av', clientId)) as Record<string, unknown> | null) ?? {};
  const url = pickWebsiteUrl(typeof body.websiteUrl === 'string' ? body.websiteUrl : null, briefPayload);

  // Does any client_user on this client have a substantive intake_payload?
  let hasIntakePayload = false;
  try {
    const db = getAvDb();
    const [rows] = await db.execute<(RowDataPacket & { intake_payload: unknown })[]>(
      `SELECT intake_payload FROM client_users WHERE client_id = ? AND intake_payload IS NOT NULL LIMIT 1`,
      [clientId]
    );
    if (rows[0]?.intake_payload) {
      const p = typeof rows[0].intake_payload === 'string'
        ? JSON.parse(rows[0].intake_payload)
        : rows[0].intake_payload;
      if (p && Object.keys(p).length > 0) hasIntakePayload = true;
    }
  } catch { /* non-fatal */ }

  const report = await runPrepPreflight({ url, briefPayload, hasIntakePayload });
  return NextResponse.json({ ok: true, report });
}
