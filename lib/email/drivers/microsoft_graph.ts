/**
 * lib/email/drivers/microsoft_graph.ts
 *
 * Microsoft Graph driver for sending + reading email from Outlook /
 * Microsoft 365 mailboxes via OAuth2.
 *
 * AUTH MODEL
 *   - Operator (val) or client connects their mailbox via the OAuth
 *     handoff at /api/admin/av/outreach/mailboxes/oauth/microsoft/start.
 *   - We receive the auth code on /callback, exchange it for an access
 *     token + long-lived refresh token, and store both encrypted in
 *     outreach_mailboxes.credentials_encrypted (MicrosoftGraphCredentials).
 *   - On every API call, if the access token is within 60s of expiring,
 *     we refresh it transparently and persist the new value.
 *
 * REQUIRED AZURE APP REGISTRATION SCOPES (delegated):
 *   - offline_access
 *   - Mail.Send
 *   - Mail.Read
 *   - User.Read   (for whoami / from-address lookup)
 *
 * REQUIRED NETLIFY ENV VARS:
 *   - MICROSOFT_OAUTH_CLIENT_ID
 *   - MICROSOFT_OAUTH_CLIENT_SECRET
 *   - MICROSOFT_OAUTH_REDIRECT_URI   (e.g. https://atlantic-hub.netlify.app/api/admin/av/outreach/mailboxes/oauth/microsoft/callback)
 *
 * Endpoints used (validated 2026-05 against learn.microsoft.com/graph):
 *   - https://graph.microsoft.com/v1.0/me/sendMail
 *   - https://graph.microsoft.com/v1.0/me/messages   (list inbox for reply polling)
 *   - https://graph.microsoft.com/v1.0/me
 *   - https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token
 */

