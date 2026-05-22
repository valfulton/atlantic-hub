/**
 * lib/social/publish.ts
 *
 * The social PUBLISHER -- the missing link the OAuth connect flow left for a
 * "next session". Takes a queued social_outbox row and actually posts it to the
 * connected provider (LinkedIn or X) using the encrypted OAuth token stored by
 * the connect flow. Writes social_publish_log, updates the outbox row, and emits
 * events.
 *
 * v1 scope (honest): posts the caption TEXT. If the row carries a commercial
 * (media_url), the asset URL is appended to the caption as a link so the
 * commercial is reachable -- NATIVE image/video upload to the providers is a
 * multi-step, provider-specific follow-up (LinkedIn registerUpload, X chunked
 * v1.1 media) and is intentionally not done here. The body text never reveals AI
 * authorship and never shows per-unit cost.
 *
 * Token handling: tokens are AES-256-GCM encrypted at rest (lib/social/encrypt).
 * We decrypt in-memory only, never log token values, and truncate provider error
 * bodies. A 401 marks the connection as needing reconnect.
 */

import { getAvDb } from '@/lib/db/av';
import { logEvent } from '@/lib/events/log';
import { decryptToken } from '@/lib/social/encrypt';
import { linkedInUploadMedia } from '@/lib/social/media';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

export interface PublishResult {
  outboxId: number;
  ok: boolean;
  status: 'published' | 'failed';
  provider: string | null;
  providerPostId: string | null;
  providerUrl: string | null;
  error: string | null;
}

interface OutboxJoinRow extends RowDataPacket {
  id: number;
  tenant_id: string;
  connection_id: number;
  body_text: string | null;
  media_url: string | null;
  media_type: string | null;
  outbox_status: string;
  provider: 'linkedin' | 'x';
  provider_account_id: string;
  display_name: string | null;
  access_token_enc: string;
  conn_status: string;
}

export class OutboxRowNotFoundError extends Error {
  constructor(public outboxId: number) {
    super(`social_outbox ${outboxId} not found`);
    this.name = 'OutboxRowNotFoundError';
  }
}

/**
 * Publish one social_outbox row immediately. Idempotent-ish: a row already
 * 'published' is returned as a success no-op. Never throws for provider errors
 * (they are captured into the result + social_publish_log); only throws if the
 * row genuinely does not exist.
 */
