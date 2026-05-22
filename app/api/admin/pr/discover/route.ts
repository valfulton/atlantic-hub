/**
 * /api/admin/pr/discover
 *
 * GET  -> list current SUGGESTED opportunities (suggested=1), ranked by relevance.
 * POST -> run the internal-signal discovery sweep now (mines pain_point_profile
 *         clusters + client wins from data the hub already holds) and return the
 *         counts. Idempotent: re-running upserts instead of duplicating.
 *
 * Owner + staff only. No external credentials needed for the internal lane.
 * Guarded by the existing /api/admin/* matcher + guardAdminRequest.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { getAvDb } from '@/lib/db/av';
import { runInternalDiscoverySweep } from '@/lib/pr/discovery';
import { DEFAULT_TENANT } from '@/lib/pr/types';
import type { RowDataPacket } from 'mysql2';

export const runtime = 'nodejs';
export const maxDuration = 60;

interface SuggestedRow extends RowDataPacket {
  id: number;
  tenant_id: string;
  source: string;
  query_text: string | null;
  topic_tags: unknown;
  why_it_matters: string | null;
  matched_lead_id: number | null;
  matched_company: string | null;
  origin: string;
  relevance_score: number | null;
  status: string;
  created_at: string;
}

export async function GET(req: NextRequest) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/pr/discover', tenantId: 'av' });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const url = new URL(req.url);
  const tenantId = url.searchParams.get('tenant') || DEFAULT_TENANT;
  const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit')) || 25));

  try {
    const db = getAvDb();
    const [rows] = await db.execute<SuggestedRow[]>(
      `SELECT o.id, o.tenant_id, o.source, o.query_text, o.topic_tags, o.why_it_matters,
              o.matched_lead_id, l.company AS matched_company, o.origin, o.relevance_score,
              o.status, o.created_at
         FROM pr_opportunities o
         LEFT JOIN leads l ON l.id = o.matched_lead_id
        WHERE o.tenant_id = ? AND o.suggested = 1 AND o.status IN ('new','drafted')
        ORDER BY o.relevance_score DESC, o.id DESC
        LIMIT ${limit}`,
      [tenantId]
    );
    const items = rows.map((r) => ({
      id: r.id,
      source: r.source,
      queryText: r.query_text,
      topicTags: Array.isArray(r.topic_tags) ? r.topic_tags : [],
      whyItMatters: r.why_it_matters,
      matchedLeadId: r.matched_lead_id,
      matchedCompany: r.matched_company,
      origin: r.origin,
      relevanceScore: r.relevance_score,
      status: r.status,
      createdAt: r.created_at
    }));
    return NextResponse.json({ ok: true, items });
  } catch (err) {
    console.error('[pr:discover:list]', (err as Error).message);
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/pr/discover:POST', tenantId: 'av' });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    // empty body ok
  }
  const tenantId = typeof body.tenantId === 'string' && body.tenantId ? body.tenantId.slice(0, 64) : DEFAULT_TENANT;

  try {
    const result = await runInternalDiscoverySweep({ tenantId, actorUserId: guard.actor.userId });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error('[pr:discover:sweep]', (err as Error).message);
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}
