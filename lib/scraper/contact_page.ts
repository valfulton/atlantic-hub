/**
 * lib/scraper/contact_page.ts
 *
 * Lightweight contact-page scraper for filling gaps on leads where Hunter
 * found nothing but the company HAS a website with a Contact / About page.
 * Looks at the homepage + a handful of likely contact paths, extracts
 * the first plausible email + phone + business-name signals.
 *
 * Why no Cheerio: cheerio + parse5 adds ~600KB to the Netlify function
 * bundle and we only need three patterns (mailto, tel, plain text). Regex
 * over the raw HTML is brittle but fast and dep-free. If the precision
 * proves too low after Val tries it, swap in cheerio later.
 *
 * What it returns:
 *   - First non-placeholder email found (in body OR mailto: link)
 *   - First plausible phone (in body OR tel: link)
 *   - Best-guess company name from <title> or og:site_name
 *   - List of social URLs found (instagram, facebook, linkedin)
 *
 * What it DOESN'T do:
 *   - JS-rendered pages (no headless browser; SPA contact pages return nothing)
 *   - PDF / contact-form-only sites
 *   - Captcha-protected pages
 *
 * Polite-scraping rules baked in:
 *   - 8-second per-page timeout
 *   - User-Agent identifying as AtlanticHubBot
 *   - Stop after first 5 candidate pages even if more are linked
 *   - Skip non-html responses
 */

const CANDIDATE_PATHS = [
  '/',
  '/contact',
  '/contact-us',
  '/contact.html',
  '/about',
  '/about-us',
  '/about.html',
  '/team',
  '/get-in-touch',
  '/reach-us'
];

const USER_AGENT = 'AtlanticHubBot/1.0 (+admin.atlanticandvine.com; contact: hello@atlanticandvine.com)';
const PER_PAGE_TIMEOUT_MS = 8000;
const MAX_PAGES_PER_DOMAIN = 5;

export interface ScrapedContact {
  /** The first non-placeholder email found. Null if nothing found. */
  email: string | null;
  /** The first plausible phone number found (raw — caller normalizes). */
  phone: string | null;
  /** <title> or og:site_name — best-guess company display name. */
  companyTitle: string | null;
  /** Social profile URLs discovered. */
  socials: { instagram?: string; facebook?: string; linkedin?: string; twitter?: string };
  /** Which URLs we actually fetched. */
  pagesFetched: string[];
  /** Pages we attempted but failed (4xx, 5xx, timeout). */
  pagesFailed: string[];
}

/**
 * Scrape a single domain's contact-relevant pages.
 * websiteUrl can be any form: 'foo.com', 'https://foo.com', 'https://www.foo.com/about'.
 */
export async function scrapeContactPage(websiteUrl: string): Promise<ScrapedContact> {
  const base = normalizeBase(websiteUrl);
  if (!base) {
    return emptyResult();
  }

  const out: ScrapedContact = {
    email: null,
    phone: null,
    companyTitle: null,
    socials: {},
    pagesFetched: [],
    pagesFailed: []
  };

  let pagesTried = 0;
  for (const path of CANDIDATE_PATHS) {
    if (pagesTried >= MAX_PAGES_PER_DOMAIN) break;
    if (out.email && out.phone && out.companyTitle) break; // good enough — stop
    const url = `${base}${path}`;
    pagesTried++;

    let html: string | null = null;
    try {
      html = await fetchHtmlWithTimeout(url, PER_PAGE_TIMEOUT_MS);
    } catch {
      out.pagesFailed.push(url);
      continue;
    }
    if (!html) {
      out.pagesFailed.push(url);
      continue;
    }
    out.pagesFetched.push(url);

    if (!out.email) out.email = findEmail(html);
    if (!out.phone) out.phone = findPhone(html);
    if (!out.companyTitle) out.companyTitle = findTitle(html);
    mergeSocials(out.socials, findSocials(html));
  }

  return out;
}

function emptyResult(): ScrapedContact {
  return { email: null, phone: null, companyTitle: null, socials: {}, pagesFetched: [], pagesFailed: [] };
}

