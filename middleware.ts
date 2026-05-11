/**
 * =====================================================================
 * Atlantic Hub — Auth Middleware
 * =====================================================================
 * Runs on every request matching the matcher below, BEFORE the route
 * handler. Verifies the `ah_session` JWT and attaches actor identity
 * to downstream request headers.
 *
 * Failure modes:
 *   - No cookie / bad signature / expired → /login (page) or 401 (api)
 *   - admin_login_enabled flag is false → 403 + log
 *
 * IMPORTANT: middleware runs on Edge runtime by default in Next.js.
 * We use `jose` for JWT (Edge-compatible) and avoid Node-only APIs.
 * Database calls (feature flag check, audit log write) happen in the
 * route handlers themselves — not in middleware — to keep this fast.
 * =====================================================================
 */
import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

const SESSION_COOKIE = 'ah_session';

export const config = {
  // Match all protected routes. /login, /api/auth/*, /api/webhooks/*,
  // static files, and the public landing are explicitly excluded.
  matcher: ['/admin/:path*', '/api/admin/:path*']
};

async function verifyJwt(token: string) {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    // Misconfigured deploy — fail closed.
    return null;
  }
  try {
    const key = new TextEncoder().encode(secret);
    const { payload } = await jwtVerify(token, key, {
      issuer: process.env.JWT_ISSUER || 'atlantic-hub',
      algorithms: ['HS256']
    });
    return payload as {
      sub: string;
      role: 'owner' | 'staff' | 'client_user';
      sid: string;
    };
  } catch {
    return null;
  }
}

function isApiRoute(pathname: string): boolean {
  return pathname.startsWith('/api/');
}

function unauthorized(req: NextRequest): NextResponse {
  if (isApiRoute(req.nextUrl.pathname)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const loginUrl = new URL('/login', req.url);
  loginUrl.searchParams.set('next', req.nextUrl.pathname);
  return NextResponse.redirect(loginUrl);
}

export async function middleware(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return unauthorized(req);

  const claims = await verifyJwt(token);
  if (!claims) return unauthorized(req);

  // Attach actor identity for route handlers. These are NEXT-internal
  // headers (x-ah-*) and are stripped before reaching the client.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-ah-user-id', claims.sub);
  requestHeaders.set('x-ah-user-role', claims.role);
  requestHeaders.set('x-ah-session-id', claims.sid);

  return NextResponse.next({ request: { headers: requestHeaders } });
}
