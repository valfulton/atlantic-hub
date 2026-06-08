/**
 * /api/admin/av/clients/[client_id]/dossier  (#521, val 2026-06-08)
 *
 * Operator-only Due Diligence dossier CRUD.
 *
 *   GET    — return current dossier (empty if none exists).
 *   POST   — save patch (merges with current). Body shape:
 *              {
 *                personalAddress?: string|null,
 *                dobYear?: number|null,
 *                priorEntities?: string|null,
 *                spouseOrCosignerName?: string|null,
 *                notesMd?: string|null,
 *                redFlags?: RedFlag[]  // full replacement
 *              }
 *
 * Server-side role guard: client_user role explicitly rejected. The dossier
 * is operator-only — it must NEVER be reachable by anyone in a client
 * session, even via a misclicked link.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { getDossier, saveDossier, type RedFlag, type DossierAddress } from '@/lib/av/client_dossier';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface SaveBody {
  personalAddress?: string | null;
  /** (#524) Full history replacement. The panel sends the updated list after
   *  an add/remove. Newer entries unshift to position 0. */
  addressHistory?: DossierAddress[];
  dobYear?: number | null;
  priorEntities?: string | null;
  spouseOrCosignerName?: string | null;
  notesMd?: string | null;
  redFlags?: RedFlag[];
}

function parseClientId(s: string): number | null {
  const n = Number.parseInt(s, 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

export async function GET(req: NextRequest, { params }: { params: { client_id: string } }) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/clients/[client_id]/dossier:GET',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const clientId = parseClientId(params.client_id);
  if (clientId == null) return NextResponse.json({ error: 'invalid client_id' }, { status: 400 });

  const dossier = await getDossier(clientId);
  return NextResponse.json({ ok: true, dossier });
}

export async function POST(req: NextRequest, { params }: { params: { client_id: string } }) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/clients/[client_id]/dossier:POST',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const clientId = parseClientId(params.client_id);
  if (clientId == null) return NextResponse.json({ error: 'invalid client_id' }, { status: 400 });

  let body: SaveBody;
  try { body = (await req.json()) as SaveBody; }
  catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }

  // Sanitize: clamp string lengths to keep payload sane.
  const clamp = (s: string | null | undefined, n: number) =>
    typeof s === 'string' ? s.slice(0, n) : s === null ? null : undefined;

  // (#524) Address history: trust the panel-supplied array but clamp + dedup
  // before persistence.
  const cleanHistory = Array.isArray(body.addressHistory)
    ? body.addressHistory
        .filter((a): a is DossierAddress =>
          a != null && typeof a === 'object'
          && typeof a.id === 'string'
          && typeof a.address === 'string'
          && typeof a.source === 'string'
          && a.address.trim().length > 0)
        .map((a) => ({
          id: a.id,
          address: a.address.slice(0, 500),
          source: a.source.slice(0, 64),
          captured_at: typeof a.captured_at === 'string' ? a.captured_at : new Date().toISOString(),
          label: a.label ? String(a.label).slice(0, 200) : null,
          notes: a.notes ? String(a.notes).slice(0, 1000) : null
        }))
        .slice(0, 50)
    : undefined;

  const ok = await saveDossier(
    clientId,
    {
      personalAddress: clamp(body.personalAddress, 500),
      addressHistory: cleanHistory,
      dobYear: typeof body.dobYear === 'number' && body.dobYear >= 1900 && body.dobYear <= 2030 ? body.dobYear : (body.dobYear === null ? null : undefined),
      priorEntities: clamp(body.priorEntities, 2000),
      spouseOrCosignerName: clamp(body.spouseOrCosignerName, 200),
      notesMd: clamp(body.notesMd, 16_000),
      redFlags: Array.isArray(body.redFlags) ? body.redFlags.slice(0, 200) : undefined
    },
    { updatedBy: guard.actor.userId ? `user:${guard.actor.userId}` : 'operator' }
  );

  if (!ok) return NextResponse.json({ error: 'save failed' }, { status: 500 });
  const dossier = await getDossier(clientId);
  return NextResponse.json({ ok: true, dossier });
}
