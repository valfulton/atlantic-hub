/**
 * POST /api/admin/av/clients/[client_id]/distress/rescore  (#372)
 *
 * Body: { lookbackDays?: number, seedDefaults?: boolean, packId?: string }
 *
 * Recomputes distress scores for this client. If seedDefaults is true:
 *   - When `packId` is provided, seed that vertical pack's weights.
 *   - Else if the client has a vertical pack associated (via existing
 *     signal_weights heuristic), reuse it.
 *   - Else fall back to the generic library defaults (SIGNAL_LIBRARY
 *     defaultWeight per kind) — NOT the CBB collections shape.
 *
 * (val 2026-06-06) NEVER seed CBB-shaped weights to non-collections clients.
 * AV Real Estate clicking "Seed defaults" must not get bankruptcy_filed=50.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import {
  rescoreClient,
  seedDefaultsForClient,
  SIGNAL_LIBRARY,
  type SignalKind
} from '@/lib/public_intel/distress_engine';
import { getPack, type VerticalPackId } from '@/lib/public_intel/vertical_packs';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** Generic library defaults — every signal kind weighted by its
 *  library defaultWeight. Safe to apply to ANY client because it doesn't
 *  vertical-tune; specific verticals should override via packId. */
function libraryDefaults(): Partial<Record<SignalKind, number>> {
  const out: Partial<Record<SignalKind, number>> = {};
  for (const [kind, meta] of Object.entries(SIGNAL_LIBRARY)) {
    out[kind as SignalKind] = meta.defaultWeight;
  }
  return out;
}

export async function POST(req: NextRequest, { params }: { params: { client_id: string } }) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/clients/distress/rescore:POST',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const clientId = Number.parseInt(params.client_id, 10);
  if (!Number.isFinite(clientId) || clientId <= 0) {
    return NextResponse.json({ error: 'invalid client id' }, { status: 400 });
  }

  let body: { lookbackDays?: unknown; seedDefaults?: unknown; packId?: unknown } = {};
  try { body = (await req.json()) as typeof body; } catch { /* empty fine */ }
  const lookbackDays = typeof body.lookbackDays === 'number' && body.lookbackDays > 0 ? body.lookbackDays : 90;
  const wantSeed = body.seedDefaults === true;
  const packId = typeof body.packId === 'string' ? (body.packId as VerticalPackId) : null;

  let seeded = 0;
  if (wantSeed) {
    // (val 2026-06-06) Pull weights from the vertical pack when one is
    // specified — never hardcode a single vertical's shape across all clients.
    // Fall back to generic library defaults (safe for any vertical).
    const pack = packId ? getPack(packId) : null;
    const weights = pack ? pack.signalWeights : libraryDefaults();
    seeded = await seedDefaultsForClient(clientId, weights);
  }

  const result = await rescoreClient(clientId, lookbackDays);
  return NextResponse.json({ seeded, ...result });
}
