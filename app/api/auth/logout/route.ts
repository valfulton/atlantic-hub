import { NextRequest, NextResponse } from 'next/server';
import { clearSessionCookie, readActorFromHeaders } from '@/lib/auth/session';
import { writeAuditRow, extractClientIp } from '@/lib/audit';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const actor = readActorFromHeaders(req.headers);
  clearSessionCookie();
  await writeAuditRow({
    actorUserId: actor?.userId ?? null,
    actorRole: actor?.role ?? null,
    targetResource: '/api/auth/logout',
    action: 'logout',
    ip: extractClientIp(req.headers),
    userAgent: req.headers.get('user-agent'),
    statusCode: 200
  });
  return NextResponse.json({ ok: true });
}
