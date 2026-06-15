/**
 * lib/case/document_reader.ts  (val 2026-06-15, #666)
 *
 * Universal LLM-powered document reader. Works on ANY uploaded PDF in
 * case_documents — trust, will, POA, contract, lease, deed, anything. The
 * pipeline is case-agnostic by design: every case has the same shape, so
 * the same machinery runs against Johnson's trust, Chip's solar contracts,
 * Lyons' yacht docs, Ron's defense filings, and every future client.
 *
 * Flow per run:
 *   1. Resolve the case_document row (storage_uri, document_kind, content_hash).
 *   2. Pull bytes from hot storage via the same path the byte-serve API uses.
 *   3. Extract per-page text with unpdf (already in use for section indexing).
 *   4. Build a kind-aware system prompt (trust → conflict scanner, contract →
 *      unfavorable terms, deed → owner/legal-description verify, generic →
 *      anomaly scan).
 *   5. Call runLlm with task kind 'document_read' (claude-sonnet/gpt-4o tier).
 *      Cache key includes content_hash so re-uploads invalidate automatically.
 *   6. Parse the JSON response, store rows in case_document_findings (DELETE
 *      WHERE document_id = ? first so re-runs replace, never append stale).
 *   7. Return findings array + cost so the route can echo to the operator UI.
 *
 * All prompts live in this file (per memory: feedback_prompt_visibility —
 * val sees what's being sent before her credits get spent).
 */
import { getHotStorage } from '@/lib/storage/provider';
import { runLlm } from '@/lib/llm/router';
import {
  getDocument,
  type CaseDocument
} from '@/lib/case/case_store';
import {
  clearDocumentFindings,
  insertDocumentFinding,
  type DocumentFindingInput
} from '@/lib/case/document_findings_store';

export interface DocumentReadResult {
  ok: boolean;
  findings: DocumentFindingInput[];
  pageCount: number;
  modelId: string;
  costMicrocents: number;
  cacheSource: 'live' | 'cache';
  error?: string;
  /** Raw LLM text — surfaced for QC so val can see what came back. */
  rawResponse?: string;
}

/** Kind-aware system prompt. Add new kinds by extending this map; the rest of
 *  the pipeline is unchanged. */
function systemPromptFor(documentKind: string | null): string {
  const k = (documentKind || '').toLowerCase();
  if (k === 'trust') return SYSTEM_PROMPT_TRUST;
  if (k === 'will') return SYSTEM_PROMPT_WILL;
  if (k === 'poa' || k === 'power_of_attorney') return SYSTEM_PROMPT_POA;
  if (k === 'contract') return SYSTEM_PROMPT_CONTRACT;
  if (k === 'deed') return SYSTEM_PROMPT_DEED;
  if (k === 'lease') return SYSTEM_PROMPT_LEASE;
  return SYSTEM_PROMPT_GENERIC;
}

const COMMON_OUTPUT_FORMAT = `
Return ONLY a JSON object (no markdown, no preamble) matching this exact shape:
{
  "findings": [
    {
      "section_key": "5.A" | "6.G(2)" | null,
      "quote": "Verbatim sentence from the document.",
      "oddity_type": "clause_conflict" | "late_modification" | "ambiguous_signature" | "missing_field" | "unusual_term" | "favorable_term" | "unfavorable_term" | "observation",
      "severity": "urgent" | "high" | "normal" | "info",
      "page_number": 12,
      "llm_note": "Operator-facing one-paragraph explanation of why this matters."
    }
  ]
}
If the document is clean — no findings — return {"findings": []}. Do NOT invent
section references; leave section_key null if the finding isn't tied to a clause.
Always quote verbatim — never paraphrase, never reword.`.trim();

const SYSTEM_PROMPT_TRUST = `You are a senior estate-planning paralegal reviewing an executed family trust for the trustors' family. Your job is to find any clauses that contradict each other, any provisions that look like late drafting changes (mismatched language between adjacent sections), any signature-block conflicts (e.g., joint-trustee vs single-signature authority), any unusual terms (unequal distributions, broad amendment powers, restrictions on the surviving spouse), and any missing fields. Family members will read your output — be precise but plain-spoken; no Latin. ${COMMON_OUTPUT_FORMAT}`;

