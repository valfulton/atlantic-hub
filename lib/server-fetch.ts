/**
 * Helper for server components: fetch an internal API route while
 * forwarding the inbound request's cookies, so middleware sees the
 * authenticated session.
 *
 * We use absolute URL via the Host header for SSR fetches.
 */
import { cookies, headers } from 'next/headers';

export async function serverFetch(path: string): Promise<Response> {
  const h = headers();
  const host = h.get('host') || 'localhost:3000';
  const proto = h.get('x-forwarded-proto') || (host.startsWith('localhost') ? 'http' : 'https');
  const cookieStr = cookies()
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
  return fetch(`${proto}://${host}${path}`, {
    headers: { cookie: cookieStr },
    cache: 'no-store'
  });
}
