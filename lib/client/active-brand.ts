/**
 * lib/client/active-brand.ts
 *
 * Which brand is a multi-brand owner currently viewing? (#101)
 *
 * A login's "home" brand is client_users.client_id. An owner who spans several
 * brands can switch; the choice rides in the `ah_active_brand` cookie. This
 * resolver returns the EFFECTIVE brand client_id to scope a page to: the cookie's
 * brand IF the person is a member of it, else their home brand. Single-brand
 * logins are unaffected (the cookie is absent / equals home).
 */
import { cookies } from 'next/headers';
import { roleForBrand } from './membership';

export const ACTIVE_BRAND_COOKIE = 'ah_active_brand';

/**
 * The brand to scope this request to. `homeClientId` is the login's own
 * client_users.client_id (pages already have it). Returns homeClientId unless a
 * valid, membership-checked active-brand cookie points elsewhere.
 */
export async function activeBrandFor(clientUserId: number, homeClientId: number | null): Promise<number | null> {
  let requested: number | null = null;
  try {
    const raw = cookies().get(ACTIVE_BRAND_COOKIE)?.value;
    const n = raw ? Number.parseInt(raw, 10) : NaN;
    if (Number.isFinite(n) && n > 0) requested = n;
  } catch {
    /* no cookie store in this context — fall through to home */
  }
  if (requested && requested !== homeClientId) {
    // Only honor it if this person actually belongs to that brand.
    const role = await roleForBrand(clientUserId, requested);
    if (role) return requested;
  }
  return homeClientId;
}
