/**
 * /api/admin/pr/opportunities
 *
 * GET  -> list opportunities (newest first, optional status filter).
 * POST -> create one opportunity. Two modes:
 *           { mode: 'parse',  rawText, source? }  -> AI parses pasted query text
 *                                                    into a structured row with a
 *                                                    populated why_it_matters.
 *           { mode: 'manual', source, queryText, ... } -> direct create.
 *
 * Owner + staff only. Guarded by the existing /api/admin/* middleware matcher
 * + guardAdminRequest. Part of the PR / Narrative Intelligence Engine (025).
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { getAvDb } from '@/lib/db/av';
import { logEvent } from '@/lib/events/log';
import { parseOpportunity } from '@/lib/pr/drafter';
import {
  DEFAULT_TENANT,
  PR_EVENTS,
  isPrSource,
  type PrSource
} from '@/lib/pr/types';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

export const runtime = 'nodejs';
export const maxDuration = 30;

interface OppRow extends RowDataPacket {
  id: number;
  tenant_id: string;
  source: PrSource;
  outlet: string | null;
  journalist: string | null;
  query_text: string | null;
  topic_tags: unknown;
  why_it_matters: string | null;
  deadline: string | null;
  matched_lead_id: number | null;
  status: string;
  created_by_user_id: number | null;
  created_at: string;
  updated_at: string;
  matched_company?: string | null;
  latest_pitch_id?: number | null;
  latest_pitch_body?: string | null;
  latest_pitch_status?: string | null;
}

function mapOpp(r: OppRow) {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    source: r.source,
    outlet: r.outlet,
    journalist: r.journalist,
    queryText: r.query_text,
    topicTags: Array.isArray(r.topic_tags) ? r.topic_tags : safeJsonArray(r.topic_tags),
    whyItMatters: r.why_it_matters,
    deadline: r.deadline,
    matchedLeadId: r.matched_lead_id,
    matchedCompany: r.matched_company ?? null,
    status: r.status,
    createdByUserId: r.created_by_user_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    latestPitch: r.latest_pitch_id
      ? { id: r.latest_pitch_id, bodyText: r.latest_pitch_body ?? null, status: r.latest_pitch_status ?? null }
      : null
  };
}

function safeJsonArray(v: unknown): string[] {
  if (typeof v !== 'string') return [];
  try {
    const a = JSON.parse(v);
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}

export async function GET(req: NextRequest) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/pr/opportunities', tenantId: 'av' });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const url = new URL(req.url);
  const status = url.searchParams.get('status');
  const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit')) || 100));
  const tenantId = url.searchParams.get('tenant') || DEFAULT_TENANT;

  try {
    const db = getAvDb();
    const where: string[] = ['tenant_id = ?'];
    const vals: unknown[] = [tenantId];
    if (status && ['new', 'drafted', 'submitted', 'won', 'passed'].includes(status)) {
      where.push('status = ?');
      vals.push(status);
    }
    vals.push(limit);
    const [rows] = await db.execute<OppRow[]>(
      `SELECT o.id, o.tenant_id, o.source, o.outlet, o.journalist, o.query_text, o.topic_tags,
              o.why_it_matters, o.deadline, o.matched_lead_id, o.status, o.created_by_user_id,
              o.created_at, o.updated_at,
              l.company AS matched_company,
              p.id AS latest_pitch_id, p.body_text AS latest_pitch_body, p.status AS latest_pitch_status
         FROM pr_opportunities o
         LEFT JOIN leads l ON l.id = o.matched_lead_id
         LEFT JOIN pr_pitches p ON p.id = (
              SELECT p2.id FROM pr_pitches p2
               WHERE p2.opportunity_id = o.id
               ORDER BY p2.id DESC LIMIT 1
         )
        WHERE ${where.map((w) => 'o.' + w).join(' AND ')}
        ORDER BY (o.status = 'new') DESC, COALESCE(o.deadline, '9999-12-31') ASC, o.id DESC
        LIMIT ?`,
      vals
    );
    return NextResponse.json({ ok: true, items: rows.map(mapOpp) });
  } catch (err) {
    console.error('[pr:opportunities:list]', (err as Error).message);
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/pr/opportunities:POST', tenantId: 'av' });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const tenantId = typeof body.tenantId === 'string' && body.tenantId ? body.tenantId.slice(0, 64) : DEFAULT_TENANT;
  const mode = body.mode === 'parse' ? 'parse' : 'manual';

  try {
    let source: PrSource = 'manual';
    let outlet: string | null = null;
    let journalist: string | null = null;
    let queryText: string | null = null;
    let topicTags: string[] = [];
    let deadline: string | null = null;
    let matchedLeadId: number | null = null;
    let whyItMatters: string | null = null;

    if (mode === 'parse') {
      const rawText = typeof body.rawText === 'string' ? body.rawText : '';
      if (rawText.trim().length < 5) {
        return NextResponse.json({ error: 'rawText required for parse mode' }, { status: 400 });
      }
      const sourceHint = isPrSource(body.source) ? body.source : null;
      const parsed = await parseOpportunity({ rawText, sourceHint, tenantId });
      source = parsed.source;
      outlet = parsed.outlet;
      journalist = parsed.journalist;
      queryText = parsed.queryText;
      topicTags = parsed.topicTags;
      deadline = parsed.deadline;
      matchedLeadId = parsed.matchedLeadId;
      whyItMatters = parsed.whyItMatters;
    } else {
      source = isPrSource(body.source) ? body.source : 'manual';
      outlet = strOrNull(body.outlet, 255);
      journalist = strOrNull(body.journalist, 255);
      queryText = strOrNull(body.queryText, 8000);
      topicTags = Array.isArray(body.topicTags)
        ? (body.topicTags as unknown[]).filter((t) => typeof t === 'string').slice(0, 12).map((t) => (t as string).slice(0, 48))
        : [];
      deadline = strOrNull(body.deadline, 30);
      matchedLeadId = typeof body.matchedLeadId === 'number' ? body.matchedLeadId : null;
      whyItMatters = strOrNull(body.whyItMatters, 4000);
      if (!queryText) {
        return NextResponse.json({ error: 'queryText required for manual mode' }, { status: 400 });
      }
    }

    const db = getAvDb();
    const [res] = await db.execute<ResultSetHeader>(
      `INSERT INTO pr_opportunities
         (tenant_id, source, outlet, journalist, query_text, topic_tags,
          why_it_matters, deadline, matched_lead_id, status, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, CAST(? AS JSON), ?, ?, ?, 'new', ?)`,
      [
        tenantId,
        source,
        outlet,
        journalist,
        queryText,
        JSON.stringify(topicTags),
        whyItMatters,
        deadline,
        matchedLeadId,
        guard.actor.userId
      ]
    );
    const id = res.insertId;

    await logEvent({
      eventType: PR_EVENTS.opportunityCreated,
      leadId: matchedLeadId,
      userId: guard.actor.userId,
      source: 'pr_desk',
      payload: { opportunity_id: id, mode, detected_source: source, topic_tags: topicTags }
    });

    const [rows] = await db.execute<OppRow[]>(
      `SELECT id, tenant_id, source, outlet, journalist, query_text, topic_tags,
              why_it_matters, deadline, matched_lead_id, status, created_by_user_id,
              created_at, updated_at
         FROM pr_opportunities WHERE id = ? LIMIT 1`,
      [id]
    );
    return NextResponse.json({ ok: true, item: rows[0] ? mapOpp(rows[0]) : { id } });
  } catch (err) {
    console.error('[pr:opportunities:create]', (err as Error).message);
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}

function strOrNull(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}
