/**
 * lib/client/notes.ts  (#489)
 *
 * The two-way notes channel — operator <-> client messages from inside the
 * app. Backed by schema/086_client_notes.sql.
 *
 * Design rules (per val):
 *   - DIRECTION-TYPED: every note records who said what (NoteDirection), set
 *     SERVER-SIDE from the authenticated session — never client-supplied.
 *   - CREDENTIALED: every note carries author_email + created_at.
 *   - APPEND-ONLY: notes are immutable. No update/delete path here. A
 *     correction posts as a new note. read_at is the only field that mutates,
 *     and only ever NULL -> a timestamp (marking read), never the reverse.
 *
 * Every read degrades to []/0 on error so a missing table never breaks a page.
 */
import { getAvDb } from '@/lib/db/av';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

export type NoteDirection = 'operator_to_client' | 'client_to_operator';

export interface ClientNote {
  noteId: number;
  clientId: number;
  direction: NoteDirection;
  authorEmail: string;
  body: string;
  attachmentKey: string | null;
  readAt: string | null; // ISO, null = unread
  createdAt: string; // ISO
}

interface NoteRow extends RowDataPacket {
  note_id: number;
  client_id: number;
  direction: NoteDirection;
  author_email: string;
  body: string;
  attachment_key: string | null;
  read_at: Date | null;
  created_at: Date;
}

const MAX_BODY = 8000;

function toNote(r: NoteRow): ClientNote {
  return {
    noteId: Number(r.note_id),
    clientId: Number(r.client_id),
    direction: r.direction,
    authorEmail: r.author_email,
    body: r.body,
    attachmentKey: r.attachment_key,
    readAt: r.read_at ? new Date(r.read_at).toISOString() : null,
    createdAt: new Date(r.created_at).toISOString()
  };
}

/** The full thread for a brand, oldest first (chat order). */
export async function listNotes(clientId: number, limit = 300): Promise<ClientNote[]> {
  if (!Number.isInteger(clientId) || clientId <= 0) return [];
  try {
    const db = getAvDb();
    const [rows] = await db.execute<NoteRow[]>(
      `SELECT note_id, client_id, direction, author_email, body, attachment_key, read_at, created_at
         FROM client_notes
        WHERE client_id = ?
        ORDER BY created_at ASC, note_id ASC
        LIMIT ?`,
      [clientId, limit]
    );
    return rows.map(toNote);
  } catch (err) {
    console.error('[notes:listNotes]', (err as Error).message);
    return [];
  }
}

/**
 * Append a note. direction + authorEmail come from the authenticated session
 * at the call site, never from the client. Returns the new note_id, or null on
 * failure (caller surfaces a soft error rather than throwing).
 */
export async function postNote(args: {
  clientId: number;
  direction: NoteDirection;
  authorEmail: string;
  body: string;
  attachmentKey?: string | null;
}): Promise<number | null> {
  const { clientId, direction, authorEmail } = args;
  const body = (args.body ?? '').trim();
  if (!Number.isInteger(clientId) || clientId <= 0) return null;
  if (!authorEmail || !body) return null;
  if (body.length > MAX_BODY) return null;
  try {
    const db = getAvDb();
    const [res] = await db.execute<ResultSetHeader>(
      `INSERT INTO client_notes (client_id, direction, author_email, body, attachment_key)
       VALUES (?, ?, ?, ?, ?)`,
      [clientId, direction, authorEmail, body, args.attachmentKey ?? null]
    );
    return res.insertId ? Number(res.insertId) : null;
  } catch (err) {
    console.error('[notes:postNote]', (err as Error).message);
    return null;
  }
}

/**
 * Mark the notes the VIEWER is reading as read. readSide is the direction of
 * the incoming notes for this viewer: an operator reading the thread marks
 * 'client_to_operator'; a client marks 'operator_to_client'. Returns the count
 * marked. Idempotent (only touches still-unread rows).
 */
export async function markThreadRead(clientId: number, readSide: NoteDirection): Promise<number> {
  if (!Number.isInteger(clientId) || clientId <= 0) return 0;
  try {
    const db = getAvDb();
    const [res] = await db.execute<ResultSetHeader>(
      `UPDATE client_notes SET read_at = NOW()
        WHERE client_id = ? AND direction = ? AND read_at IS NULL`,
      [clientId, readSide]
    );
    return Number(res.affectedRows ?? 0);
  } catch (err) {
    console.error('[notes:markThreadRead]', (err as Error).message);
    return 0;
  }
}

/** Count of unread notes in one direction for a brand. */
export async function unreadCount(clientId: number, direction: NoteDirection): Promise<number> {
  if (!Number.isInteger(clientId) || clientId <= 0) return 0;
  try {
    const db = getAvDb();
    const [rows] = await db.execute<(RowDataPacket & { n: number })[]>(
      `SELECT COUNT(*) AS n FROM client_notes
        WHERE client_id = ? AND direction = ? AND read_at IS NULL`,
      [clientId, direction]
    );
    return Number(rows[0]?.n ?? 0);
  } catch {
    return 0;
  }
}

/** Total unread client->operator notes across ALL brands (operator nav badge). */
export async function totalUnreadForOperator(): Promise<number> {
  try {
    const db = getAvDb();
    const [rows] = await db.execute<(RowDataPacket & { n: number })[]>(
      `SELECT COUNT(*) AS n FROM client_notes
        WHERE direction = 'client_to_operator' AND read_at IS NULL`
    );
    return Number(rows[0]?.n ?? 0);
  } catch {
    return 0;
  }
}

/** Unread client->operator counts per brand (operator roster badges). */
export async function unreadByClientForOperator(): Promise<Record<number, number>> {
  try {
    const db = getAvDb();
    const [rows] = await db.execute<(RowDataPacket & { client_id: number; n: number })[]>(
      `SELECT client_id, COUNT(*) AS n FROM client_notes
        WHERE direction = 'client_to_operator' AND read_at IS NULL
        GROUP BY client_id`
    );
    const out: Record<number, number> = {};
    for (const r of rows) out[Number(r.client_id)] = Number(r.n);
    return out;
  } catch {
    return {};
  }
}
