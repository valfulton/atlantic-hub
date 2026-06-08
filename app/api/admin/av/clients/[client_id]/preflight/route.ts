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
import { pickWebsiteFromBrief } from '@/lib/client/website_resolver';
import { runPrepPreflight } from '@/lib/av/prep_preflight';
import type { RowDataPacket } from 'mysql2';

export const runtime = 'nodejs';
export const maxDuration = 10;

/**
 * (#514) Resolve the website URL for the preflight probe. Operator can pass
 * an explicit override in the request body (e.g. when re-running for a
 * different URL); otherwise we read the brief through the canonical resolver
 * so EVERY surface that needs the website sees the same answer.
 */
function pickWebsiteUrl(
  bodyUrl: string | null | undefined,
  briefPayload: Record<string, unknown> | null
): string | null {
  const explicit = typeof bodyUrl === 'string' && bodyUrl.trim();
  const raw = explicit || pickWebsiteFromBrief(briefPayload) || '';
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

  // (#510 followup) Count social_targets already on file so scrape_socials
  // doesn't mark itself "no website on brief" when the URLs are already there.
  let socialsOnFile = 0;
  try {
    const db = getAvDb();
    const [rows] = await db.execute<(RowDataPacket & { n: number })[]>(
      `SELECT COUNT(*) AS n FROM social_targets
        WHERE client_id = ? AND status IN ('suggested','confirmed','connected')`,
      [clientId]
    );
    socialsOnFile = Number(rows[0]?.n ?? 0);
  } catch { /* non-fatal — falls back to URL-based gate */ }

  const report = await runPrepPreflight({ url, briefPayload, hasIntakePayload, socialsOnFile });
  return NextResponse.json({ ok: true, report });
}
