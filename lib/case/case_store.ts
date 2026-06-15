/**
 * lib/case/case_store.ts  (val 2026-06-11 — Johnson family anchor)
 *
 * Universal case-management store. Backs the case-management module
 * shipped in schema/089_case_management.sql. Reusable for any client
 * with `engagement_kind = 'legal_case'` OR any client that has at
 * least one row in `cases` (you don't have to be a legal_case client
 * to attach a case — Ron's defense_pr engagement can attach cases too).
 *
 * Composes with the family-wellness wrapper in lib/case/family_wellness.ts
 * when `cases.wellness_enabled = TRUE`.
 *
 * Pattern follows lib/av/account_team.ts:
 *  - getAvDb() for the per-tenant DB
 *  - typed Row interfaces extending RowDataPacket
 *  - ResultSetHeader for inserts/updates
 *  - soft-fail to [] / null on DB miss so UI never explodes
 *  - toIso() helper for date normalization to the UI layer
 *
 * Hard rules honored (per memory):
 *  - All clients by default: every function takes clientId/caseId, no
 *    Johnson-family hardcoding.
 *  - No vendor names: source labels stay neutral ('email_forward',
 *    'manual', 'recorder_pull', not branded tool names).
 *  - Mirror every client page: operator + client APIs share this lib.
 *  - Visibility-gap: every write that adds intelligence (a recorder
 *    pull, a wellness check with concerns) should surface within a
 *    week. The lib makes that possible; the UI enforces it.
 */
import { getAvDb } from '@/lib/db/av';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';

// ── Public types ──────────────────────────────────────────────────────

export type CaseStatus = 'open' | 'on_hold' | 'closed';
export type CaseKind =
  | 'general_litigation'
  | 'trust_dispute'
  | 'elder_advocacy'
  | 'estate_litigation'
  | 'malpractice_defense'
  | 'campaign_legal'
  | 'guardianship'
  | 'family_law'
  | 'business_litigation';

