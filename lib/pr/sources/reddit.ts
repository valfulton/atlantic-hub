/**
 * lib/pr/sources/reddit.ts
 *
 * ACTIVE discovery adapter: Reddit. Reddit has a usable API, so we poll
 * configured subreddits (optionally filtered by keywords matched to client
 * industries) for real operational questions with buying intent and hand each
 * post to the shared ingestion path (lib/pr/ingest.ts) as an opportunity with
 * origin='reddit'. The drafter later writes a genuinely useful, diagnostic
 * answer -- NOT spam. See docs/CLAUDE_KICKOFF_PR_DISCOVERY_AND_ORCHESTRATION.md
 * (lane 3) + the Phase 3 handoff (P6).
 *
 * Auth: OAuth2 client-credentials (app-only) using REDDIT_CLIENT_ID /
 * REDDIT_CLIENT_SECRET. No user account, no write access -- read-only listing.
 * If the credentials are missing we return an empty result with a clear reason
 * (the lane is simply disabled) rather than throwing.
 *
 * This file ONLY fetches + normalizes. It does not write to the DB; the runner
 * (lib/pr/sources/run.ts) calls ingestRawItem() for each item.
 */

import type { RawInboundItem } from '@/lib/pr/ingest';

const TOKEN_URL = 'https://www.reddit.com/api/v1/access_token';
const API_BASE = 'https://oauth.reddit.com';
const USER_AGENT = 'web:atlantic-hub:v1.0 (PR narrative intelligence; by /u/atlanticandvine)';

const DEFAULT_LIMIT_PER_SUB = 15;
const MAX_LIMIT_PER_SUB = 50;
const MAX_SUBREDDITS = 10;

export interface RedditSourceConfig {
  /** Subreddits to poll, without the leading r/. */
  subreddits: string[];
  /** Optional keyword filter; a post must contain at least one (case-insensitive). */
  keywords?: string[];
  /** Posts to pull per subreddit (capped). */
  limit?: number;
}

export interface SourceFetchResult {
  items: RawInboundItem[];
  /** Human-readable status for pr_discovery_sources.last_detail / events. */
  detail: string;
  /** True when the lane is disabled because credentials/config are missing. */
  disabled: boolean;
}

interface RedditChild {
  kind: string;
  data: {
    id?: string;
    name?: string; // fullname, e.g. t3_abc123
    title?: string;
    selftext?: string;
    permalink?: string;
    subreddit?: string;
    over_18?: boolean;
    stickied?: boolean;
  };
}

export function parseRedditConfig(raw: unknown): RedditSourceConfig | null {
  const cfg = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const subreddits = Array.isArray(cfg.subreddits)
    ? cfg.subreddits
        .filter((s) => typeof s === 'string')
        .map((s) => (s as string).replace(/^\/?r\//i, '').trim())
        .filter(Boolean)
        .slice(0, MAX_SUBREDDITS)
    : [];
  if (!subreddits.length) return null;
  const keywords = Array.isArray(cfg.keywords)
    ? cfg.keywords.filter((k) => typeof k === 'string').map((k) => (k as string).trim().toLowerCase()).filter(Boolean)
    : undefined;
  const limit = typeof cfg.limit === 'number' ? cfg.limit : undefined;
  return { subreddits, keywords, limit };
}

/**
 * Fetch new posts from the configured subreddits. Never throws -- on auth or
 * network failure it returns an empty item list and a detail string.
 */
export async function fetchRedditOpportunities(config: RedditSourceConfig): Promise<SourceFetchResult> {
  const clientId = process.env.REDDIT_CLIENT_ID?.trim();
  const clientSecret = process.env.REDDIT_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    return { items: [], detail: 'reddit lane disabled: REDDIT_CLIENT_ID/REDDIT_CLIENT_SECRET not set', disabled: true };
  }
  if (!config.subreddits.length) {
    return { items: [], detail: 'reddit lane: no subreddits configured', disabled: true };
  }

  let token: string;
  try {
    token = await getAppToken(clientId, clientSecret);
  } catch (err) {
    return { items: [], detail: `reddit auth failed: ${(err as Error).message}`.slice(0, 480), disabled: false };
  }

  const perSub = Math.max(1, Math.min(config.limit ?? DEFAULT_LIMIT_PER_SUB, MAX_LIMIT_PER_SUB));
  const keywords = config.keywords;
  const items: RawInboundItem[] = [];
  let subsOk = 0;
  let subsFailed = 0;

  for (const sub of config.subreddits) {
    try {
      const res = await fetch(`${API_BASE}/r/${encodeURIComponent(sub)}/new?limit=${perSub}`, {
        headers: { authorization: `Bearer ${token}`, 'user-agent': USER_AGENT },
        cache: 'no-store'
      });
      if (!res.ok) {
        subsFailed++;
        continue;
      }
      const json = (await res.json()) as { data?: { children?: RedditChild[] } };
      const children = json.data?.children ?? [];
      for (const child of children) {
        if (child.kind !== 't3' || !child.data) continue;
        const d = child.data;
        if (d.over_18 || d.stickied) continue;
        const title = (d.title ?? '').trim();
        const selftext = (d.selftext ?? '').trim();
        if (!title) continue;
        const haystack = `${title}\n${selftext}`.toLowerCase();
        if (keywords && keywords.length && !keywords.some((k) => haystack.includes(k))) continue;
        const permalink = d.permalink ? `https://www.reddit.com${d.permalink}` : null;
        items.push({
          rawText: assembleRedditText(sub, title, selftext, permalink),
          source: 'reddit',
          externalId: d.name || (d.id ? `t3_${d.id}` : null),
          url: permalink
        });
      }
      subsOk++;
    } catch {
      subsFailed++;
    }
  }

  return {
    items,
    detail: `reddit: ${items.length} posts from ${subsOk}/${config.subreddits.length} subreddits (${subsFailed} failed)`,
    disabled: false
  };
}

async function getAppToken(clientId: string, clientSecret: string): Promise<string> {
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      authorization: `Basic ${basic}`,
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': USER_AGENT
    },
    body: 'grant_type=client_credentials',
    cache: 'no-store'
  });
  if (!res.ok) {
    throw new Error(`token endpoint returned ${res.status}`);
  }
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error('no access_token in response');
  return json.access_token;
}

function assembleRedditText(sub: string, title: string, selftext: string, url: string | null): string {
  const parts = [`Reddit post in r/${sub}:`, title];
  if (selftext) parts.push('', selftext.slice(0, 4000));
  if (url) parts.push('', `Source: ${url}`);
  return parts.join('\n');
}
