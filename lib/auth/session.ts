/**
 * Session cookie helpers.
 * Cookie: ah_session
 *   - HttpOnly (no JS access)
 *   - Secure (HTTPS only — in dev, browser bypasses on localhost)
 *   - SameSite=Strict (no cross-site sends)
 *   - Path=/
 *   - Max-Age matches JWT TTL
 */
import { cookies } from 'next/headers';

const SESSION_COOKIE = 'ah_session';
const DEFAULT_TTL_SECONDS = 8 * 60 * 60;

export function setSessionCookie(token: string, ttlSeconds = DEFAULT_TTL_SECONDS): void {
  cookies().set({
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: ttlSeconds
  });
}

export function clearSessionCookie(): void {
  cookies().set({
    name: SESSION_COOKIE,
    value: '',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: 0
  });
}

export function readActorFromHeaders(headers: Headers): {
  userId: number;
  role: 'owner' | 'staff' | 'client_user';
  sessionId: string;
} | null {
  const userId = headers.get('x-ah-user-id');
  const role = headers.get('x-ah-user-role');
  const sessionId = headers.get('x-ah-session-id');
  if (!userId || !role || !sessionId) return null;
  return {
    userId: parseInt(userId, 10),
    role: role as 'owner' | 'staff' | 'client_user',
    sessionId
  };
}
