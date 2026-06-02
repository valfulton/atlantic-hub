/**
 * lib/social/handlers.ts
 *
 * The OAuth connect-flow handlers shared by the per-provider route files.
 *   handleOAuthStart    -> guarded; builds the authorize URL + state cookie
 *   handleOAuthCallback -> validates the state cookie, exchanges the code,
 *                          stores the connection
 *
 * AUTH MODEL
 *   /start is hit by a same-site navigation, so the operator session cookie
 *   is present and we guard it with guardAdminRequest (owner/staff only).
 *   /callback is hit by a cross-site top-level redirect from the provider,
 *   so the SameSite=Strict session cookie is NOT sent. Instead the callback
 *   trusts the short-lived httpOnly + SameSite=Lax state cookie that /start
 *   set: it carries the acting userId and could only have been created by an
 *   authenticated operator. middleware.ts lets the /callback path through for
 *   this reason; every other social route stays fully guarded.
 *
 * Both handlers return a tiny HTML page that closes the popup window (when
 * the flow was opened in one) or falls back to a full-page redirect to
 * /admin/social. No token value is ever logged.
 */

import { NextRequest, NextResponse } from 'next/server';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { guardAdminRequest } from '@/lib/api-guard';
import { getAvDb } from '@/lib/db/av';
import { encryptToken } from './encrypt';
import { completeOAuth } from './providers';
import { fetchLinkedInOrgs } from './org_acls';
import { addSuggestedTarget, attachConnection, markTargetError, getTargetById } from './targets';
import {
  PROVIDER_CONFIG,
  STATE_COOKIE,
  STATE_TTL_SECONDS,
  clientCredentials,
  codeChallengeS256,
  decodeStateBag,
  encodeStateBag,
  makeCodeVerifier,
  makeState,
  normalizeTenant,
  redirectUri,
  type SocialProvider
} from './oauth';

const COOKIE_BASE = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const, // lax so the cookie survives the provider's top-level redirect back
  path: '/'
};

/**
 * Return an HTML page that, if opened in a popup, notifies the opener and
 * closes itself; otherwise it redirects the full page to /admin/social with
 * the same query. `query` is a short ASCII string like "connected=linkedin"
 * or "oauth_error=state_expired".
 */
function finish(req: NextRequest, query: string): NextResponse {
  const target = new URL(`/admin/social?${query}`, req.nextUrl.origin).toString();
  const html =
    '<!doctype html><html><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Finishing connection</title></head>' +
    '<body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;' +
    'background:#0b0f14;color:#cbd5e1;font-family:system-ui,-apple-system,sans-serif">' +
    '<div style="text-align:center"><div style="font-size:14px;opacity:.8">Finishing up...</div></div>' +
    '<script>(function(){var q=' +
    JSON.stringify(query) +
    ';try{if(window.opener&&!window.opener.closed){' +
    'window.opener.postMessage({source:"social-oauth",query:q},window.location.origin);' +
    'window.close();return;}}catch(e){}' +
    'window.location.replace(' +
    JSON.stringify(target) +
    ');})();</script></body></html>';
  return new NextResponse(html, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }
  });
}

/**
 * (#45 Phase C) Intake-flow popup close. Posts the av:oauth:done message that
 * IntakeSocialChannelsBlock listens for, then closes the window. No fallback
 * redirect to /admin/social -- if the popup is somehow not a popup (rare),
 * show a plain "you can close this" message instead.
 */
function finishIntake(targetId: number, ok: boolean, reason?: string): NextResponse {
  const payload = {
    kind: 'av:oauth:done',
    targetId,
    connected: ok,
    reason: reason ?? null
  };
  const msg = JSON.stringify(payload);
  const headline = ok
    ? 'Connected. You can close this window.'
    : `Could not connect (${reason ?? 'unknown'}). You can close this window.`;
  const html =
    '<!doctype html><html><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Finishing connection</title></head>' +
    '<body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;' +
    'background:#0b0f14;color:#cbd5e1;font-family:system-ui,-apple-system,sans-serif">' +
    `<div style="text-align:center;padding:24px"><div style="font-size:14px;opacity:.85">${headline}</div></div>` +
    '<script>(function(){var m=' +
    msg +
    ';try{if(window.opener&&!window.opener.closed){' +
    'window.opener.postMessage(m,window.location.origin);' +
    'window.close();}}catch(e){}})();</script></body></html>';
  return new NextResponse(html, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }
  });
}

/**
 * (#45 Phase C) After a successful intake-flow OAuth, fetch the LinkedIn org
 * ACLs the new connection authorizes, and upsert one connected social_target
 * per org for the brand. Failures are non-fatal -- the personal target is
 * still attached even if the org fetch errors (we record the error on the
 * personal target so val can see it).
 *
 * connectionId : the social_connections.id just inserted/updated
 * clientId     : the brand the personal target belongs to
 * personalTargetId : the row to attach the personal connection to
 * accessToken  : in-memory only; never persisted again here
 */
