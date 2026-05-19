/**
 * lib/email/mailbox.ts
 *
 * Load + persist outreach_mailboxes rows with credentials transparently
 * decrypted / re-encrypted at the boundary. Routes and cron jobs should
 * use these helpers rather than going to the DB directly so the
 * encryption pattern is enforced in one place.
 */

import { getAvDb } from '@/lib/db/av';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import {
  decryptJson,
  encryptJson,
  CiphertextMalformedError
} from '@/lib/email/encrypt';
import type {
  MailboxCredentials,
  MailboxRecord,
  MailDriverKind,
  MailboxStatus
} from '@/lib/email/types';

interface MailboxRow extends RowDataPacket {
  id: number;
  organization_id: number | null;
  display_name: string;
  from_address: string;
  from_name: string | null;
  reply_to_address: string | null;
  driver: MailDriverKind;
  credentials_encrypted: string | null;
  status: MailboxStatus;
  daily_send_count: number;
  daily_send_reset_at: string | null;
  last_test_at: string | null;
  last_test_outcome:
    | 'success'
    | 'auth_error'
    | 'connection_error'
    | 'other_error'
    | null;
  last_error: string | null;
  created_by_user_id: number | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

function rowToRecord(row: MailboxRow): MailboxRecord {
  let credentials: MailboxCredentials | null = null;
  if (row.credentials_encrypted) {
    try {
      credentials = decryptJson<MailboxCredentials>(row.credentials_encrypted);
    } catch (err) {
      if (err instanceof CiphertextMalformedError) {
        console.error(`[mailbox:decrypt] mailbox ${row.id}: ${err.message}`);
      } else {
        console.error(`[mailbox:decrypt] mailbox ${row.id}: ${(err as Error).message}`);
      }
      credentials = null;
    }
  }
  return {
    id: row.id,
    organizationId: row.organization_id,
    displayName: row.display_name,
    fromAddress: row.from_address,
    fromName: row.from_name,
    replyToAddress: row.reply_to_address,
    driver: row.driver,
    credentials,
    status: row.status,
    dailySendCount: row.daily_send_count,
    dailySendResetAt: row.daily_send_reset_at,
    lastTestAt: row.last_test_at,
    lastTestOutcome: row.last_test_outcome,
    lastError: row.last_error,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at
  };
}

export async function loadMailbox(id: number): Promise<MailboxRecord | null> {
  const db = getAvDb();
  const [rows] = await db.execute<MailboxRow[]>(
    `SELECT id, organization_id, display_name, from_address, from_name,
            reply_to_address, driver, credentials_encrypted, status,
            daily_send_count, daily_send_reset_at, last_test_at,
            last_test_outcome, last_error, created_by_user_id,
            created_at, updated_at, archived_at
       FROM outreach_mailboxes
      WHERE id = ? AND archived_at IS NULL
      LIMIT 1`,
    [id]
  );
  if (rows.length === 0) return null;
  return rowToRecord(rows[0]);
}

export async function listMailboxes(args: {
  organizationId?: number | null;
  includeArchived?: boolean;
}): Promise<MailboxRecord[]> {
  const db = getAvDb();
  const where: string[] = [];
  const params: unknown[] = [];
  if (!args.includeArchived) where.push('archived_at IS NULL');
  if (typeof args.organizationId === 'number') {
    where.push('organization_id = ?');
    params.push(args.organizationId);
  }
  const whereSql = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';
  const [rows] = await db.execute<MailboxRow[]>(
    `SELECT id, organization_id, display_name, from_address, from_name,
            reply_to_address, driver, credentials_encrypted, status,
            daily_send_count, daily_send_reset_at, last_test_at,
            last_test_outcome, last_error, created_by_user_id,
            created_at, updated_at, archived_at
       FROM outreach_mailboxes
       ${whereSql}
       ORDER BY created_at DESC`,
    params
  );
  return rows.map(rowToRecord);
}

export interface CreateMailboxInput {
  organizationId: number | null;
  displayName: string;
  fromAddress: string;
  fromName: string | null;
  replyToAddress: string | null;
  driver: MailDriverKind;
  credentials: MailboxCredentials | null;
  status: MailboxStatus;
  createdByUserId: number | null;
}

export async function createMailbox(input: CreateMailboxInput): Promise<number> {
  const db = getAvDb();
  const cipher = input.credentials ? encryptJson(input.credentials) : null;
  const [res] = await db.execute<ResultSetHeader>(
    `INSERT INTO outreach_mailboxes
       (organization_id, display_name, from_address, from_name, reply_to_address,
        driver, credentials_encrypted, status, created_by_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.organizationId,
      input.displayName,
      input.fromAddress,
      input.fromName,
      input.replyToAddress,
      input.driver,
      cipher,
      input.status,
      input.createdByUserId
    ]
  );
  return res.insertId;
}

export async function updateMailboxCredentials(args: {
  mailboxId: number;
  credentials: MailboxCredentials;
  status: MailboxStatus;
}): Promise<void> {
  const db = getAvDb();
  await db.execute<ResultSetHeader>(
    `UPDATE outreach_mailboxes
        SET credentials_encrypted = ?, status = ?, updated_at = NOW()
      WHERE id = ?`,
    [encryptJson(args.credentials), args.status, args.mailboxId]
  );
}

export async function updateMailboxTestOutcome(args: {
  mailboxId: number;
  ok: boolean;
  outcome: 'success' | 'auth_error' | 'connection_error' | 'other_error';
  message: string;
}): Promise<void> {
  const db = getAvDb();
  await db.execute<ResultSetHeader>(
    `UPDATE outreach_mailboxes
        SET last_test_at = NOW(),
            last_test_outcome = ?,
            last_error = ?,
            status = CASE WHEN ? = 1 THEN 'active' ELSE 'error' END,
            updated_at = NOW()
      WHERE id = ?`,
    [args.outcome, args.message.slice(0, 500), args.ok ? 1 : 0, args.mailboxId]
  );
}

/**
 * Increment the per-mailbox daily counter. Resets to 1 if the stored
 * reset date is earlier than today (UTC). Returns the new count.
 */
export async function incrementDailySend(mailboxId: number): Promise<number> {
  const db = getAvDb();
  await db.execute<ResultSetHeader>(
    `UPDATE outreach_mailboxes
        SET daily_send_count = CASE
              WHEN daily_send_reset_at IS NULL OR daily_send_reset_at <> CURDATE()
                THEN 1
              ELSE daily_send_count + 1
            END,
            daily_send_reset_at = CURDATE(),
            updated_at = NOW()
      WHERE id = ?`,
    [mailboxId]
  );
  const [rows] = await db.execute<(RowDataPacket & { daily_send_count: number })[]>(
    `SELECT daily_send_count FROM outreach_mailboxes WHERE id = ?`,
    [mailboxId]
  );
  return rows[0]?.daily_send_count ?? 0;
}

export async function archiveMailbox(mailboxId: number): Promise<void> {
  const db = getAvDb();
  await db.execute<ResultSetHeader>(
    `UPDATE outreach_mailboxes SET archived_at = NOW(), updated_at = NOW() WHERE id = ?`,
    [mailboxId]
  );
}
