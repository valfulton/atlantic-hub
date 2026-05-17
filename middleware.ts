/**
 * =====================================================================
 * Atlantic Hub - Auth Middleware
 * =====================================================================
 * Runs on every request matching the matcher below, BEFORE the route
 * handler. Verifies the appropriate session JWT and attaches actor
 * identity headers to downstream requests.
 *
 * Two cookie families, completely separate:
 *
 *   ah_session         operator portal (owner / staff)
 *     paths: /admin/*, /api/admin/*
 *     headers: x-ah-user-id, x-ah-user-role, x-ah-session-id
 *
 *   ah_client_session  client portal (client_user)
 *     paths: /client/dashboard, /client/audit, /client/set-password,
 *            /api/client/me, /api/client/set-password,
 *            /api/client/logout
 *     headers: x-ah-client-user-id, x-ah-client-session-id
 *
 * Public client paths (intentionally NOT in the matcher):
 *   /client/login, /client/magic-link
 *   /api/client/intake, /api/client/magic-link/[token],
 *   /api/client/login
 *
 * Failure modes:
 *   - No cookie / bad signature / expired
 *       page paths -> 302 to the right login (/login or /client/login)
 *       api paths  -> 401 JSON
 *
 * IMPORTANT: middleware runs on the Edge runtime by default in Next.js.
 * We use `jose` for JWT (Edge-compatible) and avoid Node-only APIs.
 * Database calls (feature flag check, audit log write) happen in the
 * route handlers themselves, not here, to keep this fast.
 * =====================================================================
 */
import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

const ADMIN_SESSION_COOKIE = 'ah_session';
const CLIENT_SESSION_COOKIE = 'ah_client_session';

export const config = {
  matcher: [
    // Operator surface
    '/admin/:path*',
    '/api/admin/:path*',
    // Client portal pages (protected)
    '/client/dashboard/:path*',
    '/client/audit/:path*',
    '/client/set-password',
    // Client portal APIs (protected)
    '/api/client/me',
    '/api/client/set-password',
    '/api/client/logout'
  ]
};

function isApiRoute(pathname: string): boolean {
  return pathname.startsWith('/api/');
}

function isClientPath(pathname: string): boolean {
  return pathname.startsWith('/client/') || pathname.startsWith('/api/client/');
}

async function verifyJwt(token: string) {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    // Misconfigured deploy -- fail closed.
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

function unauthorizedAdmin(req: NextRequest): NextResponse {
  if (isApiRoute(req.nextUrl.pathname)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const loginUrl = new URL('/login', req.url);
  loginUrl.searchParams.set('next', req.nextUrl.pathname);
  return NextResponse.redirect(loginUrl);
}

function unauthorizedClient(req: NextRequest): NextResponse {
  if (isApiRoute(req.nextUrl.pathname)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const loginUrl = new URL('/client/login', req.url);
  loginUrl.searchParams.set('next', req.nextUrl.pathname);
  return NextResponse.redirect(loginUrl);
}

export async function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname;

  if (isClientPath(pathname)) {
    // Client portal: only the client cookie counts here.
    const token = req.cookies.get(CLIENT_SESSION_COOKIE)?.value;
    if (!token) return unauthorizedClient(req);

    const claims = await verifyJwt(token);
    if (!claims || claims.role !== 'client_user') return unauthorizedClient(req);

    const requestHeaders = new Headers(req.headers);
    requestHeaders.set('x-ah-client-user-id', claims.sub);
    requestHeaders.set('x-ah-client-session-id', claims.sid);
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  // Operator surface (existing behaviour).
  const token = req.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  if (!token) return unauthorizedAdmin(req);

  const claims = await verifyJwt(token);
  if (!claims) return unauthorizedAdmin(req);

  // Defense in depth: a client_user must never be able to use their
  // operator-looking JWT to hit /admin/*. The operator login route only
  // ever issues owner/staff roles, but if a JWT mix-up ever happened we
  // would reject it here.
  if (claims.role === 'client_user') return unauthorizedAdmin(req);

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-ah-user-id', claims.sub);
  requestHeaders.set('x-ah-user-role', claims.role);
  requestHeaders.set('x-ah-session-id', claims.sid);

  return NextResponse.next({ request: { headers: requestHeaders } });
}