async function discoverAndAttachOrgs(
  connectionId: number,
  clientId: number,
  personalTargetId: number,
  tenantId: string,
  provider: SocialProvider,
  personalUrn: string,
  accessToken: string
): Promise<void> {
  // 1. Attach the personal connection to the target the user clicked from.
  try {
    await attachConnection(personalTargetId, connectionId, personalUrn);
  } catch (e) {
    await markTargetError(personalTargetId, (e as Error).message.slice(0, 500));
    return;
  }

  // 2. Org discovery is LinkedIn-only for now (X has no analog). Skip silently.
  if (provider !== 'linkedin') return;

  const orgResult = await fetchLinkedInOrgs(accessToken);
  if (!orgResult.ok) {
    // Don't error the personal target -- it works; orgs just didn't come back.
    // last_error is set so val can see "missing_scope" on the panel and prompt
    // for a reconnect.
    if (orgResult.reason && orgResult.reason !== 'missing_scope') {
      // Soft signal; not destructive.
      console.warn(`[social:org_acls] ${orgResult.reason}`);
    }
    return;
  }

  for (const org of orgResult.orgs) {
    try {
      // Use the org's LinkedIn URL as the source_url for dedupe; this is the
      // canonical form the company-page URL parser also produces, so a
      // val-pasted "/company/<handle>" + an org-ACL row will merge naturally
      // once a future refresh resolves the slug. For now we identify by URN.
      const orgUrl = `https://www.linkedin.com/company/${org.orgId}/`;
      const r = await addSuggestedTarget({
        tenantId,
        clientId,
        url: orgUrl,
        source: 'client_intake',
        skipOgFetch: true // we already have name + logo from the ACL fetch
      });
      if (r.ok && r.target) {
        // Upgrade it straight to 'connected' since the OAuth that just happened
        // authorizes posting to it. attachConnection writes status='connected'
        // and the org URN + parent connection_id in one update.
        await attachConnection(r.target.id, connectionId, org.orgUrn);
        // Patch the display fields from the ACL response so the card reads
        // nicely without waiting on the next og refresh.
        if (org.orgName || org.orgLogoUrl) {
          try {
            const db = getAvDb();
            await db.execute<ResultSetHeader>(
              `UPDATE social_targets
                  SET display_name = COALESCE(?, display_name),
                      og_title     = COALESCE(?, og_title),
                      avatar_url   = COALESCE(?, avatar_url),
                      og_fetched_at = NOW()
                WHERE id = ?`,
              [org.orgName, org.orgName, org.orgLogoUrl, r.target.id]
            );
          } catch { /* non-fatal */ }
        }
      }
    } catch (e) {
      console.warn('[social:org_target_upsert]', (e as Error).message.slice(0, 200));
    }
  }
}

