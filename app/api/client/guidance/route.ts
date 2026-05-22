/**
 * GET /api/client/guidance
 *
 * Returns the calm, ranked guidance feed for the authenticated client:
 * "what matters most right now, and why," with an honest value frame. Reads the
 * cached next_best_moves / momentum_signals intelligence objects and recomposes
 * via the deterministic composer (lib/client/guidance.ts) only when the cache is
 * stale (older than 24h) or `?refresh=1` is passed. See
 * docs/CLAUDE_KICKOFF_CLIENT_INTELLIGENCE.md.
 *
 * AUTH NOTE (important): the middleware matcher in middleware.ts is an explicit
 * allowlist and does NOT include /api/client/guidance, and that file is owned by
 * another track (we must not touch it). So this route AUTHENTICATES ITSELF from
 * the ah_client_session cookie -- it verifies the same HS256 JWT the middleware
 * verifies (jose, JWT_SECRET, JWT_ISSUER) and requires role 'client_user'. This
 * matches the middleware's own verification exactly; it does not widen the auth
 * surface. No operator/cron secret is accepted here -- this is a client surface.
 *
 * CLIENT-FACING GUARDRAILS: this response never contains per-unit AI / inference
 * cost or commercial pricing (CLIENT_FACING_GUARDRAILS.md). The value frames are
 * priority / momentum / timing language only.
 *
 * Search marker: [client-portal:guidance].
 */
import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { findClientUserById } from '@/lib/auth/client-user';
import { getOrComposeClientGuidance, type ClientIdentity } from '@/lib/client/guidance';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CLIENT_SESSION_COOKIE = 'ah_client_session';

/** Verify the client session JWT exactly as middleware does. Returns the client_user_id or null. */
async function authClientUserId(req: NextRequest): Promise<number | null> {
  const token = req.cookies.get(CLIENT_SESSION_COOKIE)?.value;
  if (!token) return null;
  const secret = process.env.JWT_SECRET;
  if (!secret) return null; // fail closed on misconfig
  try {
    const key = new TextEncoder().encode(secret);
    const { payload } = await jwtVerify(token, key, {
      issuer: process.env.JWT_ISSUER || 'atlantic-hub',
      algorithms: ['HS256']
    });
    if ((payload as { role?: string }).role !== 'client_user') return null;
    const id = parseInt(String((payload as { sub?: string }).sub ?? ''), 10);
    return Number.isFinite(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const clientUserId = await authClientUserId(req);
  if (!clientUserId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const user = await findClientUserById(clientUserId);
    if (!user) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const identity: ClientIdentity = {
      clientUserId: user.client_user_id,
      clientId: user.client_id,
      email: user.email,
      tier: user.tier,
      displayName: user.display_name
    };

    const force = req.nextUrl.searchParams.get('refresh') === '1';
    const guidance = await getOrComposeClientGuidance({ client: identity, force });

    // Shape the response for the client surface. Deliberately omit internal
    // fields (tenantId, leadId) -- the client never needs the operator graph keys.
    return NextResponse.json({
      ok: true,
      composed_at: guidance.composedAt,
      from_cache: guidance.fromCache,
      grounded: guidance.grounded,
      momentum: {
        direction: guidance.momentum.direction,
        current: guidance.momentum.current,
        summary: guidance.momentum.summary
      },
      items: guidance.items.map((i) => ({
        rank: i.rank,
        kind: i.kind,
        headline: i.headline,
        why_it_matters: i.whyItMatters,
        why_now: i.whyNow,
        value_frame: i.valueFrame,
        decay_days: i.decayDays ?? null,
        topic: i.topic ?? null
      }))
    });
  } catch (err) {
    console.error('[client-portal:guidance] error:', (err as Error).message);
    return NextResponse.json({ error: 'server error' }, { status: 500 });
  }
}
