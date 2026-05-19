/**
 * lib/email/drivers/gmail.ts
 *
 * Gmail API driver. Sends + reads via the Gmail REST API using OAuth2.
 * Same shape as the Microsoft Graph driver -- credentials are an OAuth
 * access + refresh token bundle, refreshed on demand.
 *
 * REQUIRED GOOGLE CLOUD PROJECT SCOPES:
 *   - https://www.googleapis.com/auth/gmail.send
 *   - https://www.googleapis.com/auth/gmail.readonly  (for reply polling)
 *   - https://www.googleapis.com/auth/userinfo.email  (for whoami / from-address)
 *
 * REQUIRED NETLIFY ENV VARS:
 *   - GOOGLE_OAUTH_CLIENT_ID
 *   - GOOGLE_OAUTH_CLIENT_SECRET
 *   - GOOGLE_OAUTH_REDIRECT_URI   (e.g. https://atlantic-hub.netlify.app/api/admin/av/outreach/mailboxes/oauth/google/callback)
 *
 * Endpoints used:
 *   - https://www.googleapis.com/gmail/v1/users/me/messages/send
 *   - https://www.googleapis.com/gmail/v1/users/me/messages          (list inbox)
 *   - https://www.googleapis.com/gmail/v1/users/me/messages/{id}     (fetch one)
 *   - https://oauth2.googleapis.com/token                            (refresh)
 */

import { Buffer } from 'buffer';
import { getAvDb } from '@/lib/db/av';
import type { ResultSetHeader } from 'mysql2';
import { encryptJson } from '@/lib/email/encrypt';
import type { MailDriver } from '@/lib/email/driver';
import type {
  GmailApiCredentials,
  InboundReply,
  MailboxRecord,
  SendMessageInput,
  SendMessageResult,
  TestConnectionResult
} from '@/lib/email/types';

const GMAIL_BASE = 'https://www.googleapis.com/gmail/v1';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';
const REFRESH_BUFFER_MS = 60_000;
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/userinfo.email'
];

export class GmailConfigError extends Error {
  constructor(missing: string) {
    super(`Gmail driver requires ${missing} in Netlify env vars`);
    this.name = 'GmailConfigError';
  }
}

export class GmailAuthError extends Error {
  constructor(message: string) {
    super(`Gmail auth failed: ${message}`);
    this.name = 'GmailAuthError';
  }
}

export class GmailApiDriver implements MailDriver {
  readonly kind = 'gmail_api' as const;