const SYSTEM_PROMPT_WILL = `You are a senior estate-planning paralegal reviewing an executed will. Find clauses that conflict, residuary problems, ambiguous bequests, witness/signature anomalies, missing standard provisions (no-contest, simultaneous-death, ademption rules), unusual distributions. Family members will read your output. ${COMMON_OUTPUT_FORMAT}`;

const SYSTEM_PROMPT_POA = `You are reviewing an executed power-of-attorney. Find: scope ambiguities, expiration/triggering conditions, agent authority gaps, dual-agent conflict provisions, springing vs durable language inconsistencies, restrictions worth flagging. ${COMMON_OUTPUT_FORMAT}`;

const SYSTEM_PROMPT_CONTRACT = `You are reviewing a commercial contract on behalf of the signer. Find: unfavorable terms (auto-renewals, broad indemnities, one-sided termination, unlimited liability, IP grabs, non-competes), missing protections (data, warranty, dispute resolution), payment-term oddities, vague performance standards. Mark unfavorable_term findings as high or urgent severity depending on dollar exposure. ${COMMON_OUTPUT_FORMAT}`;

const SYSTEM_PROMPT_DEED = `You are reviewing a recorded deed. Verify: vesting language matches the parties' intent, legal description appears complete, no encumbrances stated that the buyer should know about, signatures + notary + recording stamp present. Flag any ambiguity in owner-of-record. ${COMMON_OUTPUT_FORMAT}`;

const SYSTEM_PROMPT_LEASE = `You are reviewing a lease. Find: renewal/escalator terms, security-deposit handling, repair/maintenance allocation, sublet restrictions, early-termination penalties, indemnity language. ${COMMON_OUTPUT_FORMAT}`;

const SYSTEM_PROMPT_GENERIC = `You are reviewing a legal or business document on behalf of the holder. Find any clauses worth flagging — conflicts, ambiguities, unfavorable terms, missing standard protections, unusual language. ${COMMON_OUTPUT_FORMAT}`;

/** Build the user-side prompt body: the per-page text wrapped in markers so
 *  the model can quote page numbers reliably. */
function buildUserPrompt(documentName: string, documentKind: string | null, pageTexts: string[]): string {
  const lines: string[] = [
    `Document: ${documentName}`,
    `Kind: ${documentKind || 'unspecified'}`,
    `Pages: ${pageTexts.length}`,
    ``,
    `--- BEGIN DOCUMENT TEXT (per-page) ---`
  ];
  pageTexts.forEach((txt, i) => {
    lines.push(``);
    lines.push(`=== Page ${i + 1} ===`);
    lines.push(txt.trim());
  });
  lines.push(``);
  lines.push(`--- END DOCUMENT TEXT ---`);
  lines.push(``);
  lines.push(`Now scan this document and return findings as JSON per the system instructions.`);
  return lines.join('\n');
}

/** Extract per-page text from PDF bytes via unpdf (same lib used by
 *  buildSectionIndex — already proven in production). */
async function extractPdfText(bytes: Buffer): Promise<{ pages: string[]; pageCount: number } | null> {
  try {
    const { extractText, getDocumentProxy } = await import('unpdf');
    const uint8 = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const doc = await getDocumentProxy(uint8);
    const result = await extractText(doc, { mergePages: false });
    const pages: string[] = Array.isArray(result.text)
      ? result.text
      : [String(result.text)];
    return { pages, pageCount: doc.numPages };
  } catch (err) {
    console.error('document_reader: pdf extract failed', err);
    return null;
  }
}

/** Parse the LLM's JSON response into structured findings. Robust to model
 *  variance — strips markdown fences, trims preamble, tolerates trailing
 *  commas. */