export interface CaseRecord {
  caseId: number;
  clientId: number;
  caseName: string;
  caseKind: CaseKind | string;
  caseSynopsis: string | null;
  status: CaseStatus | string;
  openedAt: string | null;
  closedAt: string | null;
  wellnessEnabled: boolean;
  metadata: Record<string, unknown> | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface CaseEvent {
  eventId: number;
  caseId: number;
  eventDate: string;            // ISO date YYYY-MM-DD
  eventKind: string | null;
  eventTitle: string;
  eventDetail: string | null;
  source: string | null;
  sourceUri: string | null;
  createdByUserId: number | null;
  createdAt: string | null;
}

export type DocumentApprovalStatus = 'draft' | 'pending_review' | 'approved' | 'rejected';

export interface CaseDocument {
  documentId: number;
  caseId: number;
  documentName: string;
  documentKind: string | null;
  storageUri: string;
  contentHash: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  uploadedByUserId: number | null;
  uploadedAt: string | null;
  notes: string | null;
  /** {sectionKey: pageNumber} map for PDF deep-linking. NULL = not indexed yet. */
  sectionIndex: Record<string, number> | null;
  // (val 2026-06-12, #612) Document approval workflow.
  /** draft → pending_review → approved → rejected. Clients see only 'approved'. */
  approvalStatus: DocumentApprovalStatus;
  /** client_user_id of the collaborator (typically attorney) who approved/rejected. */
  approvedByUserId: number | null;
  approvedAt: string | null;
  /** Adriana's note when approving/rejecting. */
  approvalNote: string | null;
  /** When non-null, this doc is scoped to a specific action item (e.g. an option draft). */
  attachedToActionId: number | null;
}

export interface CaseParty {
  partyId: number;
  caseId: number;
  fullName: string;
  role: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  relationship: string | null;
  isVeteran: boolean;
  isParent: boolean;
  notes: string | null;
  createdAt: string | null;
}

export type ActionStatus = 'open' | 'in_progress' | 'done' | 'blocked';
export type ActionPriority = 'low' | 'normal' | 'high' | 'urgent';

// (val 2026-06-15, #685) 'legal_team' = Rebecca + Adriana + val. Hidden from
// the parents. Schema migration 098 adds it to the ENUM.
export type ActionVisibility = 'parents_safe' | 'operator_only' | 'legal_team';

// (val 2026-06-15, #694) family_bucket — which group the item belongs to on
// the FAMILY case view. Schema migration 099 adds it. Universal: works for
// any case_kind, not Johnson-specific.
//   reviewer_handling = Adriana / the legal reviewer is on it
//   family_decision   = mom + dad need to choose something
//   info_only         = read when you can, no action needed
export type ActionFamilyBucket = 'reviewer_handling' | 'family_decision' | 'info_only';

export interface CaseActionItem {
  actionId: number;
  caseId: number;
  title: string;
  detail: string | null;
  status: ActionStatus | string;
  priority: ActionPriority | string;
  /** parents_safe = renders on family view; operator_only = Rebecca/Adriana/val only. */
  visibility: ActionVisibility;
  assignedToUserId: number | null;
  dueDate: string | null;
  completedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  // (val 2026-06-15, #694) Family-view fields. Schema 099.
  /** One-line plain-English status the family sees ABOVE the legal detail. */
  familyNextStep: string | null;
  /** Which group on the family Outstanding items section. */
  familyBucket: ActionFamilyBucket;
  /** ISO timestamp of when a family member tapped "Got it". NULL = not yet. */
  familyAcknowledgedAt: string | null;
  /** client_user_id of the family member who tapped "Got it". */
  familyAcknowledgedByUserId: number | null;
}

export interface CaseProperty {
  propertyId: number;
  caseId: number;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  county: string | null;
  apn: string | null;
  currentTitledOwner: string | null;
  estimatedValueCents: number | null;
  knownLiens: Array<Record<string, unknown>> | null;
  knownMortgages: Array<Record<string, unknown>> | null;
  equityCents: number | null;
  lastRecorderPullAt: string | null;
  recorderSource: string | null;
  notes: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

// ── Row types (DB shape) ──────────────────────────────────────────────

interface CaseRow extends RowDataPacket {
  case_id: number;
  client_id: number;
  case_name: string;
  case_kind: string;
  case_synopsis: string | null;
  status: string;
  opened_at: Date | string | null;
  closed_at: Date | string | null;
  wellness_enabled: number | boolean;
  metadata: string | object | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
}

interface EventRow extends RowDataPacket {
  event_id: number;
  case_id: number;
  event_date: Date | string;
  event_kind: string | null;
  event_title: string;
  event_detail: string | null;
  source: string | null;
  source_uri: string | null;
  created_by_user_id: number | null;
  created_at: Date | string | null;
}

interface DocumentRow extends RowDataPacket {
  document_id: number;
  case_id: number;
  document_name: string;
  document_kind: string | null;
  storage_uri: string;
  content_hash: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  uploaded_by_user_id: number | null;
  uploaded_at: Date | string | null;
  notes: string | null;
  section_index: string | null;
  // (#612) Approval workflow columns. Added in schema/093_document_approval.sql.
  approval_status: string | null;
  approved_by_user_id: number | null;
  approved_at: Date | string | null;
  approval_note: string | null;
  attached_to_action_id: number | null;
}

interface PartyRow extends RowDataPacket {
  party_id: number;
  case_id: number;
  full_name: string;
  role: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  relationship: string | null;
  is_veteran: number | boolean;
  is_parent: number | boolean;
  notes: string | null;
  created_at: Date | string | null;
}

interface ActionRow extends RowDataPacket {
  action_id: number;
  case_id: number;
  title: string;
  detail: string | null;
  status: string;
  priority: string;
  visibility: string | null;
  assigned_to_user_id: number | null;
  due_date: Date | string | null;
  completed_at: Date | string | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
  // (val 2026-06-15, #694) Family-view columns from schema 099.
  family_next_step: string | null;
  family_bucket: string | null;
  family_acknowledged_at: Date | string | null;
  family_acknowledged_by_user_id: number | null;
}

interface PropertyRow extends RowDataPacket {
  property_id: number;
  case_id: number;
  address_line: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  county: string | null;
  apn: string | null;
  current_titled_owner: string | null;
  estimated_value_cents: number | null;
  known_liens: string | object | null;
  known_mortgages: string | object | null;
  equity_cents: number | null;
  last_recorder_pull_at: Date | string | null;
  recorder_source: string | null;
  notes: string | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────

function toIso(v: Date | string | null | undefined): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function toDateString(v: Date | string | null | undefined): string | null {
  if (!v) return null;
  if (typeof v === 'string') {
    // Already in YYYY-MM-DD form?
    if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  }
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function parseJson<T>(v: string | object | null | undefined): T | null {
  if (v == null) return null;
  if (typeof v === 'object') return v as T;
  try {
    return JSON.parse(v) as T;
  } catch {
    return null;
  }
}

function rowToCase(r: CaseRow): CaseRecord {
  return {
    caseId: r.case_id,
    clientId: r.client_id,
    caseName: r.case_name,
    caseKind: r.case_kind,
    caseSynopsis: r.case_synopsis,
    status: r.status,
    openedAt: toIso(r.opened_at),
    closedAt: toIso(r.closed_at),
    wellnessEnabled: !!r.wellness_enabled,
    metadata: parseJson(r.metadata),
    createdAt: toIso(r.created_at),
    updatedAt: toIso(r.updated_at)
  };
}

function rowToEvent(r: EventRow): CaseEvent {
  return {
    eventId: r.event_id,
    caseId: r.case_id,
    eventDate: toDateString(r.event_date) ?? '',
    eventKind: r.event_kind,
    eventTitle: r.event_title,
    eventDetail: r.event_detail,
    source: r.source,
    sourceUri: r.source_uri,
    createdByUserId: r.created_by_user_id,
    createdAt: toIso(r.created_at)
  };
}

function rowToDocument(r: DocumentRow): CaseDocument {
  let sectionIndex: Record<string, number> | null = null;
  if (r.section_index) {
    // mysql2 can return a JSON column EITHER as a string (older driver versions,
    // certain server settings) OR as an already-parsed object (newer default).
    // Handle both — JSON.parse on an object throws, which used to leave
    // sectionIndex permanently null and broke the deep-link renderer.
    const raw = r.section_index as unknown;
    if (typeof raw === 'object' && raw !== null) {
      sectionIndex = raw as Record<string, number>;
    } else if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          sectionIndex = parsed as Record<string, number>;
        }
      } catch { /* malformed JSON — treat as not indexed */ }
    }
  }
  // Default approval_status to 'approved' for any row that pre-dates migration
  // 093 (existing trust PDF, property report) so old docs stay visible.
  const rawStatus = (r.approval_status ?? 'approved') as string;
  const approvalStatus: DocumentApprovalStatus = (
    rawStatus === 'draft' || rawStatus === 'pending_review' ||
    rawStatus === 'approved' || rawStatus === 'rejected'
  ) ? (rawStatus as DocumentApprovalStatus) : 'approved';
  return {
    documentId: r.document_id,
    caseId: r.case_id,
    documentName: r.document_name,
    documentKind: r.document_kind,
    storageUri: r.storage_uri,
    contentHash: r.content_hash,
    mimeType: r.mime_type,
    sizeBytes: r.size_bytes == null ? null : Number(r.size_bytes),
    uploadedByUserId: r.uploaded_by_user_id,
    uploadedAt: toIso(r.uploaded_at),
    notes: r.notes,
    sectionIndex,
    approvalStatus,
    approvedByUserId: r.approved_by_user_id == null ? null : Number(r.approved_by_user_id),
    approvedAt: toIso(r.approved_at),
    approvalNote: r.approval_note,
    attachedToActionId: r.attached_to_action_id == null ? null : Number(r.attached_to_action_id)
  };
}

function rowToParty(r: PartyRow): CaseParty {
  return {
    partyId: r.party_id,
    caseId: r.case_id,
    fullName: r.full_name,
    role: r.role,
    contactEmail: r.contact_email,
    contactPhone: r.contact_phone,
    relationship: r.relationship,
    isVeteran: !!r.is_veteran,
    isParent: !!r.is_parent,
    notes: r.notes,
    createdAt: toIso(r.created_at)
  };
}

function rowToAction(r: ActionRow): CaseActionItem {
  return {
    actionId: r.action_id,
    caseId: r.case_id,
    title: r.title,
    detail: r.detail,
    status: r.status,
    priority: r.priority,
    // Default to parents_safe so legacy rows without the column still render.
    // (val 2026-06-15, #685) legal_team is the new Rebecca+Adriana+val tier.
    visibility:
      r.visibility === 'operator_only' ? 'operator_only' :
      r.visibility === 'legal_team' ? 'legal_team' :
      'parents_safe',
    assignedToUserId: r.assigned_to_user_id,
    dueDate: toDateString(r.due_date),
    completedAt: toIso(r.completed_at),
    createdAt: toIso(r.created_at),
    updatedAt: toIso(r.updated_at),
    // (val 2026-06-15, #694) Family-view fields. Migration 099. Default
    // family_bucket to reviewer_handling for rows that pre-date the migration.
    familyNextStep: r.family_next_step ?? null,
    familyBucket:
      r.family_bucket === 'family_decision' ? 'family_decision' :
      r.family_bucket === 'info_only' ? 'info_only' :
      'reviewer_handling',
    familyAcknowledgedAt: toIso(r.family_acknowledged_at ?? null),
    familyAcknowledgedByUserId: r.family_acknowledged_by_user_id ?? null
  };
}

function rowToProperty(r: PropertyRow): CaseProperty {
  return {
    propertyId: r.property_id,
    caseId: r.case_id,
    addressLine: r.address_line,
    city: r.city,
    state: r.state,
    zip: r.zip,
    county: r.county,
    apn: r.apn,
    currentTitledOwner: r.current_titled_owner,
    estimatedValueCents: r.estimated_value_cents == null ? null : Number(r.estimated_value_cents),
    knownLiens: parseJson<Array<Record<string, unknown>>>(r.known_liens),
    knownMortgages: parseJson<Array<Record<string, unknown>>>(r.known_mortgages),
    equityCents: r.equity_cents == null ? null : Number(r.equity_cents),
    lastRecorderPullAt: toIso(r.last_recorder_pull_at),
    recorderSource: r.recorder_source,
    notes: r.notes,
    createdAt: toIso(r.created_at),
    updatedAt: toIso(r.updated_at)
  };
}

// ── Case CRUD ─────────────────────────────────────────────────────────

export interface CreateCaseInput {
  clientId: number;
  caseName: string;
  caseKind?: CaseKind | string;
  caseSynopsis?: string | null;
  wellnessEnabled?: boolean;
  metadata?: Record<string, unknown> | null;
}

export async function createCase(input: CreateCaseInput): Promise<number | null> {
  if (!Number.isInteger(input.clientId) || input.clientId <= 0) return null;
  if (!input.caseName || !input.caseName.trim()) return null;
  try {
    const db = getAvDb();
    const [res] = await db.execute<ResultSetHeader>(
      `INSERT INTO cases (
         client_id, case_name, case_kind, case_synopsis,
         wellness_enabled, metadata
       ) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        input.clientId,
        input.caseName.trim(),
        input.caseKind || 'general_litigation',
        input.caseSynopsis ?? null,
        input.wellnessEnabled ? 1 : 0,
        input.metadata ? JSON.stringify(input.metadata) : null
      ]
    );
    return res.insertId || null;
  } catch (err) {
    console.error('createCase failed', err);
    return null;
  }
}

export async function getCase(caseId: number): Promise<CaseRecord | null> {
  if (!Number.isInteger(caseId) || caseId <= 0) return null;
  try {
    const db = getAvDb();
    const [rows] = await db.execute<CaseRow[]>(
      `SELECT case_id, client_id, case_name, case_kind, case_synopsis,
              status, opened_at, closed_at, wellness_enabled, metadata,
              created_at, updated_at
         FROM cases
        WHERE case_id = ?
        LIMIT 1`,
      [caseId]
    );
    if (!rows.length) return null;
    return rowToCase(rows[0]);
  } catch (err) {
    console.error('getCase failed', err);
    return null;
  }
}

export async function listCasesForClient(clientId: number): Promise<CaseRecord[]> {
  if (!Number.isInteger(clientId) || clientId <= 0) return [];
  try {
    const db = getAvDb();
    const [rows] = await db.execute<CaseRow[]>(
      `SELECT case_id, client_id, case_name, case_kind, case_synopsis,
              status, opened_at, closed_at, wellness_enabled, metadata,
              created_at, updated_at
         FROM cases
        WHERE client_id = ?
        ORDER BY status = 'open' DESC, opened_at DESC, case_id DESC`,
      [clientId]
    );
    return rows.map(rowToCase);
  } catch (err) {
    console.error('listCasesForClient failed', err);
    return [];
  }
}

/**
 * Cases the given client_user can see:
 *   - all cases under their primary client_id, PLUS
 *   - cases they've been invited to as collaborators (parent_approved AND not revoked).
 * This is what powers Adriana-as-attorney access to Johnson, sibling-readers
 * on other families, etc. Phase 3 Wave 3.
 */
export async function listCasesAccessibleByClientUser(
  clientUserId: number,
  primaryClientId: number | null
): Promise<CaseRecord[]> {
  if (!Number.isInteger(clientUserId) || clientUserId <= 0) return [];
  try {
    const db = getAvDb();
    // UNION ALL — primary-client cases + collaborator-granted cases.
    // The DISTINCT on case_id collapses any case the user could see via both
    // routes (e.g. their primary client IS the case-anchored client AND
    // they're explicitly in collaborators too).
    const [rows] = await db.execute<CaseRow[]>(
      `SELECT DISTINCT c.case_id, c.client_id, c.case_name, c.case_kind, c.case_synopsis,
              c.status, c.opened_at, c.closed_at, c.wellness_enabled, c.metadata,
              c.created_at, c.updated_at
         FROM cases c
        WHERE c.client_id = ?
           OR c.case_id IN (
              SELECT case_id FROM family_case_collaborators
               WHERE client_user_id = ?
                 AND parent_approved = TRUE
                 AND revoked_at IS NULL
           )
        ORDER BY status = 'open' DESC, opened_at DESC, case_id DESC`,
      [primaryClientId ?? 0, clientUserId]
    );
    return rows.map(rowToCase);
  } catch (err) {
    console.error('listCasesAccessibleByClientUser failed', err);
    return [];
  }
}

/**
 * Whether a client_user can access a specific case.
 *   true if the case belongs to their primary client_id, OR
 *   true if they have an approved, non-revoked collaborator row on it.
 * Used by /client/cases/[caseId] for the IDOR check.
 */
export async function canClientUserAccessCase(
  clientUserId: number,
  primaryClientId: number | null,
  caseId: number
): Promise<boolean> {
  if (!Number.isInteger(caseId) || caseId <= 0) return false;
  if (!Number.isInteger(clientUserId) || clientUserId <= 0) return false;
  try {
    const db = getAvDb();
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT 1 AS ok FROM cases
        WHERE case_id = ?
          AND (
            client_id = ?
            OR case_id IN (
              SELECT case_id FROM family_case_collaborators
               WHERE client_user_id = ?
                 AND parent_approved = TRUE
                 AND revoked_at IS NULL
            )
          )
        LIMIT 1`,
      [caseId, primaryClientId ?? 0, clientUserId]
    );
    return rows.length > 0;
  } catch (err) {
    console.error('canClientUserAccessCase failed', err);
    return false;
  }
}

export async function listAllOpenCases(): Promise<CaseRecord[]> {
  try {
    const db = getAvDb();
    const [rows] = await db.execute<CaseRow[]>(
      `SELECT case_id, client_id, case_name, case_kind, case_synopsis,
              status, opened_at, closed_at, wellness_enabled, metadata,
              created_at, updated_at
         FROM cases
        WHERE status = 'open'
        ORDER BY opened_at DESC, case_id DESC`
    );
    return rows.map(rowToCase);
  } catch (err) {
    console.error('listAllOpenCases failed', err);
    return [];
  }
}

export async function updateCase(
  caseId: number,
  patch: Partial<{
    caseName: string;
    caseKind: string;
    caseSynopsis: string | null;
    status: CaseStatus | string;
    wellnessEnabled: boolean;
    metadata: Record<string, unknown> | null;
  }>
): Promise<boolean> {
  if (!Number.isInteger(caseId) || caseId <= 0) return false;
  const fields: string[] = [];
  const params: unknown[] = [];
  if (patch.caseName !== undefined) { fields.push('case_name = ?'); params.push(patch.caseName); }
  if (patch.caseKind !== undefined) { fields.push('case_kind = ?'); params.push(patch.caseKind); }
  if (patch.caseSynopsis !== undefined) { fields.push('case_synopsis = ?'); params.push(patch.caseSynopsis); }
  if (patch.status !== undefined) {
    fields.push('status = ?', 'closed_at = ?');
    params.push(patch.status, patch.status === 'closed' ? new Date() : null);
  }
  if (patch.wellnessEnabled !== undefined) { fields.push('wellness_enabled = ?'); params.push(patch.wellnessEnabled ? 1 : 0); }
  if (patch.metadata !== undefined) { fields.push('metadata = ?'); params.push(patch.metadata ? JSON.stringify(patch.metadata) : null); }
  if (!fields.length) return false;
  params.push(caseId);
  try {
    const db = getAvDb();
    await db.execute<ResultSetHeader>(
      `UPDATE cases SET ${fields.join(', ')} WHERE case_id = ?`,
      params
    );
    return true;
  } catch (err) {
    console.error('updateCase failed', err);
    return false;
  }
}

// ── Events ────────────────────────────────────────────────────────────

export interface AppendEventInput {
  caseId: number;
  eventDate: string;            // YYYY-MM-DD
  eventKind?: string | null;
  eventTitle: string;
  eventDetail?: string | null;
  source?: string | null;
  sourceUri?: string | null;
  createdByUserId?: number | null;
}

export async function appendEvent(input: AppendEventInput): Promise<number | null> {
  if (!Number.isInteger(input.caseId) || input.caseId <= 0) return null;
  if (!input.eventTitle || !input.eventTitle.trim()) return null;
  try {
    const db = getAvDb();
    const [res] = await db.execute<ResultSetHeader>(
      `INSERT INTO case_events (
         case_id, event_date, event_kind, event_title, event_detail,
         source, source_uri, created_by_user_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.caseId,
        input.eventDate,
        input.eventKind ?? null,
        input.eventTitle.trim(),
        input.eventDetail ?? null,
        input.source ?? null,
        input.sourceUri ?? null,
        input.createdByUserId ?? null
      ]
    );
    return res.insertId || null;
  } catch (err) {
    console.error('appendEvent failed', err);
    return null;
  }
}

export async function listEvents(caseId: number, sinceDate?: string): Promise<CaseEvent[]> {
  if (!Number.isInteger(caseId) || caseId <= 0) return [];
  try {
    const db = getAvDb();
    if (sinceDate) {
      const [rows] = await db.execute<EventRow[]>(
        `SELECT * FROM case_events WHERE case_id = ? AND event_date >= ?
         ORDER BY event_date DESC, event_id DESC`,
        [caseId, sinceDate]
      );
      return rows.map(rowToEvent);
    }
    const [rows] = await db.execute<EventRow[]>(
      `SELECT * FROM case_events WHERE case_id = ?
       ORDER BY event_date DESC, event_id DESC`,
      [caseId]
    );
    return rows.map(rowToEvent);
  } catch (err) {
    console.error('listEvents failed', err);
    return [];
  }
}

/**
 * (val 2026-06-15, #682) Operator inline edit on the timeline. Schema columns:
 * event_date, event_kind, event_title, event_detail, source, source_uri.
 * No visibility column on case_events — every event renders to every viewer
 * who can see the case (parents/account_rep/professional/operator). Keep
 * sensitive log entries in case_action_items where visibility lives.
 */
export async function updateEvent(
  eventId: number,
  caseId: number,
  patch: Partial<{
    eventDate: string;        // YYYY-MM-DD
    eventKind: string | null;
    eventTitle: string;
    eventDetail: string | null;
    source: string | null;
    sourceUri: string | null;
  }>
): Promise<boolean> {
  if (!Number.isInteger(eventId) || eventId <= 0) return false;
  if (!Number.isInteger(caseId) || caseId <= 0) return false;
  const fields: string[] = [];
  const params: unknown[] = [];
  if (patch.eventDate !== undefined) { fields.push('event_date = ?'); params.push(patch.eventDate); }
  if (patch.eventKind !== undefined) { fields.push('event_kind = ?'); params.push(patch.eventKind); }
  if (patch.eventTitle !== undefined) { fields.push('event_title = ?'); params.push(patch.eventTitle); }
  if (patch.eventDetail !== undefined) { fields.push('event_detail = ?'); params.push(patch.eventDetail); }
  if (patch.source !== undefined) { fields.push('source = ?'); params.push(patch.source); }
  if (patch.sourceUri !== undefined) { fields.push('source_uri = ?'); params.push(patch.sourceUri); }
  if (!fields.length) return false;
  params.push(eventId, caseId);
  try {
    const db = getAvDb();
    const [res] = await db.execute<ResultSetHeader>(
      `UPDATE case_events SET ${fields.join(', ')} WHERE event_id = ? AND case_id = ?`,
      params
    );
    return res.affectedRows > 0;
  } catch (err) {
    console.error('updateEvent failed', err);
    return false;
  }
}

export async function deleteEvent(eventId: number, caseId: number): Promise<boolean> {
  if (!Number.isInteger(eventId) || eventId <= 0) return false;
  if (!Number.isInteger(caseId) || caseId <= 0) return false;
  try {
    const db = getAvDb();
    const [res] = await db.execute<ResultSetHeader>(
      `DELETE FROM case_events WHERE event_id = ? AND case_id = ?`,
      [eventId, caseId]
    );
    return res.affectedRows > 0;
  } catch (err) {
    console.error('deleteEvent failed', err);
    return false;
  }
}

// ── Documents ─────────────────────────────────────────────────────────

export interface AttachDocumentInput {
  caseId: number;
  documentName: string;
  documentKind?: string | null;
  storageUri: string;
  contentHash?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  uploadedByUserId?: number | null;
  notes?: string | null;
  // (val 2026-06-12, #612) Approval workflow fields.
  /** Default 'draft' for new operator uploads so they don't auto-publish to clients.
   *  Set to 'approved' for legacy-style direct uploads where no review is needed. */
  approvalStatus?: DocumentApprovalStatus;
  /** When provided, doc is scoped to a specific action item (e.g. the Cecilia options). */
  attachedToActionId?: number | null;
}

export async function attachDocument(input: AttachDocumentInput): Promise<number | null> {
  if (!Number.isInteger(input.caseId) || input.caseId <= 0) return null;
  if (!input.documentName || !input.storageUri) return null;
  try {
    const db = getAvDb();
    const [res] = await db.execute<ResultSetHeader>(
      `INSERT INTO case_documents (
         case_id, document_name, document_kind, storage_uri, content_hash,
         mime_type, size_bytes, uploaded_by_user_id, notes,
         approval_status, attached_to_action_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.caseId,
        input.documentName.trim(),
        input.documentKind ?? null,
        input.storageUri,
        input.contentHash ?? null,
        input.mimeType ?? null,
        input.sizeBytes ?? null,
        input.uploadedByUserId ?? null,
        input.notes ?? null,
        input.approvalStatus ?? 'draft',
        input.attachedToActionId ?? null
      ]
    );
    return res.insertId || null;
  } catch (err) {
    console.error('attachDocument failed', err);
    return null;
  }
}

// ── Document approval (val 2026-06-12, #612) ──────────────────────────────
//
// One unified helper instead of separate approve/reject/submit-for-review
// functions. Caller passes the new status + optional note + the user id that
// took the action. We stamp approved_at + approved_by on approve/reject so
// the audit trail is clear. 'draft' and 'pending_review' clear those fields.

export interface SetDocumentApprovalInput {
  documentId: number;
  status: DocumentApprovalStatus;
  /** client_user_id (collaborator who approved) OR null for operator self-actions. */
  actorClientUserId: number | null;
  note?: string | null;
}

export async function setDocumentApprovalStatus(
  input: SetDocumentApprovalInput
): Promise<boolean> {
  if (!Number.isInteger(input.documentId) || input.documentId <= 0) return false;
  const stamps = input.status === 'approved' || input.status === 'rejected';
  try {
    const db = getAvDb();
    const [res] = await db.execute<ResultSetHeader>(
      `UPDATE case_documents
          SET approval_status = ?,
              approved_by_user_id = ${stamps ? '?' : 'NULL'},
              approved_at = ${stamps ? 'CURRENT_TIMESTAMP' : 'NULL'},
              approval_note = ?
        WHERE document_id = ?`,
      stamps
        ? [input.status, input.actorClientUserId, input.note ?? null, input.documentId]
        : [input.status, input.note ?? null, input.documentId]
    );
    return res.affectedRows > 0;
  } catch (err) {
    console.error('setDocumentApprovalStatus failed', err);
    return false;
  }
}

/** List docs scoped to a single action item. Used on the action detail page
 *  to render the per-option drafts attached to "Decide: Cecilia removal". */
export async function listDocumentsForAction(actionId: number): Promise<CaseDocument[]> {
  if (!Number.isInteger(actionId) || actionId <= 0) return [];
  try {
    const db = getAvDb();
    const [rows] = await db.execute<DocumentRow[]>(
      `SELECT * FROM case_documents
        WHERE attached_to_action_id = ?
        ORDER BY uploaded_at DESC, document_id DESC`,
      [actionId]
    );
    return rows.map(rowToDocument);
  } catch (err) {
    console.error('listDocumentsForAction failed', err);
    return [];
  }
}

export async function listDocuments(caseId: number, kind?: string): Promise<CaseDocument[]> {
  if (!Number.isInteger(caseId) || caseId <= 0) return [];
  try {
    const db = getAvDb();
    if (kind) {
      const [rows] = await db.execute<DocumentRow[]>(
        `SELECT * FROM case_documents WHERE case_id = ? AND document_kind = ?
         ORDER BY uploaded_at DESC, document_id DESC`,
        [caseId, kind]
      );
      return rows.map(rowToDocument);
    }
    const [rows] = await db.execute<DocumentRow[]>(
      `SELECT * FROM case_documents WHERE case_id = ?
       ORDER BY uploaded_at DESC, document_id DESC`,
      [caseId]
    );
    return rows.map(rowToDocument);
  } catch (err) {
    console.error('listDocuments failed', err);
    return [];
  }
}

/** Fetch a single document by id. Used by the byte-serve endpoint. */
export async function getDocument(documentId: number): Promise<CaseDocument | null> {
  if (!Number.isInteger(documentId) || documentId <= 0) return null;
  try {
    const db = getAvDb();
    const [rows] = await db.execute<DocumentRow[]>(
      `SELECT * FROM case_documents WHERE document_id = ? LIMIT 1`,
      [documentId]
    );
    return rows[0] ? rowToDocument(rows[0]) : null;
  } catch (err) {
    console.error('getDocument failed', err);
    return null;
  }
}

/** Update the document_kind on an existing row. Used when the operator
 *  uploaded without picking a Kind and now wants to tag it (so the § indexer
 *  can recognize it as a trust/will/POA and the deep-link renderer can find it).
 */
export async function updateDocumentKind(
  documentId: number,
  kind: string | null
): Promise<boolean> {
  if (!Number.isInteger(documentId) || documentId <= 0) return false;
  try {
    const db = getAvDb();
    await db.execute<ResultSetHeader>(
      `UPDATE case_documents SET document_kind = ? WHERE document_id = ?`,
      [kind, documentId]
    );
    return true;
  } catch (err) {
    console.error('updateDocumentKind failed', err);
    return false;
  }
}

/**
 * (val 2026-06-15, #683) Operator-only document metadata edit. Supports rename
 * (documentName) and notes edits. Kind has its own updater above because PATCH
 * on kind also triggers the §-index rebuild — those routes stay separate.
 */
export async function updateDocument(
  documentId: number,
  caseId: number,
  patch: Partial<{ documentName: string; notes: string | null }>
): Promise<boolean> {
  if (!Number.isInteger(documentId) || documentId <= 0) return false;
  if (!Number.isInteger(caseId) || caseId <= 0) return false;
  const fields: string[] = [];
  const params: unknown[] = [];
  if (patch.documentName !== undefined) {
    fields.push('document_name = ?');
    params.push(patch.documentName);
  }
  if (patch.notes !== undefined) {
    fields.push('notes = ?');
    params.push(patch.notes);
  }
  if (!fields.length) return false;
  params.push(documentId, caseId);
  try {
    const db = getAvDb();
    const [res] = await db.execute<ResultSetHeader>(
      `UPDATE case_documents SET ${fields.join(', ')} WHERE document_id = ? AND case_id = ?`,
      params
    );
    return res.affectedRows > 0;
  } catch (err) {
    console.error('updateDocument failed', err);
    return false;
  }
}

/** Persist the {sectionKey: pageNumber} index built by pdf_section_index. */
export async function setDocumentSectionIndex(
  documentId: number,
  index: Record<string, number>
): Promise<boolean> {
  if (!Number.isInteger(documentId) || documentId <= 0) return false;
  try {
    const db = getAvDb();
    await db.execute<ResultSetHeader>(
      `UPDATE case_documents SET section_index = ? WHERE document_id = ?`,
      [JSON.stringify(index), documentId]
    );
    return true;
  } catch (err) {
    console.error('setDocumentSectionIndex failed', err);
    return false;
  }
}

/** Return the most recent indexable document for a case — the "trust" doc
 *  takes priority because that's what action items reference; falls back to
 *  will / poa / medical_directive. Used by renderers that need to know which
 *  doc to deep-link sections into.
 */
export async function findIndexableDocumentForCase(caseId: number): Promise<CaseDocument | null> {
  if (!Number.isInteger(caseId) || caseId <= 0) return null;
  try {
    const db = getAvDb();
    const [rows] = await db.execute<DocumentRow[]>(
      `SELECT * FROM case_documents
        WHERE case_id = ?
          AND document_kind IN ('trust', 'will', 'poa', 'medical_directive')
        ORDER BY FIELD(document_kind, 'trust', 'will', 'poa', 'medical_directive'),
                 uploaded_at DESC, document_id DESC
        LIMIT 1`,
      [caseId]
    );
    return rows[0] ? rowToDocument(rows[0]) : null;
  } catch (err) {
    console.error('findIndexableDocumentForCase failed', err);
    return null;
  }
}

/** Delete a document row. Caller is responsible for purging blob bytes. */
export async function deleteDocument(documentId: number): Promise<boolean> {
  if (!Number.isInteger(documentId) || documentId <= 0) return false;
  try {
    const db = getAvDb();
    const [res] = await db.execute<ResultSetHeader>(
      `DELETE FROM case_documents WHERE document_id = ?`,
      [documentId]
    );
    return res.affectedRows > 0;
  } catch (err) {
    console.error('deleteDocument failed', err);
    return false;
  }
}

// ── Parties ───────────────────────────────────────────────────────────

export interface AddPartyInput {
  caseId: number;
  fullName: string;
  role?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  relationship?: string | null;
  isVeteran?: boolean;
  isParent?: boolean;
  notes?: string | null;
}

export async function addParty(input: AddPartyInput): Promise<number | null> {
  if (!Number.isInteger(input.caseId) || input.caseId <= 0) return null;
  if (!input.fullName || !input.fullName.trim()) return null;
  try {
    const db = getAvDb();
    const [res] = await db.execute<ResultSetHeader>(
      `INSERT INTO case_parties (
         case_id, full_name, role, contact_email, contact_phone,
         relationship, is_veteran, is_parent, notes
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.caseId,
        input.fullName.trim(),
        input.role ?? null,
        input.contactEmail ?? null,
        input.contactPhone ?? null,
        input.relationship ?? null,
        input.isVeteran ? 1 : 0,
        input.isParent ? 1 : 0,
        input.notes ?? null
      ]
    );
    return res.insertId || null;
  } catch (err) {
    console.error('addParty failed', err);
    return null;
  }
}

export async function listParties(caseId: number): Promise<CaseParty[]> {
  if (!Number.isInteger(caseId) || caseId <= 0) return [];
  try {
    const db = getAvDb();
    const [rows] = await db.execute<PartyRow[]>(
      `SELECT * FROM case_parties WHERE case_id = ?
       ORDER BY is_parent DESC, full_name ASC`,
      [caseId]
    );
    return rows.map(rowToParty);
  } catch (err) {
    console.error('listParties failed', err);
    return [];
  }
}

// ── Action Items ──────────────────────────────────────────────────────

export interface AddActionInput {
  caseId: number;
  title: string;
  detail?: string | null;
  priority?: ActionPriority;
  assignedToUserId?: number | null;
  dueDate?: string | null;
}

export async function addActionItem(input: AddActionInput): Promise<number | null> {
  if (!Number.isInteger(input.caseId) || input.caseId <= 0) return null;
  if (!input.title || !input.title.trim()) return null;
  try {
    const db = getAvDb();
    const [res] = await db.execute<ResultSetHeader>(
      `INSERT INTO case_action_items (
         case_id, title, detail, priority, assigned_to_user_id, due_date
       ) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        input.caseId,
        input.title.trim(),
        input.detail ?? null,
        input.priority || 'normal',
        input.assignedToUserId ?? null,
        input.dueDate ?? null
      ]
    );
    return res.insertId || null;
  } catch (err) {
    console.error('addActionItem failed', err);
    return null;
  }
}