import { getAvDb } from '@/lib/db/av';
import type { ResultSetHeader } from 'mysql2';
import { encryptJson } from '@/lib/email/encrypt';
import type { MailDriver } from '@/lib/email/driver';
import type {
  InboundReply,
  MailboxRecord,
  MicrosoftGraphCredentials,
  SendMessageInput,
  SendMessageResult,
  TestConnectionResult
} from '@/lib/email/types';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const TOKEN_URL = (tenant: string) =>
  `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;
const REFRESH_BUFFER_MS = 60_000;

export class MicrosoftGraphConfigError extends Error {
  constructor(missing: string) {
    super(`Microsoft Graph driver requires ${missing} in Netlify env vars`);
    this.name = 'MicrosoftGraphConfigError';
  }
}

export class MicrosoftGraphAuthError extends Error {
  constructor(message: string) {
    super(`Microsoft Graph auth failed: ${message}`);
    this.name = 'MicrosoftGraphAuthError';
  }
}

export class MicrosoftGraphDriver implements MailDriver {
  readonly kind = 'microsoft_graph' as const;

  async sendMessage(
    mailbox: MailboxRecord,
    msg: SendMessageInput
  ): Promise<SendMessageResult> {
    const started = Date.now();
    let creds: MicrosoftGraphCredentials;
    try {
      creds = await ensureFreshToken(mailbox);
    } catch (err) {
      return {
        outcome: 'auth_error',
        providerMessageId: null,
        providerResponse: null,
        latencyMs: Date.now() - started,
        errorMessage: truncate((err as Error).message, 500)
      };
    }

    const body = {
      message: {
        subject: msg.subject,
        body: msg.bodyHtml
          ? { contentType: 'HTML', content: msg.bodyHtml }
          : { contentType: 'Text', content: msg.bodyPlain },
        toRecipients: [
          {
            emailAddress: msg.toName
              ? { name: msg.toName, address: msg.to }
              : { address: msg.to }
          }
        ],
        from: { emailAddress: { address: mailbox.fromAddress, name: mailbox.fromName ?? undefined } },
        replyTo: mailbox.replyToAddress
          ? [{ emailAddress: { address: mailbox.replyToAddress } }]
          : undefined,
        internetMessageHeaders: buildInternetHeaders(msg)
      },
      saveToSentItems: true
    };

    const res = await fetch(`${GRAPH_BASE}/me/sendMail`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    const latencyMs = Date.now() - started;

    if (res.status === 202) {
      // 202 Accepted -- Microsoft does not return a message id on /sendMail.
      // We stamp our own ourMessageId via internetMessageHeaders (above)
      // and use it as the provider_message_id for reply matching.
      return {
        outcome: 'success',
        providerMessageId: msg.ourMessageId ?? null,
        providerResponse: '202 Accepted',
        latencyMs,
        errorMessage: null
      };
    }

    const errText = await safeReadText(res);
    return {
      outcome: classifyGraphStatus(res.status),
      providerMessageId: null,
      providerResponse: truncate(errText, 1000),
      latencyMs,
      errorMessage: truncate(`Graph ${res.status}: ${errText}`, 500)
    };
  }

  async fetchReplies(mailbox: MailboxRecord, since: Date | null): Promise<InboundReply[]> {
    const creds = await ensureFreshToken(mailbox);
    const filterParts: string[] = [];
    if (since) {
      filterParts.push(`receivedDateTime ge ${since.toISOString()}`);
    }
    const params = new URLSearchParams({
      $top: '50',
      $orderby: 'receivedDateTime desc',
      $select:
        'id,subject,from,receivedDateTime,internetMessageId,conversationId,bodyPreview,body,internetMessageHeaders'
    });
    if (filterParts.length > 0) params.set('$filter', filterParts.join(' and '));

    const res = await fetch(`${GRAPH_BASE}/me/messages?${params.toString()}`, {
      headers: { Authorization: `Bearer ${creds.accessToken}` }
    });
    if (!res.ok) {
      // Don't throw -- reply polling failures should not crash the cron.
      console.error('[microsoft_graph:fetchReplies]', res.status, await safeReadText(res));
      return [];
    }
    const json = (await res.json()) as {
      value: Array<{
        id: string;
        subject: string | null;
        from?: { emailAddress?: { address?: string; name?: string } };
        receivedDateTime: string;
        internetMessageId?: string;
        bodyPreview?: string;
        body?: { contentType: string; content: string };
        internetMessageHeaders?: Array<{ name: string; value: string }>;
      }>;
    };

    return json.value.map((m) => {
      const inReplyTo = headerValue(m.internetMessageHeaders, 'In-Reply-To');
      const refsRaw = headerValue(m.internetMessageHeaders, 'References');
      return {
        providerMessageId: m.internetMessageId || m.id,
        fromAddress: m.from?.emailAddress?.address ?? 'unknown',
        subject: m.subject,
        bodyPlain: stripHtml(m.body?.content ?? m.bodyPreview ?? ''),
        inReplyTo: inReplyTo,
        references: refsRaw
          ? refsRaw.split(/\s+/).map((s) => s.trim()).filter(Boolean)
          : [],
        receivedAt: new Date(m.receivedDateTime),
        rawPayload: m
      };
    });
  }

  async testConnection(mailbox: MailboxRecord): Promise<TestConnectionResult> {
    const started = Date.now();
    try {
      const creds = await ensureFreshToken(mailbox);
      const res = await fetch(`${GRAPH_BASE}/me`, {
        headers: { Authorization: `Bearer ${creds.accessToken}` }
      });
      if (!res.ok) {
        return {
          ok: false,
          outcome: res.status === 401 || res.status === 403 ? 'auth_error' : 'other_error',
          message: truncate(`Graph /me returned ${res.status}: ${await safeReadText(res)}`, 500),
          latencyMs: Date.now() - started
        };
      }
      return {
        ok: true,
        outcome: 'success',
        message: 'Microsoft Graph connection OK',
        latencyMs: Date.now() - started
      };
    } catch (err) {
      return {
        ok: false,
        outcome: 'auth_error',
        message: truncate((err as Error).message, 500),
        latencyMs: Date.now() - started
      };
    }
  }
}

// ---------------------------------------------------------------------
// OAuth + token helpers
// ---------------------------------------------------------------------

/**
 * Exchange an auth code (from the OAuth redirect) for a token bundle.
 * Used by the /oauth/microsoft/callback route. Exported separately so
 * the route can persist the result without going through driver methods.
 */
export async function exchangeMicrosoftCode(args: {
  code: string;
  tenant?: string;
}): Promise<MicrosoftGraphCredentials & { userPrincipalName?: string }> {
  const clientId = requireEnv('MICROSOFT_OAUTH_CLIENT_ID');
  const clientSecret = requireEnv('MICROSOFT_OAUTH_CLIENT_SECRET');
  const redirectUri = requireEnv('MICROSOFT_OAUTH_REDIRECT_URI');
  const tenant = args.tenant || 'common';

  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code: args.code,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
    scope: 'offline_access Mail.Send Mail.Read User.Read'
  });

  const res = await fetch(TOKEN_URL(tenant), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });
  if (!res.ok) {
    throw new MicrosoftGraphAuthError(`code exchange failed (${res.status}): ${await safeReadText(res)}`);
  }
  const json = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    scope: string;
  };

  // Best-effort whoami so we capture the principal email
  let userPrincipalName: string | undefined;
  try {
    const me = await fetch(`${GRAPH_BASE}/me`, {
      headers: { Authorization: `Bearer ${json.access_token}` }
    });
    if (me.ok) {
      const meJson = (await me.json()) as { userPrincipalName?: string; mail?: string };
      userPrincipalName = meJson.userPrincipalName || meJson.mail;
    }
  } catch {
    // ignore -- not required
  }

  return {
    kind: 'microsoft_graph',
    refreshToken: json.refresh_token,
    accessToken: json.access_token,
    accessTokenExpiresAt: Date.now() + json.expires_in * 1000,
    tenantId: tenant,
    scopes: json.scope.split(/\s+/),
    userPrincipalName
  };
}

/**
 * Build the consent URL that starts the OAuth dance. The state param
 * binds the request to a freshly inserted pending mailbox row so the
 * callback can find which mailbox to populate.
 */
export function buildMicrosoftAuthUrl(args: { state: string; loginHint?: string }): string {
  const clientId = requireEnv('MICROSOFT_OAUTH_CLIENT_ID');
  const redirectUri = requireEnv('MICROSOFT_OAUTH_REDIRECT_URI');
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    response_mode: 'query',
    scope: 'offline_access Mail.Send Mail.Read User.Read',
    state: args.state
  });
  if (args.loginHint) params.set('login_hint', args.loginHint);
  return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`;
}

