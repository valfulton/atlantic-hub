/**
 * lib/client/intake_extract.ts
 *
 * Intake -> canonical intelligence. This is how a client's intake STOPS being
 * dead notes and becomes reusable strategic intelligence the whole hub consumes.
 *
 * One holistic LLM pass (System Constitution section 5, "Intake Extraction"):
 * read the client's full intake/brief payload, emit ONLY canonical
 * `intelligence_objects` types (section 2 registry), and UPSERT them via the
 * existing `upsertIntelligenceObjects` so re-running strengthens instead of
 * duplicating. No per-field hardcoded parsers.
 *
 * Tenancy: client-scoped intelligence is stored under tenant_id = `client:<id>`
 * (the Constitution's tenancy convention) with lead_id NULL.
 *
 * The prompt is operator-visible/editable in the registry under
 * `intake_intelligence_extractor`, so val can QC it before it spends.
 */
import { getBriefPayload } from '@/lib/client/brief_store';
import { parseOpenAIJson } from '@/lib/llm/parse';
import { runLlm } from '@/lib/llm/router';
import { getSystemPrompt } from '@/lib/ai/prompt_registry';
import { upsertIntelligenceObjects } from '@/lib/pr/drafter';
import { INTELLIGENCE_OBJECT_TYPES } from '@/lib/pr/types';
import { logEvent } from '@/lib/events/log';
import type { DerivedIntelligenceObject } from '@/lib/pr/types';

// (#361) Model decided by lib/llm/types.ts TASK_MODEL['intake_intel_extract'].

// Canonical types extraction may emit. `pain_point_profile` is excluded: per the
// Constitution it lives on `leads`, not in this store.
const EXTRACTABLE_TYPES = new Set<string>(
  (INTELLIGENCE_OBJECT_TYPES as readonly string[]).filter((t) => t !== 'pain_point_profile')
);

export interface IntakeExtractionResult {
  ok: boolean;
  reason?: 'no_intake' | 'empty' | 'parse_error';
  written: number;
  objectTypes: string[];
}

function clampConfidence(c: unknown): number | null {
  if (typeof c !== 'number' || !Number.isFinite(c)) return null;
  return Math.max(0, Math.min(100, Math.round(c)));
}

/** Does this payload have any real answers worth extracting from? */
function hasSubstance(payload: Record<string, unknown>): boolean {
  let chars = 0;
  for (const v of Object.values(payload)) {
    if (typeof v === 'string') chars += v.trim().length;
    else if (Array.isArray(v)) chars += v.join(' ').length;
    if (chars > 40) return true;
  }
  return false;
}

/**
 * Extract canonical intelligence objects from a client's intake and persist them.
 * tenantId defaults to 'av' for the intake SOURCE lookup (briefs/intake live under
 * the av tenant + clientId); the OBJECTS are written under tenant `client:<id>`.
 */
export async function extractIntakeIntelligence(args: {
  clientId: number;
  sourceTenantId?: string;
  actorUserId?: number | null;
}): Promise<IntakeExtractionResult> {
  const { clientId } = args;
  const sourceTenant = args.sourceTenantId ?? 'av';
  const started = Date.now();

  let payload: Record<string, unknown> = {};
  try {
    payload = (await getBriefPayload(sourceTenant, clientId)) ?? {};
  } catch {
    payload = {};
  }
  if (!payload || !hasSubstance(payload)) {
    return { ok: false, reason: 'no_intake', written: 0, objectTypes: [] };
  }

  const systemPrompt = await getSystemPrompt('intake_intelligence_extractor');
  const userPrompt = [
    `CLIENT_INTAKE (JSON — all answers this client has given):`,
    JSON.stringify(payload).slice(0, 12000),
    ``,
    `Now produce the JSON object specified.`
  ].join('\n');

  let completion;
  try {
    // (#361) Event-cached on intake payload hash — brief edit = fresh extraction.
    const briefStamp = JSON.stringify(payload).slice(0, 500);
    completion = await runLlm({
      taskKind: 'intake_intel_extract',
      clientId,
      note: `intake_intel_extract · client ${clientId}`,
      prompt: `SYSTEM:\n${systemPrompt}\n\nUSER:\n${userPrompt}`,
      cacheKeyExtras: [String(clientId), briefStamp, systemPrompt.slice(0, 200)],
      temperature: 0.3,
      maxTokens: 1300,
      json: true
    });
  } catch (err) {
    await logEvent({
      eventType: 'ai.intake_extract_failed',
      source: 'llm_router',
      status: 'failure',
      errorMessage: (err as Error).message,
      payload: { client_id: clientId }
    });
    throw err;
  }

  const parsed = parseOpenAIJson<{
    objects?: Array<{ object_type?: string; object_json?: unknown; confidence?: number }>;
  }>(completion.text);

  const raw = Array.isArray(parsed?.objects) ? parsed!.objects : [];
  const objects: DerivedIntelligenceObject[] = [];
  for (const item of raw) {
    if (!item || typeof item.object_type !== 'string') continue;
    if (!EXTRACTABLE_TYPES.has(item.object_type)) continue; // canonical only
    if (item.object_json == null) continue;
    objects.push({
      objectType: item.object_type as DerivedIntelligenceObject['objectType'],
      objectJson: item.object_json,
      confidence: clampConfidence(item.confidence)
    });
    if (objects.length >= 12) break;
  }

  if (objects.length === 0) {
    await logEvent({
      eventType: 'ai.intake_extracted',
      source: 'openai',
      executionTimeMs: Date.now() - started,
      payload: { client_id: clientId, written: 0, model: completion.model, tokens: completion.inputTokens + completion.outputTokens }
    });
    return { ok: true, reason: 'empty', written: 0, objectTypes: [] };
  }

  const written = await upsertIntelligenceObjects({
    tenantId: `client:${clientId}`,
    leadId: null,
    objects,
    source: 'intake_extraction'
  });

  await logEvent({
    eventType: 'ai.intake_extracted',
    source: 'openai',
    executionTimeMs: Date.now() - started,
    payload: {
      client_id: clientId,
      written,
      object_types: objects.map((o) => o.objectType),
      model: completion.model,
      tokens: completion.inputTokens + completion.outputTokens,
      cost_microcents: completion.costMicrocents,
      cost_source: completion.source
    }
  });

  return { ok: true, written, objectTypes: objects.map((o) => o.objectType) };
}
