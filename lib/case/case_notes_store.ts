/**
 * lib/case/case_notes_store.ts  (val 2026-06-15, #699)
 *
 * Standalone reviewer ↔ family notes on a case. Replaces Adriana's
 * approval_note hack with a first-class notes channel.
 *
 * Schema: case_notes (schema/101_case_notes.sql)
 *
 * Audience model:
 *   - family         = anyone with case access sees it
 *   - legal_team     = Rebecca + Adriana + val (investigation tier)
 *   - operator_only  = val only (private operational notes)
 *
 * Universal across case_kinds. No Johnson-specific assumptions.
 */
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import { getAvDb } from '@/lib/db/av';

export type NoteAudience = 'family' | 'legal_team' | 'operator_only';
export type NoteAuthorRole = 'owner' | 'staff' | 'client_user';

export interface CaseNote {
  noteId: number;
  caseId: number;
  body: string;
  authorUserId: number | null;
  authorRole: NoteAuthorRole;
  authorDisplayName: string | null;
  audience: NoteAudience;
  pinned: boolean;
  archivedAt: string | null;
  source: string | null;
  sourceDocumentId: number | null;
  createdAt: string | null;
  updatedAt: string | null;
}

interface NoteRow extends RowDataPacket {
  note_id: number;
  case_id: number;
  body: string;
  author_user_id: number | null;
  author_role: string;
  author_display_name: string | null;
  audience: string;
  pinned: number | boolean;
  archived_at: Date | string | null;
  source: string | null;
  source_document_id: number | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
}

function toIso(v: Date | string | null | undefined): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function rowToNote(r: NoteRow): CaseNote {
  return {
    noteId: r.note_id,
    caseId: r.case_id,
    body: r.body,
    authorUserId: r.author_user_id == null ? null : Number(r.author_user_id),
    authorRole:
      r.author_role === 'owner' ? 'owner' :
      r.author_role === 'staff' ? 'staff' :
      'client_user',
    authorDisplayName: r.author_display_name,
    audience:
      r.audience === 'legal_team' ? 'legal_team' :
      r.audience === 'operator_only' ? 'operator_only' :
      'family',
    pinned: Boolean(r.pinned),
    archivedAt: toIso(r.archived_at),
    source: r.source,
    sourceDocumentId: r.source_document_id == null ? null : Number(r.source_document_id),
    createdAt: toIso(r.created_at),
    updatedAt: toIso(r.updated_at)
  };
}

/**
 * Audiences a viewer is allowed to see based on their case role.
 * Mirrors the visibleFor() pattern in lib/case/case_collaborators.ts.
 *
 * (val 2026-06-15, #700) Accepts the canonical CaseViewerRole shape from
 * lib/case/case_collaborators.ts — the page passes that type directly, so
 * keeping a parallel shorthand here was the source of the build break.
 *
 *   parent         → family only (Gordon + Maria: top-level family view)
 *   account_rep    → family + legal_team (Rebecca: successor trustee /
 *                    sibling admin runs the case, sees investigation tier)
 *   professional   → family + legal_team (Adriana: LDA reviewer)
 *   family         → family only (general family member, parent-equivalent)
 *   operator       → all three audiences
 *   unknown        → nothing (shouldn't happen on this surface, but safe)
 */
export type NoteViewerRole =
  | 'parent'
  | 'account_rep'
  | 'professional'
  | 'family'
  | 'operator'
  | 'unknown';

export function visibleAudiencesFor(viewerRole: NoteViewerRole): NoteAudience[] {
  if (viewerRole === 'operator') return ['family', 'legal_team', 'operator_only'];
  if (viewerRole === 'account_rep' || viewerRole === 'professional') return ['family', 'legal_team'];
  if (viewerRole === 'parent' || viewerRole === 'family') return ['family'];
  // unknown
  return [];
}

export interface AddCaseNoteInput {
  caseId: number;
  body: string;
  authorUserId: number | null;
  authorRole: NoteAuthorRole;
  authorDisplayName: string | null;
  audience?: NoteAudience;
  pinned?: boolean;
  source?: string | null;
  sourceDocumentId?: number | null;
}

/**
 * (val 2026-06-16, #708) Module-level last-error capture so the route can
 * surface the real DB message in the response without breaking the
 * Promise<number | null> contract that other callers depend on.
 */
