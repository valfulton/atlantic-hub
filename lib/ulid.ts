/**
 * ULID generation for account_id.
 * ULIDs are lexicographically sortable, time-ordered, 26-char strings.
 * Pairs nicely with CHAR(26) PK in MySQL.
 */
import { ulid } from 'ulid';

export function newAccountId(): string {
  return ulid();
}