async function ensureFreshToken(mailbox: MailboxRecord): Promise<MicrosoftGraphCredentials> {
  if (!mailbox.credentials || mailbox.credentials.kind !== 'microsoft_graph') {
    throw new MicrosoftGraphAuthError(
      `mailbox ${mailbox.id} has no microsoft_graph credentials`
    );
  }
  const creds = mailbox.credentials;
  if (creds.accessTokenExpiresAt - REFRESH_BUFFER_MS > Date.now()) {
    return creds;
  }

  const clientId = requireEnv('MICROSOFT_OAUTH_CLIENT_ID');
  const clientSecret = requireEnv('MICROSOFT_OAUTH_CLIENT_SECRET');
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: creds.refreshToken,
    grant_type: 'refresh_token',
    scope: 'offline_access Mail.Send Mail.Read User.Read'
  });
  const res = await fetch(TOKEN_URL(creds.tenantId || 'common'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });
  if (!res.ok) {
    throw new MicrosoftGraphAuthError(`refresh failed (${res.status}): ${await safeReadText(res)}`);
  }
  const json = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope?: string;
  };
  const updated: MicrosoftGraphCredentials = {
    ...creds,
    accessToken: json.access_token,
    refreshToken: json.refresh_token || creds.refreshToken,
    accessTokenExpiresAt: Date.now() + json.expires_in * 1000,
    scopes: json.scope ? json.scope.split(/\s+/) : creds.scopes
  };
  // Persist refreshed creds back to the DB. Best-effort; if the write
  // fails we still return the working token for this call.
  try {
    const db = getAvDb();
    await db.execute<ResultSetHeader>(
      `UPDATE outreach_mailboxes SET credentials_encrypted = ?, updated_at = NOW() WHERE id = ?`,
      [encryptJson(updated), mailbox.id]
    );
    // Mutate the in-memory record too, so the caller's subsequent calls in
    // the same request reuse the fresh token.
    (mailbox.credentials as MicrosoftGraphCredentials).accessToken = updated.accessToken;
    (mailbox.credentials as MicrosoftGraphCredentials).accessTokenExpiresAt =
      updated.accessTokenExpiresAt;
    (mailbox.credentials as MicrosoftGraphCredentials).refreshToken = updated.refreshToken;
  } catch (err) {
    console.error('[microsoft_graph:persist-refresh]', (err as Error).message);
  }
  return updated;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new MicrosoftGraphConfigError(name);
  return v;
}

function buildInternetHeaders(msg: SendMessageInput): Array<{ name: string; value: string }> {
  const headers: Array<{ name: string; value: string }> = [];
  if (msg.ourMessageId) {
    headers.push({ name: 'x-atlantic-hub-message-id', value: stripAngles(msg.ourMessageId) });
  }
  if (msg.inReplyTo) {
    headers.push({ name: 'In-Reply-To', value: ensureAngles(msg.inReplyTo) });
  }
  if (msg.references && msg.references.length > 0) {
    headers.push({ name: 'References', value: msg.references.map(ensureAngles).join(' ') });
  }
  return headers;
}

function ensureAngles(id: string): string {
  const t = id.trim();
  return t.startsWith('<') && t.endsWith('>') ? t : `<${t}>`;
}
function stripAngles(id: string): string {
  return id.trim().replace(/^<|>$/g, '');
}

function headerValue(
  headers: Array<{ name: string; value: string }> | undefined,
  name: string
): string | null {
  if (!headers) return null;
  const h = headers.find((h) => h.name.toLowerCase() === name.toLowerCase());
  return h?.value ?? null;
}

function stripHtml(s: string): string {
  return s
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>(\n)?/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function classifyGraphStatus(status: number): SendMessageResult['outcome'] {
  if (status === 401 || status === 403) return 'auth_error';
  if (status === 429) return 'rate_limited';
  if (status === 507) return 'quota_exceeded';
  if (status >= 400 && status < 500) return 'other_error';
  return 'connection_error';
}
