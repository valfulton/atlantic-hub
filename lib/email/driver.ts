/**
 * lib/email/driver.ts
 *
 * The single interface every mail driver implements. Routes that send
 * email do not import drivers directly -- they import getDriverFor(mailbox)
 * from lib/email/router.ts which dispatches based on mailbox.driver.
 *
 * Driver responsibilities:
 *   - sendMessage  -- transactional outbound (per-message, awaited)
 *   - fetchReplies -- pull new inbound messages since `since` timestamp
 *   - testConnection -- exercise the credentials and return a friendly result
 *
 * No driver retries on its own. Retry policy is decided at the route
 * layer (or the cron) -- drivers just report outcome cleanly.
 */

import type {
  InboundReply,
  MailboxRecord,
  SendMessageInput,
  SendMessageResult,
  TestConnectionResult
} from '@/lib/email/types';

export interface MailDriver {
  /** Stable string identifying the driver -- matches the enum value. */
  readonly kind: MailboxRecord['driver'];

  /**
   * Send one message. Resolves with the outcome -- never throws for
   * provider errors (those become outcome='auth_error' etc.). Throws
   * only for programmer errors (missing credentials on the record,
   * unsupported feature on this driver).
   */
  sendMessage(mailbox: MailboxRecord, msg: SendMessageInput): Promise<SendMessageResult>;

  /**
   * Pull replies received since `since`. Returns the raw inbound replies;
   * AI classification and lead matching happen in lib/email/reply_processor.ts.
   *
   * `since` should be the most-recent received_at we already have in
   * outreach_replies for this mailbox, or NULL on first poll. Drivers
   * may return more than requested -- the caller dedups on
   * providerMessageId.
   */
  fetchReplies(mailbox: MailboxRecord, since: Date | null): Promise<InboundReply[]>;

  /**
   * Cheap connection / auth exercise. SMTP drivers open a connection,
   * HELO, AUTH, QUIT. API drivers hit a lightweight whoami endpoint.
   * Updates last_test_at and last_test_outcome at the route layer.
   */
  testConnection(mailbox: MailboxRecord): Promise<TestConnectionResult>;
}
