/**
 * POST /api/admin/pr/opportunities/[id]/draft
 *
 * The journalist-question -> instant-pitch core. Loads the opportunity, drafts
 * a pitch in the client's voice grounded in accumulated intelligence, persists
 * the pitch (pr_pitches), UPSERTs any derived intelligence objects into the
 * compounding store, refreshes the opportunity's why_it_matters, and advances
 * the opportunity to 'drafted'.
 *
 * Body (optional): { leadId?: number }  -- override the matched client.
 *
 * Owner + staff only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { getAvDb } from '@/lib/db/av';
import { logEvent } from '@/lib/events/log';
import { draftPitch, upsertIntelligenceObjects } from '@/lib/pr/drafter';
import { DEFAULT_TENANT, type PrOpportunity, type PrSource } from '@/lib/pr/types';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

export const runtime = 'nodejs';
export const maxDuration = 60;

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
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/pr/opportunities/[id]/draft:POST',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const oppId = Number.parseInt(params.id, 10);
  if (!Number.isFinite(oppId) || oppId <= 0) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    // empty body is fine
  }
  const leadOverride = typeof body.leadId === 'number' ? body.leadId : null;

  try {
    const db = getAvDb();
    const [rows] = await db.execute<OppRow[]>(
      `SELECT id, tenant_id, source, outlet, journalist, query_text, topic_tags,
              why_it_matters, deadline, matched_lead_id, status, created_by_user_id,
              created_at, updated_at
         FROM pr_opportunities WHERE id = ? LIMIT 1`,
      [oppId]
    );
    const row = rows[0];
    if (!row) return NextResponse.json({ error: 'opportunity not found' }, { status: 404 });

    const opportunity: PrOpportunity = {
      id: row.id,
      tenantId: row.tenant_id || DEFAULT_TENANT,
      source: row.source,
      outlet: row.outlet,
      journalist: row.journalist,
      queryText: row.query_text,
      topicTags: Array.isArray(row.topic_tags) ? (row.topic_tags as string[]) : null,
      whyItMatters: row.why_it_matters,
      deadline: row.deadline,
      matchedLeadId: row.matched_lead_id,
      status: row.status as PrOpportunity['status'],
      createdByUserId: row.created_by_user_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };

    const leadId = leadOverride ?? opportunity.matchedLeadId ?? null;

    const drafted = await draftPitch({ opportunity, leadId });

    // Persist the pitch.
    const [pres] = await db.execute<ResultSetHeader>(
      `INSERT INTO pr_pitches
         (opportunity_id, tenant_id, lead_id, body_text, model, status)
       VALUES (?, ?, ?, ?, ?, 'draft')`,
      [opportunity.id, opportunity.tenantId, leadId, drafted.bodyText, drafted.model]
    );
    const pitchId = pres.insertId;

    // Compound the intelligence graph: persist anything the drafter derived.
    const written = await upsertIntelligenceObjects({
      tenantId: opportunity.tenantId,
      leadId,
      objects: drafted.derivedObjects,
      source: 'pr_pitch'
    });

    // Refresh strategic guidance + advance status.
    await db.execute<ResultSetHeader>(
      `UPDATE pr_opportunities
          SET why_it_matters = ?,
              matched_lead_id = COALESCE(?, matched_lead_id),
              status = CASE WHEN status = 'new' THEN 'drafted' ELSE status END,
              updated_at = NOW()
        WHERE id = ?`,
      [drafted.whyItMatters || opportunity.whyItMatters, leadId, opportunity.id]
    );

    await logEvent({
      eventType: 'pr.pitch.persisted',
      leadId,
      userId: guard.actor.userId,
      source: 'pr_desk',
      payload: {
        opportunity_id: opportunity.id,
        pitch_id: pitchId,
        intelligence_objects_written: written,
        grounded_on_intelligence: drafted.groundedOnIntelligence
      }
    });

    return NextResponse.json({
      ok: true,
      pitch: {
        id: pitchId,
        opportunityId: opportunity.id,
        tenantId: opportunity.tenantId,
        leadId,
        bodyText: drafted.bodyText,
        model: drafted.model,
        status: 'draft'
      },
      whyItMatters: drafted.whyItMatters,
      groundedOnIntelligence: drafted.groundedOnIntelligence,
      intelligenceObjectsWritten: written
    });
  } catch (err) {
    console.error('[pr:opportunities:draft]', (err as Error).message);
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}