export async function publishOutboxRow(outboxId: number): Promise<PublishResult> {
  const db = getAvDb();
  const [rows] = await db.execute<OutboxJoinRow[]>(
    `SELECT o.id, o.tenant_id, o.connection_id, o.body_text, o.media_url, o.media_type,
            o.status AS outbox_status,
            c.provider, c.provider_account_id, c.display_name, c.access_token_enc,
            c.status AS conn_status
       FROM social_outbox o
       JOIN social_connections c ON c.id = o.connection_id
      WHERE o.id = ? LIMIT 1`,
    [outboxId]
  );
  const row = rows[0];
  if (!row) throw new OutboxRowNotFoundError(outboxId);

  if (row.outbox_status === 'published') {
    return { outboxId, ok: true, status: 'published', provider: row.provider, providerPostId: null, providerUrl: null, error: null };
  }
  if (row.conn_status !== 'active') {
    const error = `connection is ${row.conn_status}; reconnect the account at /admin/social`;
    await markFailed(outboxId, error);
    return { outboxId, ok: false, status: 'failed', provider: row.provider, providerPostId: null, providerUrl: null, error };
  }

  // mark publishing
  await db.execute<ResultSetHeader>(
    `UPDATE social_outbox SET status = 'publishing', updated_at = NOW() WHERE id = ?`,
    [outboxId]
  );

  // For native LinkedIn media we post the raw caption (no appended link); for
  // everything else we append the asset link so the commercial is reachable.
  const text = buildPostText(row.body_text, row.media_url);
  if (!text.trim() && !row.media_url) {
    const error = 'nothing to post (empty body)';
    await markFailed(outboxId, error);
    return { outboxId, ok: false, status: 'failed', provider: row.provider, providerPostId: null, providerUrl: null, error };
  }

  let token: string;
  try {
    token = decryptToken(row.access_token_enc);
  } catch {
    const error = 'could not decrypt access token (key rotation?); reconnect the account';
    await markFailed(outboxId, error);
    return { outboxId, ok: false, status: 'failed', provider: row.provider, providerPostId: null, providerUrl: null, error };
  }

  const started = Date.now();
  const wantsMedia = !!row.media_url && (row.media_type === 'image' || row.media_type === 'video');
  let post: ProviderPostResult;
  try {
    if (row.provider === 'linkedin' && wantsMedia) {
      // Try native upload (video/image plays in-feed). On ANY media failure,
      // fall back to a text+link post so publishing never fully fails.
      try {
        const assetUrn = await linkedInUploadMedia({
          token,
          personId: row.provider_account_id,
          assetType: row.media_type as 'image' | 'video',
          mediaUrl: row.media_url as string
        });
        post = await postLinkedIn(token, row.provider_account_id, (row.body_text ?? '').trim(), {
          assetUrn,
          category: row.media_type === 'video' ? 'VIDEO' : 'IMAGE'
        });
      } catch (mediaErr) {
        await logEvent({
          eventType: 'social.media_fallback',
          source: 'social_publisher',
          status: 'partial',
          errorMessage: (mediaErr as Error).message.slice(0, 480),
          payload: { outbox_id: outboxId, provider: 'linkedin', media_type: row.media_type }
        });
        post = await postLinkedIn(token, row.provider_account_id, text);
      }
    } else if (row.provider === 'linkedin') {
      post = await postLinkedIn(token, row.provider_account_id, text);
    } else {
      // X: native media needs a media-upload scope the connected token lacks;
      // post text + linked commercial until the account is reconnected.
      post = await postX(token, text, row.display_name);
    }
  } catch (err) {
    const error = (err as Error).message.slice(0, 480);
    await writePublishLog(outboxId, 'permanent_failure', null, Date.now() - started, error);
    await markFailed(outboxId, error);
    await logEvent({
      eventType: 'social.publish_failed',
      source: 'social_publisher',
      status: 'failure',
      errorMessage: error,
      payload: { outbox_id: outboxId, provider: row.provider, tenant_id: row.tenant_id }
    });
    return { outboxId, ok: false, status: 'failed', provider: row.provider, providerPostId: null, providerUrl: null, error };
  }

  // success
  const latency = Date.now() - started;
  await db.execute<ResultSetHeader>(
    `UPDATE social_outbox
        SET status = 'published', provider_post_id = ?, provider_url = ?,
            published_at = NOW(), error_message = NULL, updated_at = NOW()
      WHERE id = ?`,
    [post.id, post.url, outboxId]
  );
  await db.execute<ResultSetHeader>(
    `UPDATE social_connections SET last_used_at = NOW() WHERE id = ?`,
    [row.connection_id]
  );
  await writePublishLog(outboxId, 'success', post.httpStatus, latency, null);
  await logEvent({
    eventType: 'social.published',
    source: 'social_publisher',
    payload: { outbox_id: outboxId, provider: row.provider, tenant_id: row.tenant_id, provider_post_id: post.id, has_media_link: !!row.media_url }
  });

  return { outboxId, ok: true, status: 'published', provider: row.provider, providerPostId: post.id, providerUrl: post.url, error: null };
}

// ---------------------------------------------------------------------------
// Provider posters (text v1)
// ---------------------------------------------------------------------------

interface ProviderPostResult {
  id: string | null;
  url: string | null;
  httpStatus: number;
}

