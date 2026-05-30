/**
 * GET / PATCH  /api/admin/av/leads/[audit_id]/intake-draft   (#253 step 5)
 *
 * Per-lead intake draft editor. The smart scraper (intake_web_filler via
 * lib/scraper/smart_lead_scraper.ts) stashes a 12+ field intake-shape draft
 * onto leads.source_payload.lead_intake_draft. Until now that draft was
 * write-only from the UI's perspective — val could see it via the
 * ProspectIntelPanel but couldn't refine it before clicking "Make client",
 * which is where the carryover (#253 step 4) reads it.
 *
 * This endpoint adds the missing edit surface:
 *
 *   GET    -> returns the current draft + an inventory of which canonical
 *             intake keys are populated vs empty, so the panel can show
 *             "8 of 12 fields filled" at a glance.
 *
 *   PATCH  -> body: { fields: { <key>: <string or null> } }. Merges into the
 *             stash via JSON_MERGE_PATCH so unmentioned keys are preserved.
 *             null value -> remove the key (so val can blank out an LLM
 *             hallucination without typing an empty string). Whitespace-only
 *             values get normalized to removal too.
 *
 * Whitelist is INTAKE_KEYS — never write arbitrary keys into the draft. Owner
 * and staff only; client_user is rejected (the draft is operator-only intel).
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { isFlagEnabled } from '@/lib/feature-flags';
import { getAvDb } from '@/lib/db/av';
import { INTAKE_KEYS } from '@/lib/client/intake_fields';
import { logEvent } from '@/lib/events/log';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

export const runtime = 'nodejs';
export const maxDuration = 15;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function asObj(raw: string | object | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Pull lead.source_payload.lead_intake_draft for the audit_id. Returns the
 *  resolved internal lead.id alongside so the PATCH path can write back. */
async function loadDraft(auditId: string): Promise<{ leadId: number; draft: Record<string, unknown> } | null> {
  if (!UUID_RE.test(auditId)) return null;
  const db = getAvDb();
  const [rows] = await db.execute<(RowDataPacket & { id: number; source_payload: string | object | null })[]>(
    `SELECT id, source_payload FROM leads WHERE audit_id = ? AND archived_at IS NULL LIMIT 1`,
    [auditId]
  );
  const r = rows[0];
  if (!r) return null;
  const sp = asObj(r.source_payload);
  const blob = sp['lead_intake_draft'];
  const draft = blob && typeof blob === 'object' && !Array.isArray(blob) ? (blob as Record<string, unknown>) : {};
  return { leadId: r.id, draft };
}

export async function GET(req: NextRequest, { params }: { params: { audit_id: string } }) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/leads/[audit_id]/intake-draft:GET',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  if (!(await isFlagEnabled('tab_av_enabled'))) {
    return NextResponse.json({ error: 'av tab disabled' }, { status: 403 });
  }

  const loaded = await loadDraft(params.audit_id);
  if (!loaded) return NextResponse.json({ error: 'lead not found' }, { status: 404 });

  // Inventory: every canonical intake key with its populated-or-not state,
  // so the panel can render a complete checklist (operator sees what we
  // have AND what we don't have, in the same view).
  const inventory = INTAKE_KEYS.map((key) => {
    const v = loaded.draft[key];
    const populated = typeof v === 'string' && v.trim().length > 0 && !/^\[ask\]?/i.test(v.trim());
    return {
      key,
      value: populated ? (v as string).trim() : null,
      populated
    };
  });
  const populatedCount = inventory.filter((i) => i.populated).length;

  return NextResponse.json({
    ok: true,
    auditId: params.audit_id,
    leadId: loaded.leadId,
    populatedCount,
    totalFieldCount: INTAKE_KEYS.length,
    fields: inventory
  });
}

