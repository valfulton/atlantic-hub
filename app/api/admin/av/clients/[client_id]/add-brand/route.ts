/**
 * POST /api/admin/av/clients/[client_id]/add-brand
 *
 * Multi-brand (#101): add ANOTHER brand under the SAME owner login as the given
 * client account — no second login. [client_id] identifies an existing owner's
 * account; we resolve the login on it and attach a new brand to that person.
 * Owner + staff only.
 *
 * Body: { name* (or company*), industry?, tier?, trialDays?, + optional brief keys }
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { isFlagEnabled } from '@/lib/feature-flags';
import { getAvDb } from '@/lib/db/av';
import { addBrandForOwner } from '@/lib/av/add_brand';
import type { ClientTier } from '@/lib/client-portal/tiers';
import type { RowDataPacket } from 'mysql2';

export const runtime = 'nodejs';
export const maxDuration = 30;

const TIERS: ClientTier[] = ['audit_only', 'sprint', 'momentum', 'scale'];
const INTAKE_KEYS = ['key_message', 'target_audience', 'audience_insights', 'why_advertise', 'goals', 'message_support', 'differentiators', 'competitors', 'brand_voice', 'brand_colors', 'preferred_channels', 'timeline', 'founder_story', 'market_position', 'proof_points', 'ideal_client'];

export async function POST(req: NextRequest, { params }: { params: { client_id: string } }) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/av/clients/add-brand:POST', tenantId: 'av' });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (!(await isFlagEnabled('tab_av_enabled'))) return NextResponse.json({ error: 'av tab disabled' }, { status: 403 });

  const ownerClientId = Number.parseInt(params.client_id, 10);
  if (!Number.isFinite(ownerClientId) || ownerClientId <= 0) {
    return NextResponse.json({ error: 'invalid client id' }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; }
  catch { return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 }); }

  const name = typeof body.name === 'string' && body.name.trim()
    ? body.name.trim()
    : (typeof body.company === 'string' ? body.company.trim() : '');
  if (!name) return NextResponse.json({ error: 'a brand name (name or company) is required' }, { status: 400 });

  try {
    const db = getAvDb();
    // Resolve the OWNER login: the client_user linked to this account.
    const [rows] = await db.execute<(RowDataPacket & { client_user_id: number })[]>(
      `SELECT client_user_id FROM client_users
        WHERE client_id = ? AND archived_at IS NULL
        ORDER BY client_user_id ASC LIMIT 1`,
      [ownerClientId]
    );
    const ownerClientUserId = rows[0]?.client_user_id;
    if (!ownerClientUserId) {
      return NextResponse.json({ error: 'no owner login found for this account' }, { status: 404 });
    }

    const intake: Record<string, unknown> = {};
    for (const k of INTAKE_KEYS) if (typeof body[k] === 'string' && (body[k] as string).trim()) intake[k] = body[k];

    const result = await addBrandForOwner({
      ownerClientUserId,
      name,
      industry: typeof body.industry === 'string' ? body.industry : null,
      tier: typeof body.tier === 'string' && TIERS.includes(body.tier as ClientTier) ? (body.tier as ClientTier) : undefined,
      trialDays: typeof body.trialDays === 'number' ? body.trialDays : null,
      intake
    });

    if (!result.clientId) return NextResponse.json({ error: 'could not create the brand' }, { status: 500 });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}
