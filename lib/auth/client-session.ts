/**
 * Client-portal session cookie helpers.
 *
 * Cookie: ah_client_session
 *   - HttpOnly (no JS access)
 *   - Secure in production
 *   - SameSite=Lax (the client-intake form on atlanticandvine.netlify.app
 *     redirects to atlantic-hub.netlify.app/client/dashboard via magic
 *     link — Strict would break that initial nav. Lax still blocks the
 *     dangerous CSRF cases.)
 *   - Path=/
 *   - Max-Age matches JWT TTL
 *
 * Kept deliberately separate from lib/auth/session.ts so an operator
 * session and a client session cannot accidentally swap surfaces. The
 * middleware reads ONE cookie per path family.
 */
import { cookies } from 'next/headers';

export const CLIENT_SESSION_COOKIE = 'ah_client_session';
const DEFAULT_TTL_SECONDS = 8 * 60 * 60;

export function setClientSessionCookie(token: string, ttlSeconds = DEFAULT_TTL_SECONDS): void {
  cookies().set({
    name: CLIENT_SESSION_COOKIE,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: ttlSeconds
  });
}

export function clearClientSessionCookie(): void {
  cookies().set({
    name: CLIENT_SESSION_COOKIE,
    value: '',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0
  });
}

/**
 * Read actor identity from headers populated by middleware.
 * Returns null if the request did not pass through client-portal middleware.
 */
export function readClientActorFromHeaders(headers: Headers): {
  clientUserId: number;
  sessionId: string;
} | null {
  const userId = headers.get('x-ah-client-user-id');
  const sessionId = headers.get('x-ah-client-session-id');
  if (!userId || !sessionId) return null;
  const parsed = parseInt(userId, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return { clientUserId: parsed, sessionId };
}