async function postX(token: string, text: string, displayName: string | null): Promise<ProviderPostResult> {
  const resp = await fetch('https://api.twitter.com/2/tweets', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ text: clampForX(text) })
  });
  const body = await resp.text();
  if (!resp.ok) {
    throw new Error(`X post ${resp.status}: ${truncate(body)}${resp.status === 401 ? ' -- reconnect the account' : ''}`);
  }
  let id: string | null = null;
  try {
    const json = JSON.parse(body) as { data?: { id?: string } };
    id = json.data?.id ?? null;
  } catch {
    /* ignore */
  }
  // displayName is "@handle" if we have it; build a best-effort permalink.
  const handle = displayName && displayName.startsWith('@') ? displayName.slice(1) : 'i/web';
  const url = id ? `https://x.com/${handle}/status/${id}` : null;
  return { id, url, httpStatus: resp.status };
}

async function postLinkedIn(
  token: string,
  personId: string,
  text: string,
  media?: { assetUrn: string; category: 'IMAGE' | 'VIDEO' }
): Promise<ProviderPostResult> {
  const author = `urn:li:person:${personId}`;
  const shareContent: Record<string, unknown> = {
    shareCommentary: { text },
    shareMediaCategory: media ? media.category : 'NONE'
  };
  if (media) {
    shareContent.media = [{ status: 'READY', media: media.assetUrn }];
  }
  const payload = {
    author,
    lifecycleState: 'PUBLISHED',
    specificContent: { 'com.linkedin.ugc.ShareContent': shareContent },
    visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' }
  };
  const resp = await fetch('https://api.linkedin.com/v2/ugcPosts', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Restli-Protocol-Version': '2.0.0',
      Accept: 'application/json'
    },
    body: JSON.stringify(payload)
  });
  const body = await resp.text();
  if (!resp.ok) {
    throw new Error(`LinkedIn post ${resp.status}: ${truncate(body)}${resp.status === 401 ? ' -- reconnect the account' : ''}`);
  }
  let id: string | null = resp.headers.get('x-restli-id');
  if (!id) {
    try {
      const json = JSON.parse(body) as { id?: string };
      id = json.id ?? null;
    } catch {
      /* ignore */
    }
  }
  const url = id ? `https://www.linkedin.com/feed/update/${id}` : null;
  return { id, url, httpStatus: resp.status };
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function buildPostText(bodyText: string | null, mediaUrl: string | null): string {
  const base = (bodyText ?? '').trim();
  // v1: link the commercial rather than native-upload it.
  if (mediaUrl && !base.includes(mediaUrl)) {
    return `${base}\n\n${mediaUrl}`.trim();
  }
  return base;
}

function clampForX(text: string): string {
  // X hard limit is 280 for standard accounts. Trim defensively.
  if (text.length <= 280) return text;
  return text.slice(0, 277) + '...';
}

async function markFailed(outboxId: number, error: string): Promise<void> {
  const db = getAvDb();
  await db.execute<ResultSetHeader>(
    `UPDATE social_outbox SET status = 'failed', error_message = ?, retries = retries + 1, updated_at = NOW() WHERE id = ?`,
    [error.slice(0, 500), outboxId]
  );
}

async function writePublishLog(
  outboxId: number,
  outcome: 'success' | 'retry' | 'permanent_failure',
  httpStatus: number | null,
  latencyMs: number,
  error: string | null
): Promise<void> {
  const db = getAvDb();
  try {
    await db.execute<ResultSetHeader>(
      `INSERT INTO social_publish_log (outbox_id, outcome, http_status, latency_ms, error_message)
       VALUES (?, ?, ?, ?, ?)`,
      [outboxId, outcome, httpStatus, latencyMs, error ? error.slice(0, 500) : null]
    );
  } catch (err) {
    console.error('[social:publish_log]', (err as Error).message);
  }
}

function truncate(s: string, n = 300): string {
  return s.length > n ? `${s.slice(0, n)}...` : s;
}