/** Best-effort fetch of the just-inserted connection's id (handles race in upsert). */
async function findConnectionId(tenantId: string, provider: SocialProvider, providerAccountId: string): Promise<number | null> {
  const db = getAvDb();
  const [rows] = await db.execute<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM social_connections
       WHERE tenant_id = ? AND provider = ? AND provider_account_id = ?
       LIMIT 1`,
    [tenantId, provider, providerAccountId]
  );
  return rows[0]?.id ?? null;
}

export async function handleOAuthStart(
  req: NextRequest,
  provider: SocialProvider
): Promise<NextResponse> {
  const guard = await guardAdminRequest(req, {
    targetResource: `/api/admin/social/oauth/${provider}/start`
  });
  if (!guard.ok) return finish(req, 'oauth_error=forbidden');
  if (guard.actor.role === 'client_user') return finish(req, 'oauth_error=forbidden');

  const cfg = PROVIDER_CONFIG[provider];
  const creds = clientCredentials(provider);
  if (!creds.id || !creds.secret) return finish(req, 'oauth_error=missing_client_config');

  const tenant = normalizeTenant(req.nextUrl.searchParams.get('tenant'));
  const state = makeState();
  const verifier = cfg.usesPkce ? makeCodeVerifier() : undefined;

  const authorize = new URL(cfg.authorizeUrl);
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('client_id', creds.id);
  authorize.searchParams.set('redirect_uri', redirectUri(provider));
  authorize.searchParams.set('state', state);
  authorize.searchParams.set('scope', cfg.scopes.join(' '));
  if (verifier) {
    authorize.searchParams.set('code_challenge', codeChallengeS256(verifier));
    authorize.searchParams.set('code_challenge_method', 'S256');
  }

  const bag = encodeStateBag({
    state,
    provider,
    tenant,
    verifier,
    uid: guard.actor.userId,
    ts: Math.floor(Date.now() / 1000)
  });

  const res = NextResponse.redirect(authorize.toString());
  res.cookies.set(STATE_COOKIE, bag, { ...COOKIE_BASE, maxAge: STATE_TTL_SECONDS });
  return res;
}

export async function handleOAuthCallback(
  req: NextRequest,
  provider: SocialProvider
): Promise<NextResponse> {
  // No guardAdminRequest here: the session cookie is not sent on this
  // cross-site return. Actor identity comes from the signed-by-possession
  // state cookie validated below.
  const params = req.nextUrl.searchParams;
  const providerError = params.get('error');
  if (providerError) {
    return finish(req, `oauth_error=${encodeURIComponent(providerError.slice(0, 60))}`);
  }

  const code = params.get('code');
  const returnedState = params.get('state');
  if (!code || !returnedState) return finish(req, 'oauth_error=missing_code');

  const bag = decodeStateBag(req.cookies.get(STATE_COOKIE)?.value);
  if (!bag) return finish(req, 'oauth_error=state_expired');
  if (bag.provider !== provider) return finish(req, 'oauth_error=state_provider_mismatch');
  if (bag.state !== returnedState) return finish(req, 'oauth_error=state_mismatch');
  // (#45 Phase C) Two trust paths now:
  //   - admin: must have a valid acting userId (existing behavior).
  //   - intake: must have a positive clientId + targetId. The intake share
  //     token was verified at /connect-start before this bag was minted, so we
  //     trust the bag's brand/target identifiers.
  const isIntake = bag.kind === 'intake';
  if (!isIntake) {
    if (!Number.isInteger(bag.uid) || bag.uid <= 0) return finish(req, 'oauth_error=bad_state');
  } else {
    if (!Number.isInteger(bag.clientId) || !bag.clientId || bag.clientId <= 0 ||
        !Number.isInteger(bag.targetId) || !bag.targetId || bag.targetId <= 0) {
      return finishIntake(bag.targetId || 0, false, 'bad_state');
    }
    // Sanity: target must still exist and belong to the brand the bag claims.
    const t = await getTargetById(bag.targetId);
    if (!t || t.clientId !== bag.clientId) {
      return finishIntake(bag.targetId, false, 'target_mismatch');
    }
  }

  let res: NextResponse;
  try {
    const result = await completeOAuth(provider, code, bag.verifier);

    const accessEnc = encryptToken(result.accessToken);
    const refreshEnc = result.refreshToken ? encryptToken(result.refreshToken) : null;

    // For intake flow, tenant is scoped to the brand the client_user belongs
    // to; for admin, the bag's tenant is the one the operator picked.
    const tenantForRow = isIntake ? `client:${bag.clientId}` : bag.tenant;

    const db = getAvDb();
    await db.execute<ResultSetHeader>(
      `INSERT INTO social_connections
         (tenant_id, provider, provider_account_id, display_name, avatar_url, scopes_json,
          access_token_enc, refresh_token_enc, access_token_expires_at, refresh_token_expires_at,
          status, last_error, connected_by_user_id, connected_at, last_used_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', NULL, ?, NOW(), NULL)
       ON DUPLICATE KEY UPDATE
          display_name = VALUES(display_name),
          avatar_url = VALUES(avatar_url),
          scopes_json = VALUES(scopes_json),
          access_token_enc = VALUES(access_token_enc),
          refresh_token_enc = VALUES(refresh_token_enc),
          access_token_expires_at = VALUES(access_token_expires_at),
          refresh_token_expires_at = VALUES(refresh_token_expires_at),
          status = 'active',
          last_error = NULL,
          connected_by_user_id = VALUES(connected_by_user_id),
          connected_at = NOW()`,
      [
        tenantForRow,
        provider,
        result.providerAccountId,
        result.displayName,
        result.avatarUrl,
        JSON.stringify(result.scopes),
        accessEnc,
        refreshEnc,
        result.accessTokenExpiresAt,
        result.refreshTokenExpiresAt,
        isIntake ? null : bag.uid
      ]
    );

    if (isIntake && bag.clientId && bag.targetId) {
      // Fetch the inserted/updated connection id and wire targets.
      const connectionId = await findConnectionId(tenantForRow, provider, result.providerAccountId);
      if (!connectionId) {
        res = finishIntake(bag.targetId, false, 'connection_lookup_failed');
      } else {
        const personalUrn = provider === 'linkedin' ? `urn:li:person:${result.providerAccountId}` : result.providerAccountId;
        await discoverAndAttachOrgs(
          connectionId,
          bag.clientId,
          bag.targetId,
          tenantForRow,
          provider,
          personalUrn,
          result.accessToken
        );
        res = finishIntake(bag.targetId, true);
      }
    } else {
      res = finish(req, `connected=${provider}`);
    }
  } catch (err) {
    // err.message is token-free (providers.ts truncates + omits secrets)
    console.error(`[social:oauth:${provider}:callback]`, (err as Error).name, (err as Error).message);
    res = isIntake && bag.targetId
      ? finishIntake(bag.targetId, false, 'exchange_failed')
      : finish(req, 'oauth_error=exchange_failed');
  }

  res.cookies.set(STATE_COOKIE, '', { ...COOKIE_BASE, maxAge: 0 }); // one-time use
  return res;
}
