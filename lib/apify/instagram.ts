/**
 * Apify Instagram Profile Scraper client.
 *
 * Why this exists: many USVI boutique businesses (charter captains, beach
 * bars, dive shops, wedding photographers) live on Instagram, not on a
 * website. Their bio often contains the only contact channel — booking
 * email, phone, or a linktr.ee link. Apollo + Google Places miss them
 * entirely; Instagram is where they actually are.
 *
 * Actor used: apify/instagram-profile-scraper (the canonical Apify-owned one).
 * We invoke it in SYNCHRONOUS mode (run-sync-get-dataset-items) so the API
 * call blocks until the dataset is ready. Typical run for 1-10 usernames:
 * 5-30 seconds. For larger batches use async mode (not implemented here).
 *
 * Auth: Bearer token in Authorization header OR ?token= query param.
 * Reads APIFY_API_TOKEN from process.env.
 *
 * Pricing (as of May 2026): Apify free tier = $5/mo credit. Profile scraper
 * runs are about $0.005/profile, so ~1000 profiles/month free. Once over,
 * upgrade is required and Val's budget guard should kick in.
 *
 * Docs: https://apify.com/apify/instagram-profile-scraper
 *       https://docs.apify.com/api/v2#tag/Actor-runsRun-actor
 */

const APIFY_BASE = 'https://api.apify.com/v2';
const ACTOR_ID = 'apify~instagram-profile-scraper';

export interface InstagramProfile {
  /** Lowercase IG handle */
  username: string;
  fullName: string | null;
  /** Bio text — emails/phones/links often embedded here */
  biography: string | null;
  /** Click-out link in bio. Often a linktr.ee or business site. */
  externalUrl: string | null;
  /** Email parsed by Apify from business profile metadata, if public. */
  businessEmail: string | null;
  businessPhoneNumber: string | null;
  /** Apify's category tag — useful for industry heuristic. */
  businessCategoryName: string | null;
  followersCount: number | null;
  followsCount: number | null;
  postsCount: number | null;
  isBusinessAccount: boolean;
  isVerified: boolean;
  profilePicUrl: string | null;
  profileUrl: string;
}

export class ApifyTokenMissingError extends Error {
  constructor() {
    super('APIFY_API_TOKEN is not set in Netlify environment variables');
    this.name = 'ApifyTokenMissingError';
  }
}

export class ApifyApiError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string) {
    super(`Apify API error ${status}: ${body.slice(0, 200)}`);
    this.name = 'ApifyApiError';
    this.status = status;
    this.body = body;
  }
}

/**
 * Strip a URL or handle to just the lowercase username.
 * Accepts:
 *   - "https://www.instagram.com/foo/"
 *   - "instagram.com/foo"
 *   - "@foo"
 *   - "foo"
 */
export function normalizeInstagramHandle(input: string): string | null {
  if (!input) return null;
  let s = input.trim().toLowerCase();
  if (!s) return null;
  // strip @ prefix
  s = s.replace(/^@/, '');
  // strip url chrome
  s = s.replace(/^https?:\/\//, '').replace(/^www\./, '');
  // strip "instagram.com/" prefix
  s = s.replace(/^instagram\.com\//, '');
  // strip trailing slash + query
  s = s.split('/')[0].split('?')[0];
  // valid IG handles: alphanumeric, underscore, period
  if (!/^[a-z0-9._]{1,30}$/.test(s)) return null;
  return s;
}

/**
 * Run the Instagram Profile Scraper synchronously for a batch of usernames.
 * Returns one InstagramProfile per username (or one with mostly nulls if the
 * profile doesn't exist / is private / Apify times out).
 *
 * Keep batches small (1-10) so the sync endpoint stays under its 5-minute cap.
 */
export async function apifyInstagramProfiles(usernames: string[]): Promise<InstagramProfile[]> {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) throw new ApifyTokenMissingError();

  const cleaned = Array.from(new Set(
    usernames
      .map((u) => normalizeInstagramHandle(u))
      .filter((u): u is string => !!u)
  ));
  if (cleaned.length === 0) return [];

  // Build the actor input. The actor expects an array of usernames OR
  // an array of profile URLs in "directUrls". Usernames is more reliable.
  const input = {
    usernames: cleaned,
    resultsType: 'details',
    resultsLimit: 1
  };

  const url = `${APIFY_BASE}/acts/${ACTOR_ID}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}&clean=true`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new ApifyApiError(res.status, errBody);
  }

  const items = (await res.json()) as Array<Record<string, unknown>>;
  return items
    .map((it) => mapApifyItemToProfile(it))
    .filter((p): p is InstagramProfile => p !== null);
}

