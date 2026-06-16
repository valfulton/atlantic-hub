/**
 * POST /api/client/ic-application  (val 2026-06-16, #701)
 *
 * A logged-in client_user signals interest in becoming an A&V Independent
 * Contractor. Pitch + tier preference + phone. Server snapshots their
 * display_name + email at apply-time so the application is readable later
 * even if the client_user row is renamed. Duplicate-pending submissions
 * return the existing row id (no error).
 */
import { NextRequest, NextResponse } from 'next/server';
import { readClientActorFromHeaders } from '@/lib/auth/client-session';
import { findClientUserById } from '@/lib/auth/client-user';
import { activeBrandFor } from '@/lib/client/active-brand';
import { createIcApplication, type TierPref } from '@/lib/ic/applications';

export const runtime = 'nodejs';

const TIER_OK: TierPref[] = ['caller', 'manager', 'referrer', 'any'];

export async function POST(req: NextRequest) {
  const actor = readClientActorFromHeaders(req.headers);
  if (!actor) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const user = await findClientUserById(actor.clientUserId);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let payload: { tierPref?: unknown; pitch?: unknown; phone?: unknown } = {};
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const tierRaw = typeof payload.tierPref === 'string' ? payload.tierPref : 'any';
  const tierPref: TierPref = (TIER_OK as string[]).includes(tierRaw) ? (tierRaw as TierPref) : 'any';
  const pitch = typeof payload.pitch === 'string' ? payload.pitch.trim().slice(0, 4000) : null;
  const phone = typeof payload.phone === 'string' ? payload.phone.trim().slice(0, 40) : null;

  const appliedFromClientId = await activeBrandFor(actor.clientUserId, user.client_id ?? null);

  const id = await createIcApplication({
    clientUserId: actor.clientUserId,
    displayName: user.display_name ?? null,
    email: user.email ?? null,
    phone,
    tierPref,
    pitch: pitch && pitch.length > 0 ? pitch : null,
    appliedFromClientId: appliedFromClientId ?? null
  });

  if (!id) return NextResponse.json({ error: 'insert failed' }, { status: 500 });
  return NextResponse.json({ ok: true, applicationId: id });
}
