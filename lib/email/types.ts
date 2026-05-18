/**
 * lib/email/types.ts
 *
 * Shared types for the email driver layer.
 *
 * Three drivers ship in v1, all owned by the operator (no third-party
 * cold-email SaaS):
 *   hostgator_smtp   -- standard SMTP over TLS to mail.<domain>
 *   microsoft_graph  -- OAuth2; sends via Microsoft Graph API
 *   gmail_api        -- OAuth2; sends via Gmail API
 *
 * Each driver implements the MailDriver interface in lib/email/driver.ts.
 * Credentials are stored encrypted in shhdbite_AV.outreach_mailboxes
 * (see schema/014_outreach.sql) using lib/email/encrypt.ts.
 */

export type MailDriverKind = 'hostgator_smtp' | 'microsoft_graph' | 'gmail_api';

export type MailboxStatus = 'active' | 'pending_oauth' | 'disconnected' | 'error';

export type SendOutcome =
  | 'success'
  | 'auth_error'
  | 'connection_error'
  | 'rate_limited'
  | 'quota_exceeded'
  | 'invalid_recipient'
  | 'other_error';

/**
 * Driver-specific credential shapes. Stored encrypted as the JSON-stringified
 * form of one of these. Never persisted plaintext.
 */
export interface HostGatorSmtpCredentials {
  kind: 'hostgator_smtp';
  /** SMTP host -- typically mail.<domain> or the value HostGator gives in cPanel */
  host: string;
  /** SMTP port -- usually 465 (SSL) or 587 (STARTTLS) */
  port: number;
  /** true for port 465 (implicit TLS), false for 587 (STARTTLS upgrade) */
  secure: boolean;
  /** SMTP auth user -- usually the full email address */
  user: string;
  /** SMTP auth password -- the email account password set in cPanel */
  pass: string;
  /** Optional IMAP host for reply polling. Same domain in HostGator. */
  imapHost?: string;
  /** Optional IMAP port -- 993 for SSL */
  imapPort?: number;
}

export interface MicrosoftGraphCredentials {
  kind: 'microsoft_graph';
  /** Long-lived refresh token from the OAuth flow */
  refreshToken: string;
  /** Most-recent access token (short-lived); refreshed on demand */
  accessToken: string;
  /** When the access token expires (epoch ms) */
  accessTokenExpiresAt: number;
  /** Microsoft tenant id (may be 'common' for personal + work accounts) */
  tenantId: string;
  /** Scopes granted at consent time */
  scopes: string[];
  /** The user principal name we authenticated as (e.g. val@atlanticandvine.com) */
  userPrincipalName?: string;
}

export interface GmailApiCredentials {
  kind: 'gmail_api';
  /** Long-lived refresh token from the OAuth flow */
  refreshToken: string;
  /** Most-recent access token */
  accessToken: string;
  /** When the access token expires (epoch ms) */
  accessTokenExpiresAt: number;
  /** Scopes granted at consent time */
  scopes: string[];
  /** The Google account email we authenticated as */
  emailAddress?: string;
}

export type MailboxCredentials =
  | HostGatorSmtpCredentials
  | MicrosoftGraphCredentials
  | GmailApiCredentials;

/**
 * The mailbox row as it lives in the DB, plus decoded credentials.
 * Returned by lib/email/mailbox.ts loadMailbox().
 */
export interface MailboxRecord {
  id: number;
  organizationId: number | null;
  displayName: string;
  fromAddress: string;
  fromName: string | null;
  replyToAddress: string | null;
  driver: MailDriverKind;
  credentials: MailboxCredentials | null;
  status: MailboxStatus;
  dailySendCount: number;
  dailySendResetAt: string | null;
  lastTestAt: string | null;
  lastTestOutcome: 'success' | 'auth_error' | 'connection_error' | 'other_error' | null;
  lastError: string | null;
  createdByUserId: number | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface SendMessageInput {
  to: string;
  toName?: string;
  subject: string;
  bodyPlain: string;
  bodyHtml?: string;
  /** Optional Message-ID we want stamped on the outbound (so reply matching works) */
  ourMessageId?: string;
  /** Optional headers to thread replies for sequence_step > 1 */
  inReplyTo?: string;
  references?: string[];
}

export interface SendMessageResult {
  outcome: SendOutcome;
  providerMessageId: string | null;
  /** Free-form provider response, useful for debugging in outreach_send_log */
  providerResponse: string | null;
  latencyMs: number;
  errorMessage: string | null;
}

export interface InboundReply {
  /** Whichever the driver gives us as a stable id for this inbound message */
  providerMessageId: string;
  fromAddress: string;
  subject: string | null;
  bodyPlain: string;
  /** RFC822 In-Reply-To header -- used to match back to outreach_messages.provider_message_id */
  inReplyTo: string | null;
  references: string[];
  receivedAt: Date;
  rawPayload: unknown;
}

export interface TestConnectionResult {
  ok: boolean;
  outcome: 'success' | 'auth_error' | 'connection_error' | 'other_error';
  message: string;
  latencyMs: number;
}