function mapApifyItemToProfile(it: Record<string, unknown>): InstagramProfile | null {
  const username = typeof it.username === 'string' ? it.username.toLowerCase() : null;
  if (!username) return null;
  return {
    username,
    fullName: stringOrNull(it.fullName),
    biography: stringOrNull(it.biography),
    externalUrl: stringOrNull(it.externalUrl ?? it.externalUrlShimmed),
    businessEmail: stringOrNull(it.businessEmail ?? it.public_email),
    businessPhoneNumber: stringOrNull(it.businessPhoneNumber ?? it.public_phone_number),
    businessCategoryName: stringOrNull(it.businessCategoryName ?? it.category_name),
    followersCount: numberOrNull(it.followersCount),
    followsCount: numberOrNull(it.followsCount),
    postsCount: numberOrNull(it.postsCount),
    isBusinessAccount: it.isBusinessAccount === true || it.is_business_account === true,
    isVerified: it.verified === true || it.is_verified === true,
    profilePicUrl: stringOrNull(it.profilePicUrl ?? it.profilePicUrlHD),
    profileUrl: typeof it.url === 'string' ? it.url : `https://www.instagram.com/${username}/`
  };
}

function stringOrNull(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
}
function numberOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Try to pull a plausible business email + phone out of an IG bio.
 * Apify's businessEmail/businessPhoneNumber are only set if the profile is
 * a Business or Creator account AND has filled them in publicly. Most
 * boutique USVI businesses skip that — but they paste email/phone right in
 * the biography string. This regex extracts the first match of each.
 */
export function extractContactFromBio(bio: string | null | undefined): {
  email: string | null;
  phone: string | null;
  bookingUrl: string | null;
} {
  if (!bio) return { email: null, phone: null, bookingUrl: null };
  const emailMatch = bio.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  // Match a phone in common US/intl formats. Loose on purpose; we normalize later.
  const phoneMatch = bio.match(/(\+?\d[\d\s\-().]{8,}\d)/);
  const urlMatch = bio.match(/https?:\/\/\S+/i);
  return {
    email: emailMatch ? emailMatch[0].toLowerCase() : null,
    phone: phoneMatch ? phoneMatch[0].trim() : null,
    bookingUrl: urlMatch ? urlMatch[0].replace(/[.,;)]+$/, '') : null
  };
}

/**
 * Normalize Apify's businessCategoryName ("Restaurant", "Hotel & Lodging",
 * "Wedding Planning Service") to our industry slug vocabulary.
 */
export function instagramCategoryToIndustry(cat: string | null | undefined): string | null {
  if (!cat) return null;
  const lower = cat.toLowerCase();
  if (/restaurant|food|bar|brewery|cafe|bakery/.test(lower)) return 'restaurant';
  if (/hotel|resort|lodg|inn|b&b/.test(lower)) return 'corporate_retreat';
  if (/wedding|event/.test(lower)) return 'wedding_planner';
  if (/marketing|advertising|agency/.test(lower)) return 'agency';
  if (/marina|yacht|boat|charter/.test(lower)) return 'other';
  return 'other';
}
