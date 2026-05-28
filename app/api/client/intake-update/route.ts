/**
 * POST /api/client/intake-update
 *
 * The logged-in client saves edits to their own business details (the brief the
 * operator prefilled). Writes to the canonical brief store for their client_id
 * with source 'client_intake', so:
 *   - the previous version is snapshotted as a RESTORE POINT first (val can never
 *     lose her good data if the client edits poorly), and
 *   - the same audit / thesis / PR prompts that read the brief pick up the edits.
 *
 * Protected by middleware (matcher '/api/client/intake-update' sets
 * x-ah-client-user-id). Client-scoped: a client can only edit their OWN brief.
 */
import { NextRequest, NextResponse } from 'next/server';
import { readClientActorFromHeaders } from '@/lib/auth/client-session';
import { findClientUserById } from '@/lib/auth/client-user';
import { ensureClientHub } from '@/lib/client/provision';
import { activeBrandFor } from '@/lib/client/active-brand';
import { saveBriefPayload, type BriefPayload } from '@/lib/client/brief_store';
import { suggestIcpFromIntake, getClientIcpWithProvenance, saveClientIcp, mergeIntakeIcp } from '@/lib/client/icp';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const actor = readClientActorFromHeaders(req.headers);
  if (!actor) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const user = await findClientUserById(actor.clientUserId);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let clientId = user.client_id;
  if (!clientId) {
    try { clientId = await ensureClientHub(user); } catch { clientId = null; }
  }
  // Multi-brand (#101): save to the brand the owner is currently viewing.
  clientId = await activeBrandFor(actor.clientUserId, clientId);
  if (!clientId) return NextResponse.json({ error: 'no client hub' }, { status: 409 });

  let body: { payload?: unknown } = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }
  if (!body.payload || typeof body.payload !== 'object' || Array.isArray(body.payload)) {
    return NextResponse.json({ error: 'payload must be an object' }, { status: 400 });
  }

  try {
    // Stamp the client's OWN completion. This is the gate key: a client cannot
    // reach the hub (dashboard/leads/audit) until this is set — i.e. until THEY
    // have filled and submitted the intake (operator prefill alone never sets it).
    const payload = body.payload as Record<string, unknown>;
    payload.client_completed_at = new Date().toISOString();

    const ok = await saveBriefPayload('av', clientId, payload as BriefPayload, {
      source: 'client_intake',
      changedBy: user.email
    });
    if (!ok) return NextResponse.json({ error: 'save failed' }, { status: 500 });

    // Keep the ICP in step with the edited intake (merge-preserving: operator
    // excludes survive, new geo/notes repopulate). Non-fatal. Mirrors the public
    // /api/client/intake path so both entry points sync targeting the same way.
    try {
      const suggested = suggestIcpFromIntake(payload);
      const { icp: existingIcp, provenance: priorProv } = await getClientIcpWithProvenance(clientId);
      const { icp: mergedIcp, provenance } = mergeIntakeIcp(existingIcp, suggested, priorProv);
      await saveClientIcp(clientId, mergedIcp, null, provenance);
    } catch (icpErr) {
      console.error('[client-portal:intake-update] icp refresh skipped:', (icpErr as Error).message);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}
