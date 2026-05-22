/**
 * lib/pr/sources/rss.ts
 *
 * ACTIVE discovery adapter: RSS / Atom feeds (industry news, Google Alerts
 * feeds, journalist-request aggregators that expose RSS). Each feed item with
 * buying-intent / trend signal is handed to the shared ingestion path
 * (lib/pr/ingest.ts) as an opportunity with origin='rss'. See lane 3 of
 * docs/CLAUDE_KICKOFF_PR_DISCOVERY_AND_ORCHESTRATION.md + Phase 3 P6.
 *
 * Dependency-free: we parse the feed XML with a small, defensive regex parser
 * (the repo has no XML library and we are not adding one). Handles both RSS
 * <item> and Atom <entry>. Never throws -- on fetch/parse failure it returns an
 * empty item list and a detail string.
 *
 * This file ONLY fetches + normalizes. The runner (lib/pr/sources/run.ts)
 * calls ingestRawItem() for each item.
 */

import type { RawInboundItem } from '@/lib/pr/ingest';

const DEFAULT_LIMIT_PER_FEED = 12;
const MAX_LIMIT_PER_FEED = 40;
const MAX_FEEDS = 12;
const FETCH_TIMEOUT_MS = 12_000;
const USER_AGENT = 'atlantic-hub/1.0 (PR narrative intelligence RSS reader)';

export interface RssSourceConfig {
  feeds: string[];
  /** Optional keyword filter; an item must contain at least one (case-insensitive). */
  keywords?: string[];
  limitPerFeed?: number;
}

export interface SourceFetchResult {
  items: RawInboundItem[];
  detail: string;
  disabled: boolean;
}

export function parseRssConfig(raw: unknown): RssSourceConfig | null {
  const cfg = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const feeds = Array.isArray(cfg.feeds)
    ? cfg.feeds
        .filter((f) => typeof f === 'string')
        .map((f) => (f as string).trim())
        .filter((f) => /^https?:\/\//i.test(f))
        .slice(0, MAX_FEEDS)
    : [];
  if (!feeds.length) return null;
  const keywords = Array.isArray(cfg.keywords)
    ? cfg.keywords.filter((k) => typeof k === 'string').map((k) => (k as string).trim().toLowerCase()).filter(Boolean)
    : undefined;
  const limitPerFeed = typeof cfg.limitPerFeed === 'number' ? cfg.limitPerFeed : undefined;
  return { feeds, keywords, limitPerFeed };
}

export async function fetchRssOpportunities(config: RssSourceConfig): Promise<SourceFetchResult> {
  if (!config.feeds.length) {
    return { items: [], detail: 'rss lane: no feeds configured', disabled: true };
  }

  const perFeed = Math.max(1, Math.min(config.limitPerFeed ?? DEFAULT_LIMIT_PER_FEED, MAX_LIMIT_PER_FEED));
  const keywords = config.keywords;
  const items: RawInboundItem[] = [];
  let feedsOk = 0;
  let feedsFailed = 0;

  for (const feed of config.feeds) {
    try {
      const xml = await fetchText(feed);
      if (!xml) {
        feedsFailed++;
        continue;
      }
      const entries = parseFeedItems(xml).slice(0, perFeed);
      for (const e of entries) {
        if (!e.title) continue;
        const haystack = `${e.title}\n${e.summary}`.toLowerCase();
        if (keywords && keywords.length && !keywords.some((k) => haystack.includes(k))) continue;
        items.push({
          rawText: assembleRssText(e.title, e.summary, e.link),
          source: 'other',
          externalId: e.guid || e.link || null,
          url: e.link
        });
      }
      feedsOk++;
    } catch {
      feedsFailed++;
    }
  }

  return {
    items,
    detail: `rss: ${items.length} items from ${feedsOk}/${config.feeds.length} feeds (${feedsFailed} failed)`,
    disabled: false
  };
}

// ---------------------------------------------------------------------------
// Minimal feed parsing
// ---------------------------------------------------------------------------

interface FeedItem {
  title: string;
  summary: string;
  link: string | null;
  guid: string | null;
}

function parseFeedItems(xml: string): FeedItem[] {
  const out: FeedItem[] = [];
  // RSS <item> ... </item> and Atom <entry> ... </entry>.
  const blockRe = /<(item|entry)\b[\s\S]*?<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(xml)) !== null) {
    const block = m[0];
    const title = decodeXml(stripCdata(firstTag(block, 'title') ?? '')).trim();
    const summary = decodeXml(
      stripCdata(firstTag(block, 'description') ?? firstTag(block, 'summary') ?? firstTag(block, 'content') ?? '')
    )
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 2000);
    const link = extractLink(block);
    const guid = (stripCdata(firstTag(block, 'guid') ?? firstTag(block, 'id') ?? '') || link || '').trim() || null;
    if (!title && !summary) continue;
    out.push({ title, summary, link, guid });
  }
  return out;
}

function firstTag(block: string, tag: string): string | null {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = re.exec(block);
  return m ? m[1] : null;
}

function extractLink(block: string): string | null {
  // RSS: <link>url</link>. Atom: <link href="url" .../>.
  const rss = /<link\b[^>]*>([\s\S]*?)<\/link>/i.exec(block);
  if (rss && rss[1] && /^https?:\/\//i.test(rss[1].trim())) return rss[1].trim();
  const atom = /<link\b[^>]*href=["']([^"']+)["'][^>]*\/?\s*>/i.exec(block);
  if (atom && atom[1]) return atom[1].trim();
  return null;
}

function stripCdata(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function assembleRssText(title: string, summary: string, link: string | null): string {
  const parts = ['Industry feed item:', title];
  if (summary) parts.push('', summary);
  if (link) parts.push('', `Source: ${link}`);
  return parts.join('\n');
}

async function fetchText(url: string): Promise<string | null> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': USER_AGENT, accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' },
      cache: 'no-store',
      signal: controller.signal
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}
