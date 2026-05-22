/**
 * lib/pr/orchestrate.ts
 *
 * The campaign-orchestration bridge: one intent fans out into the whole chain.
 * Given a PR opportunity (and its matched client lead), in ONE call:
 *   1. Draft the pitch (reuse lib/pr/drafter -> grounded in the shared graph;
 *      derived intelligence objects are upserted).
 *   2. OPTIONALLY generate a commercial (image or short video) via the EXISTING
 *      Grok engine (lib/grok/discoverer.generateCommercialForLead) -- we
 *      orchestrate it, we do not reimplement it. The prompt is built by that
 *      engine from the same client intelligence + visual brief.
 *   3. Queue a social_outbox row (with the commercial attached) for the client's
 *      connected provider, so it lands on the Campaign Timeline ready to publish.
 *
 * HONESTY: the social publisher (outbox -> live post) is a separate, not-yet-built
 * session. This QUEUES; it does not post. Callers/UI must say "queued / ready",
 * never "posted". When the publisher ships, queued rows fire with no change here.
 *
 * Links the produced pitch/asset/outbox ids back onto the opportunity so the
 * narrative graph can later trace opportunity -> content -> commercial ->
 * engagement. Emits pr.* events at every hop.
 */

import { getAvDb } from '@/lib/db/av';
import { logEvent } from '@/lib/events/log';
import { draftPitch, upsertIntelligenceObjects } from '@/lib/pr/drafter';
import { generateCommercialForLead } from '@/lib/grok/discoverer';
import { publishOutboxRow } from '@/lib/social/publish';
import { DEFAULT_TENANT, PR_EVENTS, type PitchMode, type PrOpportunity, type PrSource } from '@/lib/pr/types';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

export interface OrchestrateOptions {
  opportunityId: number;
  /** Override the client lead; defaults to the opportunity's matched_lead_id. */
  leadId?: number | null;
  /** Generate a commercial as part of the chain. Default false. */
  makeCommercial?: boolean;
  /** 'image' (fast, synchronous) or 'video'. Default 'image'. */
  assetType?: 'image' | 'video';
  /** Pitch voice; if omitted the drafter resolves it from lead-vs-client. */
  mode?: PitchMode;
  /** ISO datetime to schedule the queued post; null/undefined => draft. */
  scheduledFor?: string | null;
  /** Publish the queued post immediately via the social publisher. Default false. */
  publishNow?: boolean;
  actorUserId?: number | null;
}

export interface OrchestrateResult {
  opportunityId: number;
  pitchId: number;
  bodyText: string;
  commercial: {
    assetId: number;
    assetType: 'image' | 'video';
    mediaUrl: string | null;
    generationStatus: string;
  } | null;
  social: {
    outboxId: number;
    connectionId: number;
    status: 'draft' | 'scheduled' | 'published';
  } | null;
  /** Set when publishNow was requested. */
  published: {
    ok: boolean;
    status: 'published' | 'failed';
    providerUrl: string | null;
    error: string | null;
  } | null;
  /** True when no active social connection exists for the tenant -- post not queued. */
  needsConnection: boolean;
  notes: string[];
}

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
  created_at: string;
  updated_at: string;
}

export class OrchestrateOpportunityNotFoundError extends Error {
  constructor(public opportunityId: number) {
    super(`opportunity ${opportunityId} not found`);
    this.name = 'OrchestrateOpportunityNotFoundError';
  }
}