function parseFindings(raw: string, documentId: number, caseId: number, modelId: string): DocumentFindingInput[] {
  // Strip markdown fences if the model added them despite instructions.
  let body = raw.trim();
  if (body.startsWith('```')) {
    body = body.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  }
  // Some models prepend chatter — find the first { and the last }.
  const first = body.indexOf('{');
  const last = body.lastIndexOf('}');
  if (first < 0 || last < 0 || last <= first) return [];
  const slice = body.slice(first, last + 1);

  let parsed: unknown;
  try {
    parsed = JSON.parse(slice);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== 'object') return [];
  const arr = (parsed as Record<string, unknown>).findings;
  if (!Array.isArray(arr)) return [];

  const allowedSev = new Set(['urgent', 'high', 'normal', 'info']);
  const out: DocumentFindingInput[] = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const f = item as Record<string, unknown>;
    const sev = typeof f.severity === 'string' && allowedSev.has(f.severity) ? f.severity as 'urgent' | 'high' | 'normal' | 'info' : 'normal';
    out.push({
      documentId,
      caseId,
      sectionKey: typeof f.section_key === 'string' && f.section_key ? f.section_key : null,
      quote: typeof f.quote === 'string' && f.quote ? f.quote.slice(0, 4000) : null,
      oddityType: typeof f.oddity_type === 'string' && f.oddity_type ? f.oddity_type.slice(0, 64) : null,
      severity: sev,
      pageNumber: typeof f.page_number === 'number' && f.page_number > 0 ? Math.floor(f.page_number) : null,
      llmNote: typeof f.llm_note === 'string' && f.llm_note ? f.llm_note.slice(0, 4000) : null,
      modelId
    });
  }
  return out;
}

/**
 * Main entry. Reads the document with an LLM and stores structured findings.
 * Idempotent — re-running replaces the prior findings (no append).
 */
export async function readCaseDocument(documentId: number): Promise<DocumentReadResult> {
  const empty = (err: string): DocumentReadResult => ({
    ok: false, findings: [], pageCount: 0, modelId: '', costMicrocents: 0, cacheSource: 'live', error: err
  });

  const doc: CaseDocument | null = await getDocument(documentId);
  if (!doc) return empty('document not found');
  if (doc.mimeType !== 'application/pdf') {
    return empty(`only PDFs supported (got ${doc.mimeType || 'unknown'})`);
  }

  const bytes = await getHotStorage('case-documents').getBytes(doc.storageUri);
  if (!bytes) return empty('document bytes missing from storage');

  const extracted = await extractPdfText(Buffer.from(bytes));
  if (!extracted) return empty('PDF text extraction failed');
  if (extracted.pageCount === 0) return empty('PDF has zero pages');

  const systemPrompt = systemPromptFor(doc.documentKind);
  const userPrompt = buildUserPrompt(doc.documentName, doc.documentKind, extracted.pages);
  const fullPrompt = `${systemPrompt}\n\n---\n\n${userPrompt}`;

  // content_hash in the cache key means: same file bytes → same cached result;
  // operator uploads a revised PDF (different hash) → fresh LLM call.
  const cacheKeyExtras = [
    `doc:${documentId}`,
    `hash:${doc.contentHash || 'nohash'}`
  ];

  const llmResult = await runLlm({
    taskKind: 'document_read',
    note: `case ${doc.caseId} document ${documentId} (${doc.documentKind || 'unspecified'})`,
    clientId: doc.caseId,    // routed to per-case cost reporting via case_id
    tenantId: 'av',
    prompt: fullPrompt,
    cacheKeyExtras,
    temperature: 0.1,        // legal-read needs determinism, not creativity
    maxTokens: 4000,
    json: true
  });

  const findings = parseFindings(llmResult.text, documentId, doc.caseId, llmResult.model);

  // Replace existing findings (idempotent re-run).
  await clearDocumentFindings(documentId);
  for (const f of findings) {
    await insertDocumentFinding(f);
  }

  return {
    ok: true,
    findings,
    pageCount: extracted.pageCount,
    modelId: llmResult.model,
    costMicrocents: llmResult.costMicrocents,
    cacheSource: llmResult.source,
    rawResponse: llmResult.text
  };
}
