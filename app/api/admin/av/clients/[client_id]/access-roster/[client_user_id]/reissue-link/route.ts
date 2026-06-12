/**
 * POST /api/admin/av/clients/[client_id]/access-roster/[client_user_id]/reissue-link
 *
 * Mints a fresh 24h magic_token for the named client_user, returns the full
 * URL. The OLD token is invalidated by the same UPDATE — anyone holding the
 * previous link gets an expired-token response when they try to consume it.
 *
 * Used by the Access Roster panel's per-row Regenerate button. Operator-only.
 *
 * We don't sanity-check that the client_user belongs to this client, because
 * collaborators by design span clients (Adriana's primary is CBB but she's
 * a collaborator on a Johnson case under client #18). The roster on the page
 * already filtered down to ONLY users who can access this client.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { issueFreshMagicLink } from '@/lib/av/access_roster';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: { client_id: string; client_user_id: string };
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const guard = await guardAdminRequest(req, {
    targetResource: `access_roster_reissue:${ctx.params.client_user_id}`,
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
  }

  const clientUserId = parseInt(ctx.params.client_user_id, 10);
  if (!Number.isFinite(clientUserId) || clientUserId <= 0) {
    return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 });
  }

  const result = await issueFreshMagicLink(clientUserId);
  if (!result.ok) {
    return NextResponse.json(result, { status: 500 });
  }
  return NextResponse.json(result);
}
