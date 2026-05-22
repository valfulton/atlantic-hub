/**
 * lib/social/media.ts
 *
 * Native media upload for the social publisher.
 *   - LinkedIn: its existing w_member_social permission allows member-share media.
 *   - X: native IMAGE upload (added 2026-05-22). Requires the media.write scope
 *     added in lib/social/oauth.ts -- a connection issued BEFORE that change
 *     lacks the scope and must be RECONNECTED, so the publisher always keeps the
 *     text+link fallback. X VIDEO is still text+link (chunked upload is a v1.1
 *     follow-up; higher effort).
 *
 * LinkedIn flow (classic assets API, works with w_member_social):
 *   1. registerUpload -> get an upload URL + asset URN
 *   2. PUT/POST the raw bytes to that URL
 *   3. caller attaches the asset URN to the ugcPost (shareMediaCategory IMAGE/VIDEO)
 *
 * X flow (v2 media upload, OAuth2 user context + media.write):
 *   1. download the asset bytes
 *   2. POST multipart to https://api.x.com/2/media/upload (media_category=tweet_image)
 *   3. caller attaches the returned media id to the tweet (media.media_ids)
 *
 * Everything here is best-effort and throws on failure so the publisher can fall
 * back to a text+link post -- native media must never be the reason a post fails.
 */

// Guardrail: don't try to pull huge files through a serverless function.
const MAX_ASSET_BYTES = 40 * 1024 * 1024; // 40 MB

export interface FetchedAsset {
  bytes: Uint8Array;
  contentType: string;
}

/** Download a commercial asset (Grok-hosted url) into memory. Throws on failure. */
export async function fetchAssetBytes(url: string): Promise<FetchedAsset> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`asset fetch ${resp.status}`);
  const contentType = resp.headers.get('content-type') || 'application/octet-stream';
  const lenHeader = resp.headers.get('content-length');
  if (lenHeader && Number(lenHeader) > MAX_ASSET_BYTES) {
    throw new Error(`asset too large (${lenHeader} bytes)`);
  }
  const buf = new Uint8Array(await resp.arrayBuffer());
  if (buf.byteLength > MAX_ASSET_BYTES) throw new Error(`asset too large (${buf.byteLength} bytes)`);
  return { bytes: buf, contentType };
}

interface RegisterUploadResponse {
  value?: {
    asset?: string;
    uploadMechanism?: {
      'com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest'?: {
        uploadUrl?: string;
      };
    };
  };
}

/**
 * Register + upload a media asset to LinkedIn and return its asset URN, ready to
 * attach to a ugcPost. `assetType` selects the recipe (image vs video).
 * Throws on any failure (caller falls back to text+link).
 */
export async function linkedInUploadMedia(args: {
  token: string;
  personId: string;
  assetType: 'image' | 'video';
  mediaUrl: string;
}): Promise<string> {
  const recipe =
    args.assetType === 'video'
      ? 'urn:li:digitalmediaRecipe:feedshare-video'
      : 'urn:li:digitalmediaRecipe:feedshare-image';
  const owner = `urn:li:person:${args.personId}`;

  // 1. registerUpload
  const regResp = await fetch('https://api.linkedin.com/v2/assets?action=registerUpload', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${args.token}`,
      'Content-Type': 'application/json',
      'X-Restli-Protocol-Version': '2.0.0'
    },
    body: JSON.stringify({
      registerUploadRequest: {
        recipes: [recipe],
        owner,
        serviceRelationships: [
          { relationshipType: 'OWNER', identifier: 'urn:li:userGeneratedContent' }
        ]
      }
    })
  });
  const regText = await regResp.text();
  if (!regResp.ok) throw new Error(`registerUpload ${regResp.status}: ${trunc(regText)}`);

  let reg: RegisterUploadResponse;
  try {
    reg = JSON.parse(regText) as RegisterUploadResponse;
  } catch {
    throw new Error('registerUpload parse error');
  }
  const assetUrn = reg.value?.asset;
  const uploadUrl =
    reg.value?.uploadMechanism?.['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest']?.uploadUrl;
  if (!assetUrn || !uploadUrl) throw new Error('registerUpload missing asset/uploadUrl');

  // 2. fetch the bytes + upload them
  const asset = await fetchAssetBytes(args.mediaUrl);
  const upResp = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${args.token}`,
      'Content-Type': asset.contentType
    },
    body: asset.bytes
  });
  if (!upResp.ok) {
    const t = await upResp.text();
    throw new Error(`media upload ${upResp.status}: ${trunc(t)}`);
  }

  return assetUrn;
}

// ---------------------------------------------------------------------------
// X (v2 media upload)
// ---------------------------------------------------------------------------

interface XMediaUploadResponse {
  data?: { id?: string; media_key?: string };
  media_id_string?: string; // legacy/compat shape
  errors?: Array<{ message?: string }>;
}

/**
 * Upload a single IMAGE to X and return its media id, ready to attach to a tweet
 * via `media.media_ids`. Uses the v2 simple (non-chunked) upload, which is fine
 * for images within MAX_ASSET_BYTES. Requires an OAuth2 user token carrying the
 * media.write scope. Throws on any failure (caller falls back to text+link).
 */
export async function xUploadImage(args: { token: string; mediaUrl: string }): Promise<string> {
  const asset = await fetchAssetBytes(args.mediaUrl);
  if (!asset.contentType.startsWith('image/')) {
    throw new Error(`x media: unsupported content-type ${asset.contentType}`);
  }

  const form = new FormData();
  // Copy into a fresh ArrayBuffer so the Blob gets a clean, correctly-sized buffer.
  const ab = new ArrayBuffer(asset.bytes.byteLength);
  new Uint8Array(ab).set(asset.bytes);
  form.append('media', new Blob([ab], { type: asset.contentType }), 'media');
  form.append('media_category', 'tweet_image');

  const resp = await fetch('https://api.x.com/2/media/upload', {
    method: 'POST',
    headers: { Authorization: `Bearer ${args.token}` },
    body: form
  });
  const body = await resp.text();
  if (!resp.ok) {
    throw new Error(`x media upload ${resp.status}: ${trunc(body)}${resp.status === 401 ? ' -- reconnect the account (needs media.write)' : ''}`);
  }

  let parsed: XMediaUploadResponse;
  try {
    parsed = JSON.parse(body) as XMediaUploadResponse;
  } catch {
    throw new Error('x media upload parse error');
  }
  const mediaId = parsed.data?.id || parsed.media_id_string;
  if (!mediaId) throw new Error('x media upload missing media id');
  return mediaId;
}

function trunc(s: string, n = 200): string {
  return s.length > n ? `${s.slice(0, n)}...` : s;
}
