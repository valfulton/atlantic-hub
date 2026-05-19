/**
 * lib/email/router.ts
 *
 * Single import path for everything that wants to send or read mail.
 * Dispatches a MailboxRecord to its concrete MailDriver implementation.
 *
 *   const driver = getDriverFor(mailbox);
 *   const result = await driver.sendMessage(mailbox, { to, subject, bodyPlain });
 *
 * Add a new driver in three steps:
 *   1. implement MailDriver in lib/email/drivers/<name>.ts
 *   2. add the kind to MailDriverKind in lib/email/types.ts (+ schema enum)
 *   3. extend the switch below
 */

import type { MailDriver } from '@/lib/email/driver';
import type { MailboxRecord, MailDriverKind } from '@/lib/email/types';
import { HostGatorSmtpDriver } from '@/lib/email/drivers/hostgator';
import { MicrosoftGraphDriver } from '@/lib/email/drivers/microsoft_graph';
import { GmailApiDriver } from '@/lib/email/drivers/gmail';

const SINGLETONS: Partial<Record<MailDriverKind, MailDriver>> = {};

export function getDriverFor(mailbox: MailboxRecord): MailDriver {
  return getDriverByKind(mailbox.driver);
}

export function getDriverByKind(kind: MailDriverKind): MailDriver {
  if (SINGLETONS[kind]) return SINGLETONS[kind]!;
  let drv: MailDriver;
  switch (kind) {
    case 'hostgator_smtp':
      drv = new HostGatorSmtpDriver();
      break;
    case 'microsoft_graph':
      drv = new MicrosoftGraphDriver();
      break;
    case 'gmail_api':
      drv = new GmailApiDriver();
      break;
    default: {
      const _exhaustive: never = kind;
      throw new Error(`No driver registered for kind=${String(_exhaustive)}`);
    }
  }
  SINGLETONS[kind] = drv;
  return drv;
}

/**
 * Whether this driver supports the reply-poll cron loop. The HostGator
 * SMTP driver returns false in v1 (IMAP polling lands in v2 -- replies
 * during v1 land in the operator's own inbox to read by hand or via a
 * cPanel forwarder).
 */
export function driverSupportsReplyPolling(kind: MailDriverKind): boolean {
  switch (kind) {
    case 'microsoft_graph':
    case 'gmail_api':
      return true;
    case 'hostgator_smtp':
      return false;
  }
}
