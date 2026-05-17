/**
 * POST /api/client/logout
 *
 * Clears the ah_client_session cookie. Idempotent.
 * Search marker: [client-portal:logout].
 */
import { NextRequest, NextResponse } from 'next/server';
import { clearClientSessionCookie, readClientActorFromHeaders } from '@/lib/auth/client-session';
import { writeAuditRow, extractClientIp } from '@/lib/audit';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const actor = readClientActorFromHeaders(req.headers);
  clearClientSessionCookie();
  await writeAuditRow({
    actorUserId: actor?.clientUserId ?? null,
    actorRole: actor ? 'client_user' : null,
    targetResource: '/api/client/logout',
    action: 'client_logout',
    ip: extractClientIp(req.headers),
    userAgent: req.headers.get('user-agent'),
    statusCode: 200
  });
  return NextResponse.json({ ok: true });
}