  async sendMessage(
    mailbox: MailboxRecord,
    msg: SendMessageInput
  ): Promise<SendMessageResult> {
    const started = Date.now();
    let creds: GmailApiCredentials;
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

    const rfc822 = buildRfc822(mailbox, msg);
    const raw = base64UrlEncode(rfc822);

    const res = await fetch(`${GMAIL_BASE}/users/me/messages/send`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ raw })
    });

    const latencyMs = Date.now() - started;

    if (res.ok) {
      const json = (await res.json()) as { id: string; threadId: string };
      return {
        outcome: 'success',
        providerMessageId: msg.ourMessageId ?? json.id,
        providerResponse: `id=${json.id} thread=${json.threadId}`,
        latencyMs,
        errorMessage: null
      };
    }
    const errText = await safeReadText(res);
    return {
      outcome: classifyGmailStatus(res.status),
      providerMessageId: null,
      providerResponse: truncate(errText, 1000),
      latencyMs,
      errorMessage: truncate(`Gmail ${res.status}: ${errText}`, 500)
    };
  }

  async fetchReplies(mailbox: MailboxRecord, since: Date | null): Promise<InboundReply[]> {
    const creds = await ensureFreshToken(mailbox);
    // Gmail's q= search syntax. Use after:<unix-seconds> when we have a since.
    const q =
      since != null
        ? `in:inbox after:${Math.floor(since.getTime() / 1000)}`
        : 'in:inbox newer_than:7d';
    const listRes = await fetch(
      `${GMAIL_BASE}/users/me/messages?maxResults=50&q=${encodeURIComponent(q)}`,
      { headers: { Authorization: `Bearer ${creds.accessToken}` } }
    );
    if (!listRes.ok) {
      console.error('[gmail:listReplies]', listRes.status, await safeReadText(listRes));
      return [];
    }
    const listJson = (await listRes.json()) as {
      messages?: Array<{ id: string; threadId: string }>;
    };
    const ids = listJson.messages?.map((m) => m.id) ?? [];
    const out: InboundReply[] = [];

    for (const id of ids) {
      const res = await fetch(
        `${GMAIL_BASE}/users/me/messages/${id}?format=full`,
        { headers: { Authorization: `Bearer ${creds.accessToken}` } }
      );
      if (!res.ok) continue;
      const m = (await res.json()) as GmailMessage;
      const headers = m.payload?.headers ?? [];
      const subject = pickHeader(headers, 'Subject');
      const from = pickHeader(headers, 'From');
      const inReplyTo = pickHeader(headers, 'In-Reply-To');
      const refsRaw = pickHeader(headers, 'References');
      const internetMessageId = pickHeader(headers, 'Message-ID') || m.id;
      const dateMs = parseInt(m.internalDate || '0', 10);
      out.push({
        providerMessageId: internetMessageId,
        fromAddress: extractEmailFromHeader(from || 'unknown'),
        subject: subject,
        bodyPlain: extractPlainBody(m.payload),
        inReplyTo: inReplyTo,
        references: refsRaw
          ? refsRaw.split(/\s+/).map((s) => s.trim()).filter(Boolean)
          : [],
        receivedAt: dateMs > 0 ? new Date(dateMs) : new Date(),
        rawPayload: m
      });
    }

    return out;
  }

  async testConnection(mailbox: MailboxRecord): Promise<TestConnectionResult> {
    const started = Date.now();
    try {
      const creds = await ensureFreshToken(mailbox);
      const res = await fetch(USERINFO_URL, {
        headers: { Authorization: `Bearer ${creds.accessToken}` }
      });
      if (!res.ok) {
        return {
          ok: false,
          outcome: res.status === 401 || res.status === 403 ? 'auth_error' : 'other_error',
          message: truncate(`userinfo returned ${res.status}: ${await safeReadText(res)}`, 500),
          latencyMs: Date.now() - started
        };
      }
      return {
        ok: true,
        outcome: 'success',
        message: 'Gmail API connection OK',
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
// OAuth helpers
// ---------------------------------------------------------------------

export async function exchangeGoogleCode(args: {
  code: string;
}): Promise<GmailApiCredentials & { emailAddress?: string }> {
  const clientId = requireEnv('GOOGLE_OAUTH_CLIENT_ID');
  const clientSecret = requireEnv('GOOGLE_OAUTH_CLIENT_SECRET');
  const redirectUri = requireEnv('GOOGLE_OAUTH_REDIRECT_URI');
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code: args.code,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code'
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });
  if (!res.ok) {
    throw new GmailAuthError(`code exchange failed (${res.status}): ${await safeReadText(res)}`);
  }
  const json = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    scope: string;
  };

  let emailAddress: string | undefined;
  try {
    const ui = await fetch(USERINFO_URL, {
      headers: { Authorization: `Bearer ${json.access_token}` }
    });
    if (ui.ok) {
      const uj = (await ui.json()) as { email?: string };
      emailAddress = uj.email;
    }
  } catch {
    // ignore
  }

  return {
    kind: 'gmail_api',
    refreshToken: json.refresh_token,
    accessToken: json.access_token,
    accessTokenExpiresAt: Date.now() + json.expires_in * 1000,
    scopes: json.scope.split(/\s+/),
    emailAddress
  };
}

export function buildGoogleAuthUrl(args: { state: string; loginHint?: string }): string {
  const clientId = requireEnv('GOOGLE_OAUTH_CLIENT_ID');
  const redirectUri = requireEnv('GOOGLE_OAUTH_REDIRECT_URI');
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state: args.state
  });
  if (args.loginHint) params.set('login_hint', args.loginHint);
  return `${AUTH_URL}?${params.toString()}`;
}

async function ensureFreshToken(mailbox: MailboxRecord): Promise<GmailApiCredentials> {
  if (!mailbox.credentials || mailbox.credentials.kind !== 'gmail_api') {
    throw new GmailAuthError(`mailbox ${mailbox.id} has no gmail_api credentials`);
  }
  const creds = mailbox.credentials;
  if (creds.accessTokenExpiresAt - REFRESH_BUFFER_MS > Date.now()) {
    return creds;
  }

  const clientId = requireEnv('GOOGLE_OAUTH_CLIENT_ID');
  const clientSecret = requireEnv('GOOGLE_OAUTH_CLIENT_SECRET');
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: creds.refreshToken,
    grant_type: 'refresh_token'
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });
  if (!res.ok) {
    throw new GmailAuthError(`refresh failed (${res.status}): ${await safeReadText(res)}`);
  }
  const json = (await res.json()) as {
    access_token: string;
    expires_in: number;
    scope?: string;
  };
  const updated: GmailApiCredentials = {
    ...creds,
    accessToken: json.access_token,
    accessTokenExpiresAt: Date.now() + json.expires_in * 1000,
    scopes: json.scope ? json.scope.split(/\s+/) : creds.scopes
  };
  try {
    const db = getAvDb();
    await db.execute<ResultSetHeader>(
      `UPDATE outreach_mailboxes SET credentials_encrypted = ?, updated_at = NOW() WHERE id = ?`,
      [encryptJson(updated), mailbox.id]
    );
    (mailbox.credentials as GmailApiCredentials).accessToken = updated.accessToken;
    (mailbox.credentials as GmailApiCredentials).accessTokenExpiresAt =
      updated.accessTokenExpiresAt;
  } catch (err) {
    console.error('[gmail:persist-refresh]', (err as Error).message);
  }
  return updated;
}

