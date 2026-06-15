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

export interface DocumentFinding {
  findingId: number;
  documentId: number;
  caseId: number;
  sectionKey: string | null;
  quote: string | null;
  oddityType: string | null;
  severity: FindingSeverity;
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
              oddity_type, severity, page_number, llm_note, model_id, created_at
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
              oddity_type, severity, page_number, llm_note, model_id, created_at
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

/** Wipe findings for a document. Called by document_reader before inserting
 *  a fresh batch so re-runs replace (no stale rows linger). */
export async function clearDocumentFindings(documentId: number): Promise<boolean> {
  if (!Number.isInteger(documentId) || documentId <= 0) return false;
  try {
    const db = getAvDb();
    await db.execute<ResultSetHeader>(
      `DELETE FROM case_document_findings WHERE document_id = ?`,
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
