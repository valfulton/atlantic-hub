/**
 * lib/social/media.ts
 *
 * Native media upload for the social publisher. v1 supports LinkedIn (its
 * existing w_member_social permission allows member-share media). X is NOT
 * supported yet -- the connected X token lacks a media-upload scope, so X posts
 * stay text+link until the account is reconnected with an expanded scope.
 *
 * LinkedIn flow (classic assets API, works with w_member_social):
 *   1. registerUpload -> get an upload URL + asset URN
 *   2. PUT/POST the raw bytes to that URL
 *   3. caller attaches the asset URN to the ugcPost (shareMediaCategory IMAGE/VIDEO)
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

function trunc(s: string, n = 200): string {
  return s.length > n ? `${s.slice(0, n)}...` : s;
}
