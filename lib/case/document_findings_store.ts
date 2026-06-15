/**
 * lib/case/document_findings_store.ts  (val 2026-06-15, #666)
 *
 * CRUD helpers for case_document_findings — the table schema/095 creates.
 * Kept separate from case_store.ts so document_reader.ts can be tree-shaken
 * out of pages that don't need it.
 */
import { getAvDb } from '@/lib/db/av';
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise';

export type FindingSeverity = 'urgent' | 'high' | 'normal' | 'info';
/** Schema 096 — controls whether a finding reaches family-facing surfaces. */
export type FindingVisibility = 'operator_only' | 'family_visible';

export interface DocumentFinding {
  findingId: number;
  documentId: number;
  caseId: number;
  sectionKey: string | null;
  quote: string | null;
  oddityType: string | null;
  severity: FindingSeverity;
  visibility: FindingVisibility;
  /** (#673) Set to 1 by any operator action — edit content, change severity,
   *  flip visibility. Re-scan never deletes curated rows. */
  isCurated: boolean;
  pageNumber: number | null;
  llmNote: string | null;
  modelId: string | null;
  createdAt: string | null;
}

export interface DocumentFindingInput {
  documentId: number;
  caseId: number;
  sectionKey: string | null;
  quote: string | null;
  oddityType: string | null;
  severity: FindingSeverity;
  pageNumber: number | null;
  llmNote: string | null;
  modelId: string | null;
}

interface FindingRow extends RowDataPacket {
  finding_id: number;
  document_id: number;
  case_id: number;
  section_key: string | null;
  quote: string | null;
  oddity_type: string | null;
  severity: FindingSeverity;
  visibility: FindingVisibility;
  is_curated: number;
  page_number: number | null;
  llm_note: string | null;
  model_id: string | null;
  created_at: string | Date | null;
}

function rowToFinding(r: FindingRow): DocumentFinding {
  return {
    findingId: r.finding_id,
    documentId: r.document_id,
    caseId: r.case_id,
    sectionKey: r.section_key,
    quote: r.quote,
    oddityType: r.oddity_type,
    severity: r.severity,
    visibility: r.visibility || 'operator_only',
    isCurated: !!r.is_curated,
    pageNumber: r.page_number,
    llmNote: r.llm_note,
    modelId: r.model_id,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : (r.created_at as string | null)
  };
}

/** List findings for one document, ordered urgent → high → normal → info. */
export async function listFindingsForDocument(documentId: number): Promise<DocumentFinding[]> {
  if (!Number.isInteger(documentId) || documentId <= 0) return [];
  try {
    const db = getAvDb();
    const [rows] = await db.execute<FindingRow[]>(
      `SELECT finding_id, document_id, case_id, section_key, quote,
              oddity_type, severity, visibility, is_curated, page_number, llm_note, model_id, created_at
         FROM case_document_findings
        WHERE document_id = ?
        ORDER BY FIELD(severity, 'urgent','high','normal','info'),
                 page_number IS NULL, page_number ASC, finding_id ASC`,
      [documentId]
    );
    return rows.map(rowToFinding);
  } catch (err) {
    console.error('listFindingsForDocument failed', err);
    return [];
  }
}

/** List ALL findings on a case across documents — operator findings panel uses this. */
export async function listFindingsForCase(caseId: number): Promise<DocumentFinding[]> {
  if (!Number.isInteger(caseId) || caseId <= 0) return [];
  try {
    const db = getAvDb();
    const [rows] = await db.execute<FindingRow[]>(
      `SELECT finding_id, document_id, case_id, section_key, quote,
              oddity_type, severity, visibility, is_curated, page_number, llm_note, model_id, created_at
         FROM case_document_findings
        WHERE case_id = ?
        ORDER BY FIELD(severity, 'urgent','high','normal','info'),
                 document_id, page_number IS NULL, page_number ASC, finding_id ASC`,
      [caseId]
    );
    return rows.map(rowToFinding);
  } catch (err) {
    console.error('listFindingsForCase failed', err);
    return [];
  }
}

/** Family-side filter — returns ONLY findings val has flipped to
 *  family_visible. Used by /client/cases/[caseId] (Rebecca / parents /
 *  Adriana view). Hides oddity_type from caller-shaped output isn't done
 *  here — the FamilyFindingsPanel decides what to render and how. */
