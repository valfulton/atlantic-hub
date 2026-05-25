/**
 * GET /api/client/ticker
 *
 * Client-scoped "breaking news": recent PR opportunities matched to THIS client's
 * leads, so the client feels first-to-know about relevant openings. Read-only,
 * client-session scoped (middleware sets x-ah-client-user-id). Calm + minimal —
 * no operator-internal strategy text leaks to the client.
 */
import { NextRequest, NextResponse } from 'next/server';
import { readClientActorFromHeaders } from '@/lib/auth/client-session';
import { findClientUserById } from '@/lib/auth/client-user';
import { getAvDb } from '@/lib/db/av';
import type { RowDataPacket } from 'mysql2';

export const runtime = 'nodejs';
export const maxDuration = 20;

interface Row extends RowDataPacket {
  id: number;
  source: string | null;
  outlet: string | null;
  topic_tags: unknown;
  created_at: string;
}

function tags(v: unknown): string[] {
  let val: unknown = v;
  if (typeof val === 'string') { try { val = JSON.parse(val); } catch { return []; } }
  return Array.isArray(val) ? val.filter((x): x is string => typeof x === 'string').slice(0, 2) : [];
}

export async function GET(req: NextRequest) {
  const actor = readClientActorFromHeaders(req.headers);
  if (!actor) return NextResponse.json({ ok: true, items: [] });
  const user = await findClientUserById(actor.clientUserId);
  if (!user || !user.client_id) return NextResponse.json({ ok: true, items: [] });

  try {
    const db = getAvDb();
    const [rows] = await db.execute<Row[]>(
      `SELECT o.id, o.source, o.outlet, o.topic_tags, o.created_at
         FROM pr_opportunities o
         INNER JOIN leads l ON l.id = o.matched_lead_id
        WHERE l.client_id = ? AND o.created_at >= (NOW() - INTERVAL 30 DAY)
        ORDER BY o.created_at DESC
        LIMIT 8`,
      [user.client_id]
    );
    const items = rows.map((r) => ({
      id: r.id,
      source: r.source,
      outlet: r.outlet,
      topics: tags(r.topic_tags),
      createdAt: r.created_at
    }));
    return NextResponse.json({ ok: true, items });
  } catch {
    return NextResponse.json({ ok: true, items: [] });
  }
}