// ---------------------------------------------------------------------
// RFC822 + base64url helpers
// ---------------------------------------------------------------------

function buildRfc822(mailbox: MailboxRecord, msg: SendMessageInput): string {
  const fromHeader = mailbox.fromName
    ? `${quotedName(mailbox.fromName)} <${mailbox.fromAddress}>`
    : mailbox.fromAddress;
  const toHeader = msg.toName ? `${quotedName(msg.toName)} <${msg.to}>` : msg.to;

  const lines: string[] = [];
  lines.push(`From: ${fromHeader}`);
  lines.push(`To: ${toHeader}`);
  if (mailbox.replyToAddress) lines.push(`Reply-To: ${mailbox.replyToAddress}`);
  lines.push(`Subject: ${headerEncode(msg.subject)}`);
  lines.push(`MIME-Version: 1.0`);
  if (msg.ourMessageId) lines.push(`Message-ID: ${ensureAngles(msg.ourMessageId)}`);
  if (msg.inReplyTo) lines.push(`In-Reply-To: ${ensureAngles(msg.inReplyTo)}`);
  if (msg.references && msg.references.length > 0) {
    lines.push(`References: ${msg.references.map(ensureAngles).join(' ')}`);
  }

  if (msg.bodyHtml) {
    const boundary = `bnd_${Math.random().toString(36).slice(2)}`;
    lines.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    lines.push('');
    lines.push(`--${boundary}`);
    lines.push('Content-Type: text/plain; charset="UTF-8"');
    lines.push('Content-Transfer-Encoding: 7bit');
    lines.push('');
    lines.push(msg.bodyPlain);
    lines.push('');
    lines.push(`--${boundary}`);
    lines.push('Content-Type: text/html; charset="UTF-8"');
    lines.push('Content-Transfer-Encoding: 7bit');
    lines.push('');
    lines.push(msg.bodyHtml);
    lines.push('');
    lines.push(`--${boundary}--`);
  } else {
    lines.push('Content-Type: text/plain; charset="UTF-8"');
    lines.push('Content-Transfer-Encoding: 7bit');
    lines.push('');
    lines.push(msg.bodyPlain);
  }
  return lines.join('\r\n');
}

function base64UrlEncode(s: string): string {
  return Buffer.from(s, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function quotedName(s: string): string {
  return `"${s.replace(/"/g, '\\"')}"`;
}
function ensureAngles(id: string): string {
  const t = id.trim();
  return t.startsWith('<') && t.endsWith('>') ? t : `<${t}>`;
}
function headerEncode(s: string): string {
  // If subject contains non-ASCII, RFC 2047-encode it.
  if (/^[\x20-\x7E]*$/.test(s)) return s;
  const b64 = Buffer.from(s, 'utf8').toString('base64');
  return `=?UTF-8?B?${b64}?=`;
}

// ---------------------------------------------------------------------
// Gmail payload parsing
// ---------------------------------------------------------------------

interface GmailHeader {
  name: string;
  value: string;
}
interface GmailPayloadPart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { size?: number; data?: string; attachmentId?: string };
  parts?: GmailPayloadPart[];
}
interface GmailMessage {
  id: string;
  threadId?: string;
  internalDate?: string;
  payload?: GmailPayloadPart;
}

function pickHeader(headers: GmailHeader[], name: string): string | null {
  const h = headers.find((h) => h.name.toLowerCase() === name.toLowerCase());
  return h?.value ?? null;
}

function extractPlainBody(payload: GmailPayloadPart | undefined): string {
  if (!payload) return '';
  const plain = findPart(payload, (p) => p.mimeType === 'text/plain');
  if (plain) return decodeBody(plain.body?.data);
  const html = findPart(payload, (p) => p.mimeType === 'text/html');
  if (html) return stripHtml(decodeBody(html.body?.data));
  if (payload.body?.data) return decodeBody(payload.body.data);
  return '';
}

function findPart(
  payload: GmailPayloadPart,
  pred: (p: GmailPayloadPart) => boolean
): GmailPayloadPart | null {
  if (pred(payload)) return payload;
  if (payload.parts) {
    for (const p of payload.parts) {
      const hit = findPart(p, pred);
      if (hit) return hit;
    }
  }
  return null;
}

function decodeBody(data: string | undefined): string {
  if (!data) return '';
  const padded = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(padded, 'base64').toString('utf8');
}

function extractEmailFromHeader(h: string): string {
  const m = h.match(/<([^>]+)>/);
  return m ? m[1] : h.trim();
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

// ---------------------------------------------------------------------
// shared helpers
// ---------------------------------------------------------------------

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new GmailConfigError(name);
  return v;
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
function classifyGmailStatus(status: number): SendMessageResult['outcome'] {
  if (status === 401 || status === 403) return 'auth_error';
  if (status === 429) return 'rate_limited';
  if (status === 507) return 'quota_exceeded';
  if (status >= 400 && status < 500) return 'other_error';
  return 'connection_error';
}
