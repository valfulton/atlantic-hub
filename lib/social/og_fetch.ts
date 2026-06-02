/**
 * lib/social/og_fetch.ts (#45, val 2026-06-02)
 *
 * Server-side fetch of og:image / og:title for a social profile URL. Used so
 * the intake-form shows the client a recognizable profile photo + name when
 * confirming "is this you?" without needing platform OAuth.
 *
 * Hard limits, by design:
 *   - 5 second timeout per fetch
 *   - 800 KB body cap (we only parse the <head>)
 *   - Refuse non-http(s), localhost, private IP, file:// schemes
 *   - Never logs response bodies
 *
 * Result is meant to be cached in social_targets.avatar_url / og_title with
 * og_fetched_at, so the same URL never re-fetches on re-render.
 *
 * Platform quirks:
 *   - Facebook + Instagram return a generic og:image to non-authenticated
 *     fetchers most of the time (sometimes a useful one for public Pages).
 *     We accept whatever they return -- it's a hint, not a guarantee.
 *   - LinkedIn /in/ pages return a corporate og:image (the LinkedIn logo) to
 *     unauthenticated fetches. /company/ pages return the org banner. So a
 *     LinkedIn personal "is this you?" preview will show the LinkedIn logo
 *     until the user connects. That's fine -- the og_title still confirms the
 *     person's name.
 *   - x.com / twitter.com require auth for og data via their preview endpoint.
 *     We accept it'll often be empty; the UI shows just the handle.
 */

const FETCH_TIMEOUT_MS = 5000;
const MAX_BYTES = 800 * 1024;

export interface OgPreview {
  ok: boolean;
  ogImage: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  fetchedAt: Date;
  /** Short reason string when ok=false; never includes response body. */
  reason?: string;
}

/**
 * Pre-flight guard: refuse to fetch anything that isn't a public http(s) URL.
 * Cheap protection against SSRF when the paste box is the input.
 */
function isSafePublicUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host === '::1') return false;
  // Block obvious private-range hostnames (string-based; resolver-based block
  // is impractical here without DNS, and the platforms we hit are all public).
  if (/^10\./.test(host)) return false;
  if (/^192\.168\./.test(host)) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
  if (/^169\.254\./.test(host)) return false; // link-local
  return true;
}

/** Pull a meta-tag content value out of HTML by property OR name. */
function extractMeta(head: string, key: string): string | null {
  // <meta property="og:image" content="...">  OR  name="..."
  const re = new RegExp(
    `<meta\\s+(?:[^>]*?\\s+)?(?:property|name)=["']${key}["'][^>]*?content=["']([^"']+)["']`,
    'i'
  );
  const a = head.match(re);
  if (a && a[1]) return a[1].trim();
  // <meta content="..." property="og:image">  (attribute order reversed)
  const re2 = new RegExp(
    `<meta\\s+(?:[^>]*?\\s+)?content=["']([^"']+)["'][^>]*?(?:property|name)=["']${key}["']`,
    'i'
  );
  const b = head.match(re2);
  if (b && b[1]) return b[1].trim();
  return null;
}

function extractTitleTag(head: string): string | null {
  const m = head.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m) return null;
  const raw = m[1].replace(/\s+/g, ' ').trim();
  return raw || null;
}

/**
 * Fetch + parse og: tags. Never throws; returns ok=false with a short reason
 * on any failure so the caller can persist the failure state.
 */
export async function fetchOgPreview(url: string): Promise<OgPreview> {
  const now = new Date();
  if (!isSafePublicUrl(url)) {
    return { ok: false, ogImage: null, ogTitle: null, ogDescription: null, fetchedAt: now, reason: 'unsafe_url' };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      method: 'GET',
      headers: {
        // Pretend to be a normal browser; some platforms 403 generic UA.
        'User-Agent':
          'Mozilla/5.0 (compatible; AtlanticVineBot/1.0; +https://atlanticandvine.com)',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.7'
      },
      redirect: 'follow',
      signal: controller.signal
    });
    if (!resp.ok) {
      return {
        ok: false,
        ogImage: null,
        ogTitle: null,
        ogDescription: null,
        fetchedAt: now,
        reason: `http_${resp.status}`
      };
    }
    const ct = resp.headers.get('content-type') || '';
    if (!/text\/html|application\/xhtml/i.test(ct)) {
      return { ok: false, ogImage: null, ogTitle: null, ogDescription: null, fetchedAt: now, reason: 'not_html' };
    }
    // Read body, capping bytes; we only need the <head>.
    const reader = resp.body?.getReader();
    if (!reader) {
      return { ok: false, ogImage: null, ogTitle: null, ogDescription: null, fetchedAt: now, reason: 'no_body' };
    }
    let received = 0;
    let chunks = '';
    const decoder = new TextDecoder();
    // Keep reading until we either find </head> or hit the byte cap.
    while (received < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      chunks += decoder.decode(value, { stream: true });
      if (/<\/head\s*>/i.test(chunks)) break;
    }
    try {
      await reader.cancel();
    } catch {
      /* ignore */
    }
    const head = chunks.slice(0, chunks.search(/<\/head\s*>/i) >= 0 ? chunks.search(/<\/head\s*>/i) : chunks.length);

    const ogImage = extractMeta(head, 'og:image') || extractMeta(head, 'twitter:image');
    const ogTitle = extractMeta(head, 'og:title') || extractMeta(head, 'twitter:title') || extractTitleTag(head);
    const ogDescription = extractMeta(head, 'og:description') || extractMeta(head, 'twitter:description');

    return {
      ok: true,
      ogImage,
      ogTitle,
      ogDescription,
      fetchedAt: now
    };
  } catch (e) {
    const reason = e instanceof Error && e.name === 'AbortError' ? 'timeout' : 'fetch_error';
    return { ok: false, ogImage: null, ogTitle: null, ogDescription: null, fetchedAt: now, reason };
  } finally {
    clearTimeout(timer);
  }
}
