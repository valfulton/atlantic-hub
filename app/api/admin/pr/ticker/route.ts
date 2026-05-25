/**
 * GET /api/admin/pr/ticker
 *
 * Recent PR intelligence for the operator's cross-page "breaking news" ticker:
 * the newest opportunities the PR engine surfaced (last 14 days), with the
 * client/lead they were matched to. Read-only, owner/staff. Lightweight (≤12).
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { getAvDb } from '@/lib/db/av';
import type { RowDataPacket } from 'mysql2';

export const runtime = 'nodejs';
export const maxDuration = 20;

interface OppRow extends RowDataPacket {
  id: number;
  source: string | null;
  outlet: string | null;
  topic_tags: unknown;
  why_it_matters: string | null;
  created_at: string;
  company: string | null;
}

function tags(v: unknown): string[] {
  let val: unknown = v;
  if (typeof val === 'string') { try { val = JSON.parse(val); } catch { return []; } }
  return Array.isArray(val) ? val.filter((x): x is string => typeof x === 'string').slice(0, 3) : [];
}

export async function GET(req: NextRequest) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/pr/ticker', tenantId: 'av' });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  try {
    const db = getAvDb();
    const [rows] = await db.execute<OppRow[]>(
      `SELECT o.id, o.source, o.outlet, o.topic_tags, o.why_it_matters, o.created_at,
              l.company AS company
         FROM pr_opportunities o
         LEFT JOIN leads l ON l.id = o.matched_lead_id
        WHERE o.created_at >= (NOW() - INTERVAL 14 DAY)
        ORDER BY o.created_at DESC
        LIMIT 12`
    );
    const items = rows.map((r) => ({
      id: r.id,
      source: r.source,
      outlet: r.outlet,
      topics: tags(r.topic_tags),
      whyItMatters: r.why_it_matters,
      company: r.company,
      createdAt: r.created_at
    }));
    return NextResponse.json({ ok: true, items });
  } catch (err) {
    return NextResponse.json({ ok: true, items: [], errorClass: (err as Error).name });
  }
}
