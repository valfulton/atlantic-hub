/**
 * lib/email/drivers/hostgator.ts
 *
 * SMTP driver for HostGator-hosted mailboxes (and any other classic
 * cPanel SMTP). Uses nodemailer for the actual SMTP transport.
 *
 * V1 SCOPE: send-only. Reply polling for SMTP/IMAP mailboxes lands in
 * v2 (see docs/CLAUDE_KICKOFF_EMAIL_AUTOMATION.md "Replies" section).
 * fetchReplies() returns [] for this driver and logs a single warning
 * line per call -- safe to wire it into the cron without breaking
 * anything.
 *
 * Recommended HostGator cPanel settings:
 *   Host:     mail.<your-domain>
 *   Port:     465 (SSL) or 587 (STARTTLS)
 *   Secure:   true for 465, false for 587
 *   User:     full email address (e.g. outreach@atlanticandvine.com)
 *   Pass:     the password set in cPanel > Email Accounts
 *
 * Deliverability requires SPF + DKIM + DMARC on your sending domain.
 * See docs/COMMERCIAL_GOLIVE_RUNBOOK.md "DNS for email" section for
 * the exact records.
 */

import nodemailer from 'nodemailer';
import type { MailDriver } from '@/lib/email/driver';
import type {
  HostGatorSmtpCredentials,
  InboundReply,
  MailboxRecord,
  SendMessageInput,
  SendMessageResult,
  TestConnectionResult
} from '@/lib/email/types';

export class HostGatorSmtpDriver implements MailDriver {
  readonly kind = 'hostgator_smtp' as const;

  async sendMessage(
    mailbox: MailboxRecord,
    msg: SendMessageInput
  ): Promise<SendMessageResult> {
    const started = Date.now();
    const creds = requireCreds(mailbox);
    const transport = nodemailer.createTransport({
      host: creds.host,
      port: creds.port,
      secure: creds.secure,
      auth: { user: creds.user, pass: creds.pass },
      // Modest timeouts -- HostGator SMTP can be slow at peak hours.
      connectionTimeout: 15_000,
      greetingTimeout: 10_000,
      socketTimeout: 30_000
    });

    try {
      const fromHeader = formatFromHeader(mailbox);
      const headers: Record<string, string> = {};
      if (msg.ourMessageId) headers['Message-ID'] = ensureAngleBrackets(msg.ourMessageId);
      if (msg.inReplyTo) headers['In-Reply-To'] = ensureAngleBrackets(msg.inReplyTo);
      if (msg.references && msg.references.length > 0) {
        headers['References'] = msg.references.map(ensureAngleBrackets).join(' ');
      }

      const info = await transport.sendMail({
        from: fromHeader,
        to: msg.toName ? `"${escapeQuotes(msg.toName)}" <${msg.to}>` : msg.to,
        replyTo: mailbox.replyToAddress || undefined,
        subject: msg.subject,
        text: msg.bodyPlain,
        html: msg.bodyHtml,
        headers
      });

      return {
        outcome: 'success',
        providerMessageId: info.messageId || msg.ourMessageId || null,
        providerResponse: info.response ?? null,
        latencyMs: Date.now() - started,
        errorMessage: null
      };
    } catch (err) {
      const e = err as NodeJS.ErrnoException & { responseCode?: number; code?: string };
      const outcome = classifySmtpError(e);
      return {
        outcome,
        providerMessageId: null,
        providerResponse: null,
        latencyMs: Date.now() - started,
        errorMessage: truncate(e.message || 'SMTP send failed', 500)
      };
    } finally {
      transport.close();
    }
  }

  /**
   * V1: SMTP/IMAP reply polling is deferred. Always returns [].
   * The cron skips this driver via lib/email/router.ts driverSupportsReplyPolling().
   */
  async fetchReplies(_mailbox: MailboxRecord, _since: Date | null): Promise<InboundReply[]> {
    return [];
  }

  async testConnection(mailbox: MailboxRecord): Promise<TestConnectionResult> {
    const started = Date.now();
    const creds = requireCreds(mailbox);
    const transport = nodemailer.createTransport({
      host: creds.host,
      port: creds.port,
      secure: creds.secure,
      auth: { user: creds.user, pass: creds.pass },
      connectionTimeout: 10_000,
      greetingTimeout: 8_000,
      socketTimeout: 10_000
    });
    try {
      await transport.verify();
      return {
        ok: true,
        outcome: 'success',
        message: `SMTP connection OK to ${creds.host}:${creds.port}`,
        latencyMs: Date.now() - started
      };
    } catch (err) {
      const e = err as NodeJS.ErrnoException & { responseCode?: number; code?: string };
      return {
        ok: false,
        outcome: classifyTestError(e),
        message: truncate(e.message || 'SMTP verify failed', 500),
        latencyMs: Date.now() - started
      };
    } finally {
      transport.close();
    }
  }
}

// ---------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------

function requireCreds(mailbox: MailboxRecord): HostGatorSmtpCredentials {
  if (!mailbox.credentials) {
    throw new Error(`Mailbox ${mailbox.id} (${mailbox.displayName}) has no credentials`);
  }
  if (mailbox.credentials.kind !== 'hostgator_smtp') {
    throw new Error(
      `HostGatorSmtpDriver received mailbox with driver=${mailbox.credentials.kind}`
    );
  }
  return mailbox.credentials;
}

function formatFromHeader(mailbox: MailboxRecord): string {
  if (mailbox.fromName) {
    return `"${escapeQuotes(mailbox.fromName)}" <${mailbox.fromAddress}>`;
  }
  return mailbox.fromAddress;
}

function escapeQuotes(s: string): string {
  return s.replace(/"/g, '\\"');
}

function ensureAngleBrackets(id: string): string {
  const t = id.trim();
  if (t.startsWith('<') && t.endsWith('>')) return t;
  return `<${t}>`;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function classifySmtpError(
  err: NodeJS.ErrnoException & { responseCode?: number; code?: string }
): SendMessageResult['outcome'] {
  const code = err.code || '';
  if (code === 'EAUTH') return 'auth_error';
  if (code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'ECONNECTION') {
    return 'connection_error';
  }
  if (err.responseCode === 550 || err.responseCode === 553) return 'invalid_recipient';
  if (err.responseCode === 421 || err.responseCode === 451) return 'rate_limited';
  return 'other_error';
}

function classifyTestError(
  err: NodeJS.ErrnoException & { responseCode?: number; code?: string }
): TestConnectionResult['outcome'] {
  const code = err.code || '';
  if (code === 'EAUTH') return 'auth_error';
  if (code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'ECONNECTION') {
    return 'connection_error';
  }
  return 'other_error';
}
