/**
 * lib/case/document_extracts_store.ts  (val 2026-06-15, #671)
 *
 * CRUD helpers for case_document_extracts — the table schema/097 creates.
 * Structured metadata pulled from any case document: parties, attorney +
 * firm contact info, addresses, bar numbers, dates. Distinct from the
 * oddity scanner (case_document_findings) which surfaces concerns.
 *
 * Kind values are free-form by design so we don't have to amend the
 * schema every time the LLM finds a new category. Current taxonomy used
 * by document_reader's prompt:
 *   party          (Trustor, Trustee, Successor Trustee, Beneficiary, etc.)
 *   attorney       (drafting attorney name)
 *   firm           (drafting firm name)
 *   address        (firm address, party address, property address)
 *   contact        (phone, email, fax)
 *   bar_number     (state bar #)
 *   date           (execution, notarization, signing)
 *   notary         (notary name)
 *   witness        (witness names)
 *   other          (anything else worth surfacing)
 */
import { getAvDb } from '@/lib/db/av';
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise';

export interface DocumentExtract {
  extractId: number;
  documentId: number;
  caseId: number;
  kind: string;
  label: string | null;
  value: string | null;
  pageNumber: number | null;
  note: string | null;
  modelId: string | null;
  createdAt: string | null;
}

export interface DocumentExtractInput {
  documentId: number;
  caseId: number;
  kind: string;
  label: string | null;
  value: string | null;
  pageNumber: number | null;
  note: string | null;
  modelId: string | null;
}

interface ExtractRow extends RowDataPacket {
  extract_id: number;
  document_id: number;
  case_id: number;
  kind: string;
  label: string | null;
  value: string | null;
  page_number: number | null;
  note: string | null;
  model_id: string | null;
  created_at: string | Date | null;
}

function rowToExtract(r: ExtractRow): DocumentExtract {
  return {
    extractId: r.extract_id,
    documentId: r.document_id,
    caseId: r.case_id,
    kind: r.kind,
    label: r.label,
    value: r.value,
    pageNumber: r.page_number,
    note: r.note,
    modelId: r.model_id,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : (r.created_at as string | null)
  };
}

/** All extracts for one document. */
export async function listExtractsForDocument(documentId: number): Promise<DocumentExtract[]> {
  if (!Number.isInteger(documentId) || documentId <= 0) return [];
  try {
    const db = getAvDb();
    const [rows] = await db.execute<ExtractRow[]>(
      `SELECT extract_id, document_id, case_id, kind, label, value,
              page_number, note, model_id, created_at
         FROM case_document_extracts
        WHERE document_id = ?
        ORDER BY FIELD(kind, 'attorney','firm','bar_number','address','contact','notary','witness','party','date','other'),
                 extract_id ASC`,
      [documentId]
    );
    return rows.map(rowToExtract);
  } catch (err) {
    console.error('listExtractsForDocument failed', err);
    return [];
  }
}

/** All extracts across every document on a case — for the operator
 *  case-overview panel ("who and how to reach them"). */
export async function listExtractsForCase(caseId: number): Promise<DocumentExtract[]> {
  if (!Number.isInteger(caseId) || caseId <= 0) return [];
  try {
    const db = getAvDb();
    const [rows] = await db.execute<ExtractRow[]>(
      `SELECT extract_id, document_id, case_id, kind, label, value,
              page_number, note, model_id, created_at
         FROM case_document_extracts
        WHERE case_id = ?
        ORDER BY FIELD(kind, 'attorney','firm','bar_number','address','contact','notary','witness','party','date','other'),
                 document_id, extract_id ASC`,
      [caseId]
    );
    return rows.map(rowToExtract);
  } catch (err) {
    console.error('listExtractsForCase failed', err);
    return [];
  }
}

/** Wipe extracts for a document — called before inserting a fresh batch
 *  so re-runs replace, never append duplicate party rows.
 *  (#673) NEVER deletes curated rows — anything the operator has edited
 *  stays put. Only LLM-only rows get cleared. */
export async function clearDocumentExtracts(documentId: number): Promise<boolean> {
  if (!Number.isInteger(documentId) || documentId <= 0) return false;
  try {
    const db = getAvDb();
    await db.execute<ResultSetHeader>(
      `DELETE FROM case_document_extracts WHERE document_id = ? AND is_curated = 0`,
      [documentId]
    );
    return true;
  } catch (err) {
    console.error('clearDocumentExtracts failed', err);
    return false;
  }
}

/** Insert one extract row. */
export async function insertDocumentExtract(input: DocumentExtractInput): Promise<number | null> {
  if (!Number.isInteger(input.documentId) || input.documentId <= 0) return null;
  if (!Number.isInteger(input.caseId) || input.caseId <= 0) return null;
  if (!input.kind) return null;
  try {
    const db = getAvDb();
    const [res] = await db.execute<ResultSetHeader>(
      `INSERT INTO case_document_extracts (
         document_id, case_id, kind, label, value, page_number, note, model_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.documentId,
        input.caseId,
        input.kind,
        input.label,
        input.value,
        input.pageNumber,
        input.note,
        input.modelId
      ]
    );
    return res.insertId || null;
  } catch (err) {
    console.error('insertDocumentExtract failed', err);
    return null;
  }
}