export async function listFamilyVisibleFindingsForCase(caseId: number): Promise<DocumentFinding[]> {
  if (!Number.isInteger(caseId) || caseId <= 0) return [];
  try {
    const db = getAvDb();
    const [rows] = await db.execute<FindingRow[]>(
      `SELECT finding_id, document_id, case_id, section_key, quote,
              oddity_type, severity, visibility, is_curated, page_number, llm_note, model_id, created_at
         FROM case_document_findings
        WHERE case_id = ? AND visibility = 'family_visible'
        ORDER BY FIELD(severity, 'urgent','high','normal','info'),
                 document_id, page_number IS NULL, page_number ASC, finding_id ASC`,
      [caseId]
    );
    return rows.map(rowToFinding);
  } catch (err) {
    console.error('listFamilyVisibleFindingsForCase failed', err);
    return [];
  }
}

/** Edit the human-readable content of a finding — quote, note, section ref,
 *  page, or oddity type. Lets val + Adriana refine the wording before
 *  surfacing to the family without re-running the LLM. (#670) */
export interface FindingEditInput {
  quote?: string | null;
  llmNote?: string | null;
  sectionKey?: string | null;
  pageNumber?: number | null;
  oddityType?: string | null;
}

export async function updateFindingContent(
  findingId: number,
  input: FindingEditInput
): Promise<boolean> {
  if (!Number.isInteger(findingId) || findingId <= 0) return false;
  // Build a partial SET clause — only update fields the caller passed.
  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  if ('quote' in input) { sets.push('quote = ?'); params.push(input.quote ?? null); }
  if ('llmNote' in input) { sets.push('llm_note = ?'); params.push(input.llmNote ?? null); }
  if ('sectionKey' in input) { sets.push('section_key = ?'); params.push(input.sectionKey ?? null); }
  if ('pageNumber' in input) {
    sets.push('page_number = ?');
    params.push(typeof input.pageNumber === 'number' && input.pageNumber > 0 ? input.pageNumber : null);
  }
  if ('oddityType' in input) { sets.push('oddity_type = ?'); params.push(input.oddityType ?? null); }
  if (sets.length === 0) return true; // nothing to update — still "succeeds"
  // (#673) Any operator content edit marks the row curated so re-scan
  // never overwrites it.
  sets.push('is_curated = 1');
  params.push(findingId);
  try {
    const db = getAvDb();
    await db.execute<ResultSetHeader>(
      `UPDATE case_document_findings SET ${sets.join(', ')} WHERE finding_id = ?`,
      params
    );
    return true;
  } catch (err) {
    console.error('updateFindingContent failed', err);
    return false;
  }
}

/** Flip a finding's visibility. Operator-only — guarded at the route layer. */
export async function updateFindingVisibility(
  findingId: number,
  visibility: FindingVisibility
): Promise<boolean> {
  if (!Number.isInteger(findingId) || findingId <= 0) return false;
  if (visibility !== 'operator_only' && visibility !== 'family_visible') return false;
  try {
    const db = getAvDb();
    // (#673) Operator visibility decision counts as curation — protect on re-scan.
    await db.execute<ResultSetHeader>(
      `UPDATE case_document_findings SET visibility = ?, is_curated = 1 WHERE finding_id = ?`,
      [visibility, findingId]
    );
    return true;
  } catch (err) {
    console.error('updateFindingVisibility failed', err);
    return false;
  }
}

/** Wipe findings for a document. Called by document_reader before inserting
 *  a fresh batch so re-runs replace (no stale rows linger).
 *  (#673) NEVER deletes curated rows — anything the operator has edited,
 *  re-categorized, or flipped to family_visible stays put. Only LLM-only
 *  rows get cleared. */
export async function clearDocumentFindings(documentId: number): Promise<boolean> {
  if (!Number.isInteger(documentId) || documentId <= 0) return false;
  try {
    const db = getAvDb();
    await db.execute<ResultSetHeader>(
      `DELETE FROM case_document_findings WHERE document_id = ? AND is_curated = 0`,
      [documentId]
    );
    return true;
  } catch (err) {
    console.error('clearDocumentFindings failed', err);
    return false;
  }
}

/** Insert one finding row. */
export async function insertDocumentFinding(input: DocumentFindingInput): Promise<number | null> {
  if (!Number.isInteger(input.documentId) || input.documentId <= 0) return null;
  if (!Number.isInteger(input.caseId) || input.caseId <= 0) return null;
  try {
    const db = getAvDb();
    const [res] = await db.execute<ResultSetHeader>(
      `INSERT INTO case_document_findings (
         document_id, case_id, section_key, quote, oddity_type,
         severity, page_number, llm_note, model_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.documentId,
        input.caseId,
        input.sectionKey,
        input.quote,
        input.oddityType,
        input.severity,
        input.pageNumber,
        input.llmNote,
        input.modelId
      ]
    );
    return res.insertId || null;
  } catch (err) {
    console.error('insertDocumentFinding failed', err);
    return null;
  }
}