export async function orchestrateOpportunity(opts: OrchestrateOptions): Promise<OrchestrateResult> {
  const db = getAvDb();
  const actorUserId = opts.actorUserId ?? null;
  const notes: string[] = [];

  const [rows] = await db.execute<OppRow[]>(
    `SELECT id, tenant_id, source, outlet, journalist, query_text, topic_tags,
            why_it_matters, deadline, matched_lead_id, status, created_at, updated_at
       FROM pr_opportunities WHERE id = ? LIMIT 1`,
    [opts.opportunityId]
  );
  const row = rows[0];
  if (!row) throw new OrchestrateOpportunityNotFoundError(opts.opportunityId);

  const tenantId = row.tenant_id || DEFAULT_TENANT;
  const leadId = opts.leadId ?? row.matched_lead_id ?? null;

  const opportunity: PrOpportunity = {
    id: row.id,
    tenantId,
    source: row.source,
    outlet: row.outlet,
    journalist: row.journalist,
    queryText: row.query_text,
    topicTags: Array.isArray(row.topic_tags) ? (row.topic_tags as string[]) : null,
    whyItMatters: row.why_it_matters,
    deadline: row.deadline,
    matchedLeadId: row.matched_lead_id,
    status: row.status as PrOpportunity['status'],
    createdByUserId: null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };

  await logEvent({
    eventType: PR_EVENTS.orchestrationStarted,
    leadId,
    userId: actorUserId,
    source: 'pr_orchestrate',
    payload: { opportunity_id: opportunity.id, make_commercial: !!opts.makeCommercial, asset_type: opts.assetType ?? 'image' }
  });

  // ---- 1. Pitch: reuse the latest (possibly operator-edited) draft if one
  //      exists, otherwise draft fresh. This makes Draft -> edit -> Save ->
  //      queue/publish honor the operator's edits instead of re-drafting. ----
  let pitchId: number;
  let pitchBody: string;
  let whyItMattersRefresh: string | null = null;
  const [existingPitch] = await db.execute<(RowDataPacket & { id: number; body_text: string | null })[]>(
    `SELECT id, body_text FROM pr_pitches
      WHERE opportunity_id = ? AND status = 'draft'
      ORDER BY id DESC LIMIT 1`,
    [opportunity.id]
  );
  if (existingPitch[0] && (existingPitch[0].body_text ?? '').trim()) {
    pitchId = existingPitch[0].id;
    pitchBody = (existingPitch[0].body_text ?? '').trim();
  } else {
    const drafted = await draftPitch({ opportunity, leadId, mode: opts.mode });
    const [pres] = await db.execute<ResultSetHeader>(
      `INSERT INTO pr_pitches (opportunity_id, tenant_id, lead_id, body_text, model, status)
       VALUES (?, ?, ?, ?, ?, 'draft')`,
      [opportunity.id, tenantId, leadId, drafted.bodyText, drafted.model]
    );
    pitchId = pres.insertId;
    pitchBody = drafted.bodyText;
    whyItMattersRefresh = drafted.whyItMatters || null;
    await upsertIntelligenceObjects({ tenantId, leadId, objects: drafted.derivedObjects, source: 'pr_orchestrate' });
  }

  // ---- 2. Optional commercial (existing Grok engine) ----
  let commercial: OrchestrateResult['commercial'] = null;
  const assetType = opts.assetType ?? 'image';
  if (opts.makeCommercial) {
    if (leadId == null) {
      notes.push('No client lead attached, so a commercial was not generated. Match a client first.');
    } else {
      await logEvent({
        eventType: PR_EVENTS.commercialRequested,
        leadId,
        userId: actorUserId,
        source: 'pr_orchestrate',
        payload: { opportunity_id: opportunity.id, asset_type: assetType }
      });
      try {
        const gen = await generateCommercialForLead(leadId, { assetType, actorUserId });
        commercial = {
          assetId: gen.assetId,
          assetType,
          mediaUrl: gen.storageUrl,
          generationStatus: gen.generationStatus
        };
        if (gen.generationStatus === 'running') {
          notes.push('Video is still rendering; the post was queued and the media will attach when it finishes.');
        }
      } catch (err) {
        notes.push(`Commercial generation failed: ${(err as Error).message}. Pitch was still drafted.`);
      }
    }
  }

  // ---- 3. Queue the social post (if a connection exists) ----
  let social: OrchestrateResult['social'] = null;
  let published: OrchestrateResult['published'] = null;
  let needsConnection = false;

  const [conns] = await db.execute<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM social_connections
      WHERE tenant_id = ? AND status = 'active'
      ORDER BY last_used_at DESC, id DESC LIMIT 1`,
    [tenantId]
  );
  const connectionId = conns[0]?.id ?? null;

  if (connectionId == null) {
    needsConnection = true;
    notes.push('No active social connection for this brand, so nothing was queued. Connect an account at /admin/social, then re-run.');
  } else {
    const scheduledFor = opts.scheduledFor ?? null;
    const status: 'draft' | 'scheduled' = scheduledFor ? 'scheduled' : 'draft';
    const mediaType = commercial ? assetType : 'none';
    const mediaUrl = commercial?.mediaUrl ?? null;
    const [ores] = await db.execute<ResultSetHeader>(
      `INSERT INTO social_outbox
         (tenant_id, connection_id, lead_id, asset_id, body_text, media_url, media_type,
          status, scheduled_for, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tenantId,
        connectionId,
        leadId,
        commercial?.assetId ?? null,
        pitchBody,
        mediaUrl,
        mediaType,
        status,
        scheduledFor,
        actorUserId
      ]
    );
    social = { outboxId: ores.insertId, connectionId, status };
    await logEvent({
      eventType: PR_EVENTS.socialQueued,
      leadId,
      userId: actorUserId,
      source: 'pr_orchestrate',
      payload: { opportunity_id: opportunity.id, outbox_id: ores.insertId, status, has_media: !!commercial }
    });

    // Publish immediately if requested (operator clicked "post now").
    if (opts.publishNow) {
      const pub = await publishOutboxRow(ores.insertId);
      published = { ok: pub.ok, status: pub.status, providerUrl: pub.providerUrl, error: pub.error };
      if (pub.ok) {
        social.status = 'published';
        notes.push(pub.providerUrl ? `Posted: ${pub.providerUrl}` : 'Posted to the connected account.');
      } else {
        notes.push(`Publish failed: ${pub.error ?? 'unknown error'}. The post stays queued so you can retry.`);
      }
    }
  }

  // ---- Link the chain back onto the opportunity ----
  await db.execute<ResultSetHeader>(
    `UPDATE pr_opportunities
        SET linked_pitch_id = ?,
            linked_asset_id = COALESCE(?, linked_asset_id),
            linked_outbox_id = COALESCE(?, linked_outbox_id),
            why_it_matters = COALESCE(?, why_it_matters),
            status = CASE WHEN status = 'new' THEN 'drafted' ELSE status END,
            updated_at = NOW()
      WHERE id = ?`,
    [pitchId, commercial?.assetId ?? null, social?.outboxId ?? null, whyItMattersRefresh, opportunity.id]
  );

  return {
    opportunityId: opportunity.id,
    pitchId,
    bodyText: pitchBody,
    commercial,
    social,
    published,
    needsConnection,
    notes
  };
}