export async function PATCH(req: NextRequest, { params }: { params: { audit_id: string } }) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/leads/[audit_id]/intake-draft:PATCH',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  if (!(await isFlagEnabled('tab_av_enabled'))) {
    return NextResponse.json({ error: 'av tab disabled' }, { status: 403 });
  }

  if (!UUID_RE.test(params.audit_id)) {
    return NextResponse.json({ error: 'invalid audit_id' }, { status: 400 });
  }

  let body: { fields?: unknown } = {};
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  if (!body.fields || typeof body.fields !== 'object' || Array.isArray(body.fields)) {
    return NextResponse.json({ error: 'fields object required' }, { status: 400 });
  }

  // Whitelist + normalize. Any non-canonical key is silently dropped. Empty
  // strings AND null both signal "remove this key from the draft" so val can
  // blank out a bad LLM value without a separate delete affordance. The
  // "[ask]" sentinel that intake_web_filler emits when it couldn't confidently
  // infer a value also routes to remove — it should never land on the lead.
  const incoming = body.fields as Record<string, unknown>;
  const writes: Record<string, string> = {};
  const removes: string[] = [];
  for (const key of INTAKE_KEYS) {
    if (!(key in incoming)) continue;
    const v = incoming[key];
    if (v === null) { removes.push(key); continue; }
    if (typeof v !== 'string') continue; // unknown type — silently ignore
    const t = v.trim();
    if (t.length === 0 || /^\[ask\]?/i.test(t)) {
      removes.push(key);
    } else {
      writes[key] = t.slice(0, 4000);
    }
  }

  if (Object.keys(writes).length === 0 && removes.length === 0) {
    return NextResponse.json({ error: 'nothing to write or remove' }, { status: 400 });
  }

  try {
    const db = getAvDb();

    // First: look up the lead and current draft so the response can return
    // the resulting state without an extra GET round-trip from the UI.
    const loaded = await loadDraft(params.audit_id);
    if (!loaded) return NextResponse.json({ error: 'lead not found' }, { status: 404 });

    // Compose the merged draft + scope it under lead_intake_draft for the
    // JSON_MERGE_PATCH onto source_payload. JSON_REMOVE handles deletes;
    // we run it second so the order of operations is "remove THEN add" —
    // val could legitimately want to replace a bad value in one call.
    const mergedDraft = { ...loaded.draft };
    for (const k of removes) delete mergedDraft[k];
    for (const [k, v] of Object.entries(writes)) mergedDraft[k] = v;

    // Single UPDATE writing the whole draft back. Using JSON_MERGE_PATCH
    // on the outer source_payload preserves every other key (apollo metadata,
    // places metadata, instagram metadata, brand_kit stash, etc) — only the
    // `lead_intake_draft` key is replaced.
    const patch = JSON.stringify({ lead_intake_draft: mergedDraft });
    await db.execute<ResultSetHeader>(
      `UPDATE leads
          SET source_payload = JSON_MERGE_PATCH(COALESCE(source_payload, JSON_OBJECT()), CAST(? AS JSON)),
              last_activity_at = NOW()
        WHERE id = ?`,
      [patch, loaded.leadId]
    );

    await logEvent({
      eventType: 'lead.intake_draft_edited',
      leadId: loaded.leadId,
      userId: guard.actor.userId,
      source: 'operator',
      status: 'success',
      payload: {
        written_keys: Object.keys(writes),
        removed_keys: removes
      }
    });

    // Return the resulting inventory so the UI can update without refetch.
    const inventory = INTAKE_KEYS.map((key) => {
      const v = mergedDraft[key];
      const populated = typeof v === 'string' && v.trim().length > 0 && !/^\[ask\]?/i.test(v.trim());
      return { key, value: populated ? (v as string).trim() : null, populated };
    });
    return NextResponse.json({
      ok: true,
      auditId: params.audit_id,
      leadId: loaded.leadId,
      writtenKeys: Object.keys(writes),
      removedKeys: removes,
      populatedCount: inventory.filter((i) => i.populated).length,
      totalFieldCount: INTAKE_KEYS.length,
      fields: inventory
    });
  } catch (err) {
    console.error('[lead:intake-draft:patch]', (err as Error).message);
    return NextResponse.json(
      { error: 'patch failed', detail: (err as Error).message.slice(0, 200) },
      { status: 500 }
    );
  }
}