function normalizeBase(websiteUrl: string): string | null {
  let s = (websiteUrl || '').trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

async function fetchHtmlWithTimeout(url: string, timeoutMs: number): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml'
      }
    });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('text/html') && !ct.includes('xhtml')) return null;
    const text = await res.text();
    // Cap at 500KB — anything bigger is probably a one-page SPA bundle and
    // not worth scanning.
    return text.length > 500_000 ? text.slice(0, 500_000) : text;
  } finally {
    clearTimeout(timer);
  }
}

const PLACEHOLDER_EMAIL_RE = /^(noreply|no-reply|donotreply|info|contact|hello|admin|webmaster|postmaster|support|sales|hr)@/i;
// Exclude common placeholder/junk addresses from "first match" — we want
// a real person/inbox if available, falling back to info@ only if it's all
// that's there.
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
function findEmail(html: string): string | null {
  // Also pull from mailto: hrefs separately — they're usually higher signal.
  const mailtos: string[] = [];
  const mailtoRe = /mailto:([^"'\s>]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = mailtoRe.exec(html))) {
    mailtos.push(m[1].toLowerCase().split('?')[0]);
  }
  const bodyMatches = Array.from(html.matchAll(EMAIL_RE)).map((mm) => mm[0].toLowerCase());

  const all = Array.from(new Set([...mailtos, ...bodyMatches])).filter(
    (e) => e.includes('@') && !/example\.(com|org|net)$/i.test(e) && !e.endsWith('.png') && !e.endsWith('.jpg')
  );
  if (all.length === 0) return null;

  // Prefer non-placeholder addresses
  const real = all.find((e) => !PLACEHOLDER_EMAIL_RE.test(e));
  return real ?? all[0];
}

function findPhone(html: string): string | null {
  // tel: links first — highest signal.
  const telMatch = html.match(/tel:([+\d\s\-().]+)/i);
  if (telMatch) {
    const t = telMatch[1].trim();
    if (t.replace(/\D+/g, '').length >= 7) return t;
  }
  // Body text — match common formats. Avoid years (4 digits with no separator).
  const phoneRe = /(\+?\d[\d\s\-().]{8,}\d)/g;
  const candidates = Array.from(html.matchAll(phoneRe)).map((mm) => mm[0]);
  for (const c of candidates) {
    const digits = c.replace(/\D+/g, '');
    if (digits.length >= 10 && digits.length <= 15) {
      return c.trim();
    }
  }
  return null;
}

function findTitle(html: string): string | null {
  const ogMatch = html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i);
  if (ogMatch) return decodeHtml(ogMatch[1].trim());
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch) {
    // Strip common suffixes like " | HomePage" or " - Welcome".
    let t = decodeHtml(titleMatch[1].trim());
    t = t.split(/\s+[|\-–—]\s+/)[0];
    return t.length > 0 ? t : null;
  }
  return null;
}

function findSocials(html: string): ScrapedContact['socials'] {
  const socials: ScrapedContact['socials'] = {};
  const ig = html.match(/https?:\/\/(?:www\.)?instagram\.com\/([a-z0-9._]+)\/?/i);
  if (ig) socials.instagram = `https://www.instagram.com/${ig[1].toLowerCase()}/`;
  const fb = html.match(/https?:\/\/(?:www\.)?facebook\.com\/([a-z0-9.\-_]+)\/?/i);
  if (fb) socials.facebook = `https://www.facebook.com/${fb[1]}/`;
  const li = html.match(/https?:\/\/(?:www\.)?linkedin\.com\/(?:company|in)\/([a-z0-9\-_]+)\/?/i);
  if (li) socials.linkedin = li[0].split('?')[0];
  const tw = html.match(/https?:\/\/(?:www\.)?(?:twitter|x)\.com\/([a-z0-9_]+)\/?/i);
  if (tw) socials.twitter = tw[0].split('?')[0];
  return socials;
}

function mergeSocials(into: ScrapedContact['socials'], from: ScrapedContact['socials']) {
  if (!into.instagram && from.instagram) into.instagram = from.instagram;
  if (!into.facebook && from.facebook) into.facebook = from.facebook;
  if (!into.linkedin && from.linkedin) into.linkedin = from.linkedin;
  if (!into.twitter && from.twitter) into.twitter = from.twitter;
}

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&nbsp;/g, ' ');
}
