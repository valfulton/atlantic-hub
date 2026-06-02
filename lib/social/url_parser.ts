/**
 * lib/social/url_parser.ts (#45, val 2026-06-02)
 *
 * Parse pasted social-profile URLs into a normalized shape so we can store
 * one canonical form per identity and not duplicate. Pure: no I/O.
 *
 * The platforms val will paste right now (per her message):
 *   - facebook.com/profile.php?id=NNNNNN     -> personal, id-based
 *   - facebook.com/{name}                    -> page (named handle)
 *   - linkedin.com/in/{handle}               -> personal
 *   - linkedin.com/company/{handle}          -> company
 *   - instagram.com/{handle}                 -> personal/page (same on IG)
 *   - twitter.com/{handle} OR x.com/{handle} -> personal
 *   - tiktok.com/@{handle}                   -> personal
 *   - youtube.com/@{handle}                  -> channel
 *   - youtube.com/channel/{id}               -> channel
 *
 * "kind" is the BEST GUESS from the URL shape. The client confirms in the
 * intake; we don't trust it for posting decisions.
 */

export type ParsedProvider =
  | 'linkedin'
  | 'x'
  | 'instagram'
  | 'facebook'
  | 'tiktok'
  | 'youtube'
  | 'threads';

export type ParsedKind = 'personal' | 'company' | 'page' | 'channel';

export interface ParsedSocialUrl {
  /** Normalized canonical form -- strip query/hash/trailing slash where safe. */
  normalizedUrl: string;
  provider: ParsedProvider;
  kind: ParsedKind;
  /** The username/handle if we can extract one; null for id-based URLs. */
  handle: string | null;
  /** Platform-native id if URL is id-based (e.g. FB profile.php?id=...). */
  accountId: string | null;
}

export interface ParseFailure {
  ok: false;
  reason: string;
}

export interface ParseSuccess {
  ok: true;
  parsed: ParsedSocialUrl;
}

export type ParseResult = ParseSuccess | ParseFailure;

/**
 * Parse a single URL into provider/kind/handle. Returns ok=false on anything
 * that doesn't look like a supported social URL -- caller decides what to do
 * (typically: surface the URL with an "unrecognized platform" status).
 */
