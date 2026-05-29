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
 *     paths: /client/dashboard, /client/audit, /client/leads, /client/set-password,
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

/**
 * Public webhook receivers that live UNDER /api/admin/* for code-organization
 * reasons but are called by external services (Clay, etc.) that have no
 * operator session cookie. They authenticate themselves inside the route
 * handler via a shared-secret header, so they must skip the admin session
 * wall here. Add future inbound webhooks to this set.
 */
const PUBLIC_WEBHOOK_PATHS = new Set<string>([
  '/api/admin/av/integrations/clay-webhook',
  // PR inbox inbound-parse webhook (PR@api.atlanticandvine.com). Authenticates
  // via X-Webhook-Secret (PR_INBOUND_EMAIL_SECRET) inside the handler; no
  // operator session. See app/api/admin/pr/inbound/email/route.ts.
  '/api/admin/pr/inbound/email',
  // Social publisher cron target. Called by netlify/functions/social-publish-cron.mts
  // with no operator session; authenticates via X-Cron-Secret
  // (SOCIAL_PUBLISH_CRON_SECRET) inside the handler. See
  // app/api/admin/social/publish-due/route.ts.
  '/api/admin/social/publish-due',
  // PR discovery cadence cron target. Called by netlify/functions/pr-discovery-cron.mts
  // every 2h with no operator session; authenticates via X-Cron-Secret
  // (ENRICHMENT_CRON_SECRET) inside the handler. See
  // app/api/admin/pr/discover-sweep/route.ts.
  '/api/admin/pr/discover-sweep',
  // Pain-extraction sweep: cron target + manual backfill trigger. Dual-mode auth
  // (X-Cron-Secret = ENRICHMENT_CRON_SECRET, or admin session) lives in the handler.
  // WITHOUT this exemption middleware 401s the cron before the secret check runs --
  // which is why pain_point_profile was never getting populated. See
  // app/api/admin/av/pain-sweep/route.ts. (score-sweep has the same latent gap.)
  '/api/admin/av/pain-sweep',
  // Cron-secret sweep targets (dual-mode auth in each handler). These were the
  // "latent gap" — not exempted, so middleware 401'd the cron before the secret
  // check, meaning they never ran via cron. Now exempted (each validates
  // x-cron-secret == ENRICHMENT_CRON_SECRET internally).
  '/api/admin/av/score-sweep',
  '/api/admin/av/enrich',
  '/api/admin/av/nurture-wake',
  '/api/admin/av/outreach/replies/poll',
  // Cron dispatcher (#73): one HostGator cron pings this; it fans out to the
  // sweep endpoints above. Validates x-cron-secret internally.
  '/api/admin/cron/run'
]);

export const config = {
  matcher: [
    // Operator surface
    '/admin/:path*',
    '/api/admin/:path*',
    // Client portal pages (protected)
    '/client/dashboard/:path*',
    '/client/audit/:path*',
    '/client/leads/:path*',
    '/client/intake/:path*',
    // (#220) Client-facing PR pipeline.
    '/client/pr/:path*',
    '/client/set-password',
    // Client portal APIs (protected)
    '/api/client/me',
    '/api/client/set-password',
    '/api/client/logout',
    '/api/client/discover',
    '/api/client/intake-update',
    '/api/client/ticker',
    // Multi-brand (#101): switch the active brand for an owner spanning brands.
    '/api/client/active-brand',
    // All client lead APIs (reject, calls, future notes) — wildcard so each
    // receives x-ah-client-user-id and rejects anonymous callers.
    '/api/client/leads/:path*',
    // (#220) Client PR approval endpoint — same guard.
    '/api/client/pr/:path*',
    // Client campaign actions (publish own approved content). Guarded so the
    // route receives x-ah-client-user-id and rejects anonymous callers.
    '/api/client/campaign/:path*'
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

  // Inbound webhooks authenticate via their own shared-secret header inside
  // the route handler. They have no operator session, so let them through the
  // middleware untouched. The route still rejects anything without the secret.
  if (PUBLIC_WEBHOOK_PATHS.has(pathname)) {
    return NextResponse.next();
  }

  // (#226) Per-client PR inbox: /api/pr/inbox/<slug>. The slug IS the auth.
  // Slugs are 72-bit-entropy random strings stored in clients.pr_inbox_slug;
  // the route returns 404 for any unknown value. Prefix-matched so every
  // per-client slug routes through without an explicit allow-list entry.
  if (pathname.startsWith('/api/pr/inbox/')) {
    return NextResponse.next();
  }

  // Social OAuth callbacks return from a third-party provider (LinkedIn / X)
  // as a cross-site top-level navigation, so the SameSite=Strict operator
  // session cookie is NOT sent and we would 401 here. The callback instead
  // authenticates the actor from the short-lived httpOnly state cookie it set
  // during /start (which WAS guarded by an operator session). Let ONLY the
  // /callback paths through; /start, /connections, and everything else under
  // /api/admin/social stay fully guarded below.
  if (
    pathname.startsWith('/api/admin/social/oauth/') &&
    pathname.endsWith('/callback')
  ) {
    return NextResponse.next();
  }

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
