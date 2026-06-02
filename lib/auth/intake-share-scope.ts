/**
 * lib/auth/intake-share-scope.ts  (#45 Phase B)
 *
 * Server-side helper for client-facing intake routes that authenticate via
 * the share token (passed in the `x-intake-share-token` header). Given the
 * request + a requested brand id, returns the effective client_id we are
 * allowed to act on -- or null if the token is invalid / the brand isn't
 * in scope.
 *
 * Single-brand token: must match the requested brand (or no brand override).
 * Owner-scoped token: requested brand must be in the owner's membership list,
 * else falls back to the first allowed brand.
 *
 * Centralized so API routes don't drift on auth logic.
 */
import { resolveIntakeShareToken } from '@/lib/auth/intake-share';
import { listBrandsForUser } from '@/lib/client/membership';
import { findClientUserById } from '@/lib/auth/client-user';

export interface ResolvedScope {
  clientId: number;
}

export async function resolveScopeFromRequest(
  headersFn: { get(name: string): string | null },
  requestedBrandId: number | null
): Promise<ResolvedScope | null> {
  const token = headersFn.get('x-intake-share-token');
  if (!token) return null;
  const scope = await resolveIntakeShareToken(token);
  if (scope.kind === 'invalid') return null;

  if (scope.kind === 'single') {
    if (requestedBrandId && requestedBrandId !== scope.clientId) return null;
    return { clientId: scope.clientId };
  }

  // owner-scoped
  const memberships = await listBrandsForUser(scope.clientUserId);
  const allowed = memberships.map((m) => m.clientId);
  if (allowed.length === 0) {
    // Fall back to client_users.client_id (single-brand login that uses the
    // owner-scoped token shape).
    const u = await findClientUserById(scope.clientUserId);
    if (u?.client_id) return { clientId: u.client_id };
    return null;
  }
  if (requestedBrandId && allowed.includes(requestedBrandId)) {
    return { clientId: requestedBrandId };
  }
  return { clientId: allowed[0] };
}