let LAST_ADD_NOTE_ERROR: string | null = null;
export function lastAddCaseNoteError(): string | null { return LAST_ADD_NOTE_ERROR; }

export async function addCaseNote(input: AddCaseNoteInput): Promise<number | null> {
  LAST_ADD_NOTE_ERROR = null;
  if (!Number.isInteger(input.caseId) || input.caseId <= 0) {
    LAST_ADD_NOTE_ERROR = 'bad case id';
    return null;
  }
  const body = (input.body || '').trim();
  if (!body) {
    LAST_ADD_NOTE_ERROR = 'empty body';
    return null;
  }
  try {
    const db = getAvDb();
    const [res] = await db.execute<ResultSetHeader>(
      `INSERT INTO case_notes
         (case_id, body, author_user_id, author_role, author_display_name,
          audience, pinned, source, source_document_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.caseId,
        body,
        input.authorUserId,
        input.authorRole,
        input.authorDisplayName,
        input.audience || 'family',
        input.pinned ? 1 : 0,
        input.source ?? null,
        input.sourceDocumentId ?? null
      ]
    );
    return res.insertId || null;
  } catch (err) {
    LAST_ADD_NOTE_ERROR = (err as Error).message || String(err);
    console.error('addCaseNote failed', err);
    return null;
  }
}

export async function listCaseNotes(
  caseId: number,
  allowedAudiences: NoteAudience[]
): Promise<CaseNote[]> {
  if (!Number.isInteger(caseId) || caseId <= 0) return [];
  if (allowedAudiences.length === 0) return [];
  try {
    const db = getAvDb();
    // Build IN clause safely.
    const placeholders = allowedAudiences.map(() => '?').join(',');
    const [rows] = await db.execute<NoteRow[]>(
      `SELECT * FROM case_notes
       WHERE case_id = ?
         AND archived_at IS NULL
         AND audience IN (${placeholders})
       ORDER BY pinned DESC, created_at DESC`,
      [caseId, ...allowedAudiences]
    );
    return rows.map(rowToNote);
  } catch (err) {
    console.error('listCaseNotes failed', err);
    return [];
  }
}

export async function updateCaseNote(
  noteId: number,
  patch: Partial<{ body: string; audience: NoteAudience; pinned: boolean }>
): Promise<boolean> {
  if (!Number.isInteger(noteId) || noteId <= 0) return false;
  const fields: string[] = [];
  const params: unknown[] = [];
  if (typeof patch.body === 'string') {
    const body = patch.body.trim();
    if (!body) return false;
    fields.push('body = ?');
    params.push(body);
  }
  if (patch.audience !== undefined) {
    fields.push('audience = ?');
    params.push(patch.audience);
  }
  if (patch.pinned !== undefined) {
    fields.push('pinned = ?');
    params.push(patch.pinned ? 1 : 0);
  }
  if (fields.length === 0) return false;
  params.push(noteId);
  try {
    const db = getAvDb();
    await db.execute<ResultSetHeader>(
      `UPDATE case_notes SET ${fields.join(', ')} WHERE note_id = ?`,
      params
    );
    return true;
  } catch (err) {
    console.error('updateCaseNote failed', err);
    return false;
  }
}

export async function archiveCaseNote(noteId: number): Promise<boolean> {
  if (!Number.isInteger(noteId) || noteId <= 0) return false;
  try {
    const db = getAvDb();
    await db.execute<ResultSetHeader>(
      `UPDATE case_notes SET archived_at = NOW() WHERE note_id = ?`,
      [noteId]
    );
    return true;
  } catch (err) {
    console.error('archiveCaseNote failed', err);
    return false;
  }
}

export async function getCaseNote(noteId: number): Promise<CaseNote | null> {
  if (!Number.isInteger(noteId) || noteId <= 0) return null;
  try {
    const db = getAvDb();
    const [rows] = await db.execute<NoteRow[]>(
      `SELECT * FROM case_notes WHERE note_id = ? LIMIT 1`,
      [noteId]
    );
    if (rows.length === 0) return null;
    return rowToNote(rows[0]);
  } catch (err) {
    console.error('getCaseNote failed', err);
    return null;
  }
}
