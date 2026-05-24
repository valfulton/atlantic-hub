/**
 * POST /api/admin/av/clients/create
 *
 * Operator creates a client account in one shot: account + magic link + hub +
 * tier/trial + a seeded candidate narrative line. Owner + staff only.
 *
 * Body: { email*, name?, company?, industry?, tier?, trialDays?, sendInvite?,
 *         key_message?, target_audience?, differentiators?, proof_points?, ... }
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { createClientFromOperator } from '@/lib/av/create_client';
import type { ClientTier } from '@/lib/client-portal/tiers';

export const runtime = 'nodejs';
export const maxDuration = 30;

const TIERS: ClientTier[] = ['audit_only', 'sprint', 'momentum', 'scale'];
// Brief fields the operator may pre-fill; everything here lands in intake_payload.
const INTAKE_KEYS = ['key_message', 'target_audience', 'audience_insights', 'why_advertise', 'goals', 'message_support', 'differentiators', 'competitors', 'brand_voice', 'brand_colors', 'preferred_channels', 'timeline', 'founder_story', 'market_position', 'proof_points', 'ideal_client'];

export async function POST(req: NextRequest) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/av/clients/create:POST', tenantId: 'av' });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const email = typeof body.email === 'string' ? body.email.trim() : '';
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: 'a valid email is required' }, { status: 400 });
  }

  const intake: Record<string, unknown> = {};
  for (const k of INTAKE_KEYS) if (typeof body[k] === 'string' && (body[k] as string).trim()) intake[k] = body[k];

  try {
    const result = await createClientFromOperator({
      email,
      name: typeof body.name === 'string' ? body.name : null,
      company: typeof body.company === 'string' ? body.company : null,
      industry: typeof body.industry === 'string' ? body.industry : null,
      tier: typeof body.tier === 'string' && TIERS.includes(body.tier as ClientTier) ? (body.tier as ClientTier) : undefined,
      trialDays: typeof body.trialDays === 'number' ? body.trialDays : null,
      sendInvite: body.sendInvite !== false,
      intake
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}