export function parseSocialUrl(input: string): ParseResult {
  if (!input || typeof input !== 'string') {
    return { ok: false, reason: 'empty' };
  }
  let url: URL;
  try {
    // Be forgiving: bare-domain inputs from the paste box still need to parse.
    const withScheme = /^https?:\/\//i.test(input.trim())
      ? input.trim()
      : `https://${input.trim()}`;
    url = new URL(withScheme);
  } catch {
    return { ok: false, reason: 'not_a_url' };
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const path = url.pathname.replace(/\/+$/, ''); // trim trailing slash

  // --- LinkedIn ------------------------------------------------------------
  if (host === 'linkedin.com' || host.endsWith('.linkedin.com')) {
    const inMatch = path.match(/^\/in\/([A-Za-z0-9_\-%.]+)/);
    if (inMatch) {
      const handle = decodeURIComponent(inMatch[1]).toLowerCase();
      return {
        ok: true,
        parsed: {
          normalizedUrl: `https://www.linkedin.com/in/${handle}/`,
          provider: 'linkedin',
          kind: 'personal',
          handle,
          accountId: null
        }
      };
    }
    const coMatch = path.match(/^\/company\/([A-Za-z0-9_\-%.]+)/);
    if (coMatch) {
      const handle = decodeURIComponent(coMatch[1]).toLowerCase();
      return {
        ok: true,
        parsed: {
          normalizedUrl: `https://www.linkedin.com/company/${handle}/`,
          provider: 'linkedin',
          kind: 'company',
          handle,
          accountId: null
        }
      };
    }
    return { ok: false, reason: 'linkedin_url_shape_unsupported' };
  }

  // --- Facebook ------------------------------------------------------------
  if (host === 'facebook.com' || host === 'fb.com' || host.endsWith('.facebook.com')) {
    // profile.php?id=NNNNN -- personal, id-based
    if (path === '/profile.php') {
      const id = url.searchParams.get('id');
      if (id && /^\d{5,}$/.test(id)) {
        return {
          ok: true,
          parsed: {
            normalizedUrl: `https://www.facebook.com/profile.php?id=${id}`,
            provider: 'facebook',
            kind: 'personal',
            handle: null,
            accountId: id
          }
        };
      }
      return { ok: false, reason: 'facebook_profile_missing_id' };
    }
    // facebook.com/{handle}
    const m = path.match(/^\/([A-Za-z0-9.\-_]+)$/);
    if (m && m[1] !== 'pages') {
      const handle = m[1].toLowerCase();
      return {
        ok: true,
        parsed: {
          normalizedUrl: `https://www.facebook.com/${handle}/`,
          provider: 'facebook',
          // can't tell page vs personal from a vanity URL alone; default 'page'
          // since most pasted vanity URLs are business pages
          kind: 'page',
          handle,
          accountId: null
        }
      };
    }
    return { ok: false, reason: 'facebook_url_shape_unsupported' };
  }

  // --- Instagram -----------------------------------------------------------
  if (host === 'instagram.com' || host.endsWith('.instagram.com')) {
    const m = path.match(/^\/([A-Za-z0-9._]+)$/);
    if (m) {
      const handle = m[1].toLowerCase();
      return {
        ok: true,
        parsed: {
          normalizedUrl: `https://www.instagram.com/${handle}/`,
          provider: 'instagram',
          // IG has no separate "company" shape in the URL; the account TYPE
          // (Personal/Creator/Business) is only visible after auth. Default
          // 'personal' -- client confirms / OAuth corrects later.
          kind: 'personal',
          handle,
          accountId: null
        }
      };
    }
    return { ok: false, reason: 'instagram_url_shape_unsupported' };
  }

  // --- X / Twitter ---------------------------------------------------------
  if (host === 'twitter.com' || host === 'x.com' || host.endsWith('.twitter.com') || host.endsWith('.x.com')) {
    const m = path.match(/^\/([A-Za-z0-9_]+)$/);
    if (m) {
      const handle = m[1].toLowerCase();
      return {
        ok: true,
        parsed: {
          normalizedUrl: `https://x.com/${handle}`,
          provider: 'x',
          kind: 'personal',
          handle,
          accountId: null
        }
      };
    }
    return { ok: false, reason: 'x_url_shape_unsupported' };
  }

  // --- TikTok --------------------------------------------------------------
  if (host === 'tiktok.com' || host.endsWith('.tiktok.com')) {
    const m = path.match(/^\/@([A-Za-z0-9._]+)$/);
    if (m) {
      const handle = m[1].toLowerCase();
      return {
        ok: true,
        parsed: {
          normalizedUrl: `https://www.tiktok.com/@${handle}`,
          provider: 'tiktok',
          kind: 'personal',
          handle,
          accountId: null
        }
      };
    }
    return { ok: false, reason: 'tiktok_url_shape_unsupported' };
  }

  // --- YouTube -------------------------------------------------------------
  if (host === 'youtube.com' || host === 'youtu.be' || host.endsWith('.youtube.com')) {
    const handleMatch = path.match(/^\/@([A-Za-z0-9._\-]+)$/);
    if (handleMatch) {
      const handle = handleMatch[1].toLowerCase();
      return {
        ok: true,
        parsed: {
          normalizedUrl: `https://www.youtube.com/@${handle}`,
          provider: 'youtube',
          kind: 'channel',
          handle,
          accountId: null
        }
      };
    }
    const channelMatch = path.match(/^\/channel\/([A-Za-z0-9_\-]+)$/);
    if (channelMatch) {
      const id = channelMatch[1];
      return {
        ok: true,
        parsed: {
          normalizedUrl: `https://www.youtube.com/channel/${id}`,
          provider: 'youtube',
          kind: 'channel',
          handle: null,
          accountId: id
        }
      };
    }
    return { ok: false, reason: 'youtube_url_shape_unsupported' };
  }

  // --- Threads -------------------------------------------------------------
  if (host === 'threads.net' || host.endsWith('.threads.net')) {
    const m = path.match(/^\/@([A-Za-z0-9._]+)$/);
    if (m) {
      const handle = m[1].toLowerCase();
      return {
        ok: true,
        parsed: {
          normalizedUrl: `https://www.threads.net/@${handle}`,
          provider: 'threads',
          kind: 'personal',
          handle,
          accountId: null
        }
      };
    }
    return { ok: false, reason: 'threads_url_shape_unsupported' };
  }

  return { ok: false, reason: 'unrecognized_platform' };
}

/**
 * Split a paste-box body (one URL per line, plus possible junk) into URLs.
 * Tolerates commas, semicolons, extra whitespace, and inline labels.
 */
export function extractUrlsFromPaste(body: string): string[] {
  if (!body) return [];
  const tokens = body
    .replace(/[,;]/g, '\n')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  // Pull http(s) URLs out of each line even when surrounded by other text.
  const out: string[] = [];
  for (const t of tokens) {
    const matches = t.match(/https?:\/\/\S+/gi);
    if (matches) {
      out.push(...matches);
    } else if (/^[a-z0-9.\-]+\.(com|net|org|io|co|me|tv)\//i.test(t)) {
      out.push(t);
    }
  }
  return out;
}
