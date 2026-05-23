/**
 * /api/admin/pr/artifacts
 *
 * GET  -> list content_artifacts (most recent first), with the matched company.
 *         Optional ?type=<artifact_type> and ?tenant=<id> filters.
 * POST -> create + draft an artifact in one shot (the "no typing" one-click
 *         action). Body:
 *           { artifactType, leadId?, opportunityId?, topic?, voiceMode? }
 *         Drafts via lib/pr/artifacts (Intelligence Loop: reads the shared
 *         graph, persists derived intelligence back), inserts a content_artifacts
 *         row (status 'draft'), and returns it.
 *
 * Owner + staff only. (/api/admin/* is already guarded by middleware; this also
 * rejects client_user defensively. No middleware change needed for this lane.)
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { getAvDb } from '@/lib/db/av';
import { logEvent } from '@/lib/events/log';
import { draftArtifact } from '@/lib/pr/artifacts';
import { upsertIntelligenceObjects } from '@/lib/pr/drafter';
import {
  DEFAULT_TENANT,
  CONTENT_EVENTS,
  isArtifactType,
  type ArtifactMeta,
  type ArtifactType,
  type ContentArtifact,
  type PitchMode
} from '@/lib/pr/types';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

export const runtime = 'nodejs';
export const maxDuration = 60;

const LIST_LIMIT = 50;

interface ArtifactRow extends RowDataPacket {
  id: number;
  tenant_id: string;
  artifact_type: ArtifactType;
  lead_id: number | null;
  opportunity_id: number | null;
  voice_mode: PitchMode;
  title: string | null;
  body_text: string | null;
  meta_json: unknown;
  model: string | null;
  status: string;
  linked_outbox_id: number | null;
  created_by_user_id: number | null;
  created_at: string;
  updated_at: string;
  matched_company: string | null;
}

function rowToArtifact(r: ArtifactRow): ContentArtifact & { matchedCompany: string | null } {
  let meta: ArtifactMeta | null = null;
  if (r.meta_json != null) {
    try {
      meta = (typeof r.meta_json === 'string' ? JSON.parse(r.meta_json) : r.meta_json) as ArtifactMeta;
    } catch {
      meta = null;
    }
  }
  return {
    id: r.id,
    tenantId: r.tenant_id,
    artifactType: r.artifact_type,
    leadId: r.lead_id,
    opportunityId: r.opportunity_id,
    voiceMode: r.voice_mode,
    title: r.title,
    bodyText: r.body_text,
    metaJson: meta,
    model: r.model,
    status: r.status as ContentArtifact['status'],
    linkedOutboxId: r.linked_outbox_id,
    createdByUserId: r.created_by_user_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    matchedCompany: r.matched_company
  };
}

export async function GET(req: NextRequest) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/pr/artifacts:GET', tenantId: 'av' });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const url = new URL(req.url);
  const typeParam = url.searchParams.get('type');
  const tenantParam = url.searchParams.get('tenant');
  const type = isArtifactType(typeParam) ? typeParam : null;

  try {
    const db = getAvDb();
    const where: string[] = [];
    const params: Array<string> = [];
    if (type) {
      where.push('a.artifact_type = ?');
      params.push(type);
    }
    if (tenantParam) {
      where.push('a.tenant_id = ?');
      params.push(tenantParam);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    // LIST_LIMIT is a fixed integer constant -- inline it (mysql2 + HostGator
    // throws ER_WRONG_ARGUMENTS on a prepared `LIMIT ?`).
    const [rows] = await db.execute<ArtifactRow[]>(
      `SELECT a.id, a.tenant_id, a.artifact_type, a.lead_id, a.opportunity_id, a.voice_mode,
              a.title, a.body_text, a.meta_json, a.model, a.status, a.linked_outbox_id,
              a.created_by_user_id, a.created_at, a.updated_at,
              l.company AS matched_company
         FROM content_artifacts a
         LEFT JOIN leads l ON l.id = a.lead_id
         ${whereSql}
        ORDER BY a.id DESC
        LIMIT ${LIST_LIMIT}`,
      params
    );
    return NextResponse.json({ items: rows.map(rowToArtifact) });
  } catch (err) {
    console.error('[pr:artifacts:list]', (err as Error).message);
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/pr/artifacts:POST', tenantId: 'av' });
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

  if (!isArtifactType(body.artifactType)) {
    return NextResponse.json({ error: 'artifactType must be one of blog_article, seo_article, own_brand_post, client_deliverable' }, { status: 400 });
  }
  const artifactType = body.artifactType;
  const tenantId = typeof body.tenant === 'string' && body.tenant.trim() ? body.tenant.trim().slice(0, 64) : DEFAULT_TENANT;
  const leadId = typeof body.leadId === 'number' && Number.isFinite(body.leadId) ? body.leadId : null;
  const opportunityId = typeof body.opportunityId === 'number' && Number.isFinite(body.opportunityId) ? body.opportunityId : null;
  const topic = typeof body.topic === 'string' ? body.topic : null;
  const voiceMode =
    body.voiceMode === 'advisory' || body.voiceMode === 'congratulatory' || body.voiceMode === 'client_voice'
      ? (body.voiceMode as PitchMode)
      : undefined;

  try {
    const drafted = await draftArtifact({ artifactType, tenantId, leadId, topic, voiceMode });
    // draftArtifact degrades to a tenant-level piece when the supplied lead is
    // gone; persist the lead it actually used so we never store a dangling id.
    const storedLeadId = drafted.effectiveLeadId;

    const db = getAvDb();
    const [ins] = await db.execute<ResultSetHeader>(
      `INSERT INTO content_artifacts
         (tenant_id, artifact_type, lead_id, opportunity_id, voice_mode, title, body_text,
          meta_json, model, status, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), ?, 'draft', ?)`,
      [
        tenantId,
        artifactType,
        storedLeadId,
        opportunityId,
        drafted.voiceMode,
        drafted.title || null,
        drafted.bodyText,
        JSON.stringify(drafted.metaJson ?? {}),
        drafted.model,
        guard.actor.userId
      ]
    );
    const id = ins.insertId;

    // Compound the intelligence graph: persist anything the drafter derived.
    const written = await upsertIntelligenceObjects({
      tenantId,
      leadId: storedLeadId,
      objects: drafted.derivedObjects,
      source: 'pr_artifact'
    });

    await logEvent({
      eventType: CONTENT_EVENTS.artifactDrafted,
      leadId: storedLeadId,
      userId: guard.actor.userId,
      source: 'pr_desk',
      payload: {
        artifact_id: id,
        artifact_type: artifactType,
        voice_mode: drafted.voiceMode,
        intelligence_objects_written: written,
        grounded_on_intelligence: drafted.groundedOnIntelligence
      }
    });

    const item: ContentArtifact & { matchedCompany: string | null } = {
      id,
      tenantId,
      artifactType,
      leadId: storedLeadId,
      opportunityId,
      voiceMode: drafted.voiceMode,
      title: drafted.title || null,
      bodyText: drafted.bodyText,
      metaJson: drafted.metaJson,
      model: drafted.model,
      status: 'draft',
      linkedOutboxId: null,
      createdByUserId: guard.actor.userId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      matchedCompany: null
    };

    return NextResponse.json({
      ok: true,
      item,
      groundedOnIntelligence: drafted.groundedOnIntelligence,
      intelligenceObjectsWritten: written
    });
  } catch (err) {
    console.error('[pr:artifacts:create]', (err as Error).message);
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}