export async function updateActionItem(
  actionId: number,
  patch: Partial<{
    title: string;
    detail: string | null;
    status: ActionStatus;
    priority: ActionPriority;
    visibility: ActionVisibility;
    assignedToUserId: number | null;
    dueDate: string | null;
    // (val 2026-06-15, #694) Family-view writes from operator editor.
    familyNextStep: string | null;
    familyBucket: ActionFamilyBucket;
  }>
): Promise<boolean> {
  if (!Number.isInteger(actionId) || actionId <= 0) return false;
  const fields: string[] = [];
  const params: unknown[] = [];
  if (patch.title !== undefined) { fields.push('title = ?'); params.push(patch.title); }
  if (patch.detail !== undefined) { fields.push('detail = ?'); params.push(patch.detail); }
  if (patch.status !== undefined) {
    fields.push('status = ?', 'completed_at = ?');
    params.push(patch.status, patch.status === 'done' ? new Date() : null);
  }
  if (patch.priority !== undefined) { fields.push('priority = ?'); params.push(patch.priority); }
  if (patch.visibility !== undefined) { fields.push('visibility = ?'); params.push(patch.visibility); }
  if (patch.assignedToUserId !== undefined) { fields.push('assigned_to_user_id = ?'); params.push(patch.assignedToUserId); }
  if (patch.dueDate !== undefined) { fields.push('due_date = ?'); params.push(patch.dueDate); }
  if (patch.familyNextStep !== undefined) { fields.push('family_next_step = ?'); params.push(patch.familyNextStep); }
  if (patch.familyBucket !== undefined) { fields.push('family_bucket = ?'); params.push(patch.familyBucket); }
  if (!fields.length) return false;
  params.push(actionId);
  try {
    const db = getAvDb();
    await db.execute<ResultSetHeader>(
      `UPDATE case_action_items SET ${fields.join(', ')} WHERE action_id = ?`,
      params
    );
    return true;
  } catch (err) {
    console.error('updateActionItem failed', err);
    return false;
  }
}

/**
 * Family-side acknowledge toggle.  (val 2026-06-15, #694)
 *
 * Rebecca / Gordon / Maria / Adriana taps "Got it" on an item from the
 * family case view. Idempotent — tapping again clears the acknowledgment
 * (so a family member can untick if they tapped by accident or want to
 * re-read it). The progress strip at the top of Outstanding items reads
 * the COUNT(family_acknowledged_at IS NOT NULL).
 *
 * This does NOT change status or completed_at — those are operator-only
 * state. Acknowledgment is a separate "I've seen this and understand
 * what's being done" signal, not a "this is finished" claim.
 */
export async function toggleFamilyAcknowledge(
  actionId: number,
  clientUserId: number
): Promise<{ acknowledged: boolean } | null> {
  if (!Number.isInteger(actionId) || actionId <= 0) return null;
  if (!Number.isInteger(clientUserId) || clientUserId <= 0) return null;
  try {
    const db = getAvDb();
    // Read current state to decide toggle direction.
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT family_acknowledged_at FROM case_action_items WHERE action_id = ? LIMIT 1`,
      [actionId]
    );
    if (rows.length === 0) return null;
    const wasAcked = (rows[0] as { family_acknowledged_at: Date | string | null }).family_acknowledged_at != null;
    if (wasAcked) {
      // Clear.
      await db.execute<ResultSetHeader>(
        `UPDATE case_action_items
           SET family_acknowledged_at = NULL,
               family_acknowledged_by_user_id = NULL
           WHERE action_id = ?`,
        [actionId]
      );
      return { acknowledged: false };
    } else {
      // Set to now + the tapping user.
      await db.execute<ResultSetHeader>(
        `UPDATE case_action_items
           SET family_acknowledged_at = NOW(),
               family_acknowledged_by_user_id = ?
           WHERE action_id = ?`,
        [clientUserId, actionId]
      );
      return { acknowledged: true };
    }
  } catch (err) {
    console.error('toggleFamilyAcknowledge failed', err);
    return null;
  }
}

/**
 * Hard-delete an action item.  (val 2026-06-14, #632)
 *
 * Used by the per-case action item editor. Action items are working state
 * for the operator — soft-delete adds clutter and val's workflow today is
 * "draft / rewrite / replace", not "archive". The case_action_item_notes
 * table will cascade-orphan; we don't preserve them on delete because the
 * note is tied to the action, not the case.
 */
export async function deleteActionItem(actionId: number): Promise<boolean> {
  if (!Number.isInteger(actionId) || actionId <= 0) return false;
  try {
    const db = getAvDb();
    // Notes first (FK guard — explicit, not relying on ON DELETE CASCADE
    // since the table didn't ship with one and we don't want a 500 if it's
    // missing in a given environment).
    await db.execute<ResultSetHeader>(
      `DELETE FROM case_action_item_notes WHERE action_id = ?`,
      [actionId]
    );
    const [res] = await db.execute<ResultSetHeader>(
      `DELETE FROM case_action_items WHERE action_id = ?`,
      [actionId]
    );
    return res.affectedRows > 0;
  } catch (err) {
    console.error('deleteActionItem failed', err);
    return false;
  }
}

/** Single action item lookup (with case_id so the route can IDOR-check). */
export async function getActionItem(actionId: number): Promise<CaseActionItem | null> {
  if (!Number.isInteger(actionId) || actionId <= 0) return null;
  try {
    const db = getAvDb();
    const [rows] = await db.execute<ActionRow[]>(
      `SELECT * FROM case_action_items WHERE action_id = ? LIMIT 1`,
      [actionId]
    );
    if (!rows.length) return null;
    return rowToAction(rows[0]);
  } catch (err) {
    console.error('getActionItem failed', err);
    return null;
  }
}

// ── Action item notes ─────────────────────────────────────────────────
// schema/092 ships the case_action_item_notes table. Notes are append-only
// (no edit/delete in v1 — keeps the audit trail honest for legal matters).

export interface CaseActionItemNote {
  noteId: number;
  actionId: number;
  body: string;
  authorRole: 'owner' | 'staff' | 'client_user';
  authorUserId: number;
  authorDisplayName: string | null;
  createdAt: string | null;
}

interface NoteRow extends RowDataPacket {
  note_id: number;
  action_id: number;
  body: string;
  author_role: 'owner' | 'staff' | 'client_user';
  author_user_id: number;
  author_display_name: string | null;
  created_at: Date | string | null;
}

export async function listActionItemNotes(actionId: number): Promise<CaseActionItemNote[]> {
  if (!Number.isInteger(actionId) || actionId <= 0) return [];
  try {
    const db = getAvDb();
    const [rows] = await db.execute<NoteRow[]>(
      `SELECT * FROM case_action_item_notes WHERE action_id = ?
        ORDER BY created_at ASC`,
      [actionId]
    );
    return rows.map((r) => ({
      noteId: r.note_id,
      actionId: r.action_id,
      body: r.body,
      authorRole: r.author_role,
      authorUserId: r.author_user_id,
      authorDisplayName: r.author_display_name,
      createdAt: toIso(r.created_at)
    }));
  } catch (err) {
    console.error('listActionItemNotes failed', err);
    return [];
  }
}

export async function addActionItemNote(input: {
  actionId: number;
  body: string;
  authorRole: 'owner' | 'staff' | 'client_user';
  authorUserId: number;
  authorDisplayName: string | null;
}): Promise<number | null> {
  if (!Number.isInteger(input.actionId) || input.actionId <= 0) return null;
  if (!input.body || !input.body.trim()) return null;
  try {
    const db = getAvDb();
    const [res] = await db.execute<ResultSetHeader>(
      `INSERT INTO case_action_item_notes
         (action_id, body, author_role, author_user_id, author_display_name)
       VALUES (?, ?, ?, ?, ?)`,
      [
        input.actionId,
        input.body.trim(),
        input.authorRole,
        input.authorUserId,
        input.authorDisplayName
      ]
    );
    return res.insertId || null;
  } catch (err) {
    console.error('addActionItemNote failed', err);
    return null;
  }
}

export async function listActionItems(
  caseId: number,
  /** (val 2026-06-13, #635) Optional visibility filter. When supplied, only
   *  rows whose `visibility` is in the array are returned. Pass undefined
   *  for full operator visibility. */
  visibleVisibilities?: ActionVisibility[]
): Promise<CaseActionItem[]> {
  if (!Number.isInteger(caseId) || caseId <= 0) return [];
  if (visibleVisibilities && visibleVisibilities.length === 0) return [];
  try {
    const db = getAvDb();

    const params: (number | string)[] = [caseId];
    let visClause = '';
    if (visibleVisibilities && visibleVisibilities.length > 0) {
      visClause = `AND visibility IN (${visibleVisibilities.map(() => '?').join(',')})`;
      for (const v of visibleVisibilities) params.push(v);
    }

    const [rows] = await db.execute<ActionRow[]>(
      `SELECT * FROM case_action_items
        WHERE case_id = ?
          ${visClause}
        ORDER BY
          CASE status WHEN 'urgent' THEN 0 WHEN 'open' THEN 1 WHEN 'in_progress' THEN 2 WHEN 'blocked' THEN 3 WHEN 'done' THEN 4 ELSE 5 END,
          CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 WHEN 'low' THEN 3 ELSE 4 END,
          created_at DESC`,
      params
    );
    return rows.map(rowToAction);
  } catch (err) {
    console.error('listActionItems failed', err);
    return [];
  }
}

// ── Property ──────────────────────────────────────────────────────────

export interface UpsertPropertyInput {
  caseId: number;
  addressLine?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  county?: string | null;
  apn?: string | null;
  currentTitledOwner?: string | null;
  estimatedValueCents?: number | null;
  knownLiens?: Array<Record<string, unknown>> | null;
  knownMortgages?: Array<Record<string, unknown>> | null;
  equityCents?: number | null;
  lastRecorderPullAt?: string | null;
  recorderSource?: string | null;
  notes?: string | null;
}

export async function getProperty(caseId: number): Promise<CaseProperty | null> {
  if (!Number.isInteger(caseId) || caseId <= 0) return null;
  try {
    const db = getAvDb();
    const [rows] = await db.execute<PropertyRow[]>(
      `SELECT * FROM case_property WHERE case_id = ? ORDER BY property_id ASC LIMIT 1`,
      [caseId]
    );
    if (!rows.length) return null;
    return rowToProperty(rows[0]);
  } catch (err) {
    console.error('getProperty failed', err);
    return null;
  }
}

export async function upsertProperty(input: UpsertPropertyInput): Promise<number | null> {
  if (!Number.isInteger(input.caseId) || input.caseId <= 0) return null;
  const existing = await getProperty(input.caseId);
  try {
    const db = getAvDb();
    if (existing) {
      const fields: string[] = [];
      const params: unknown[] = [];
      const set = (col: string, v: unknown, encode = false) => {
        if (v === undefined) return;
        fields.push(`${col} = ?`);
        params.push(encode && v != null ? JSON.stringify(v) : v);
      };
      set('address_line', input.addressLine);
      set('city', input.city);
      set('state', input.state);
      set('zip', input.zip);
      set('county', input.county);
      set('apn', input.apn);
      set('current_titled_owner', input.currentTitledOwner);
      set('estimated_value_cents', input.estimatedValueCents);
      set('known_liens', input.knownLiens, true);
      set('known_mortgages', input.knownMortgages, true);
      set('equity_cents', input.equityCents);
      set('last_recorder_pull_at', input.lastRecorderPullAt);
      set('recorder_source', input.recorderSource);
      set('notes', input.notes);
      if (!fields.length) return existing.propertyId;
      params.push(existing.propertyId);
      await db.execute<ResultSetHeader>(
        `UPDATE case_property SET ${fields.join(', ')} WHERE property_id = ?`,
        params
      );
      return existing.propertyId;
    }
    const [res] = await db.execute<ResultSetHeader>(
      `INSERT INTO case_property (
         case_id, address_line, city, state, zip, county, apn,
         current_titled_owner, estimated_value_cents,
         known_liens, known_mortgages, equity_cents,
         last_recorder_pull_at, recorder_source, notes
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.caseId,
        input.addressLine ?? null,
        input.city ?? null,
        input.state ?? null,
        input.zip ?? null,
        input.county ?? null,
        input.apn ?? null,
        input.currentTitledOwner ?? null,
        input.estimatedValueCents ?? null,
        input.knownLiens ? JSON.stringify(input.knownLiens) : null,
        input.knownMortgages ? JSON.stringify(input.knownMortgages) : null,
        input.equityCents ?? null,
        input.lastRecorderPullAt ?? null,
        input.recorderSource ?? null,
        input.notes ?? null
      ]
    );
    return res.insertId || null;
  } catch (err) {
    console.error('upsertProperty failed', err);
    return null;
  }
}

// ── Combined load (one query path for the case dashboard page) ────────

export interface FullCaseLoad {
  case: CaseRecord;
  events: CaseEvent[];
  documents: CaseDocument[];
  parties: CaseParty[];
  actionItems: CaseActionItem[];
  property: CaseProperty | null;
}

export async function loadFullCase(
  caseId: number,
  /** (val 2026-06-13, #635) Optional visibility filter applied to action
   *  items. Pass the result of visibleFor(role) — undefined = operator full
   *  visibility. Drives the parents_safe vs operator_only audience split. */
  visibleVisibilities?: ActionVisibility[]
): Promise<FullCaseLoad | null> {
  const c = await getCase(caseId);
  if (!c) return null;
  const [events, documents, parties, actionItems, property] = await Promise.all([
    listEvents(caseId),
    listDocuments(caseId),
    listParties(caseId),
    listActionItems(caseId, visibleVisibilities),
    getProperty(caseId)
  ]);
  return { case: c, events, documents, parties, actionItems, property };
}
