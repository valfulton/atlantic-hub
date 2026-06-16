/**
 * lib/case/family_wellness.ts  (val 2026-06-11 — Johnson family anchor)
 *
 * Family wellness wrapper that composes with lib/case/case_store.ts.
 * Activated when cases.wellness_enabled = TRUE.
 *
 * Surfaces:
 *  - Health roster (doctors, meds, conditions, allergies, insurance)
 *  - Care appointments (with transport-responsible assignment)
 *  - Veterans services (eligibility, benefits in play, applications)
 *  - Financial summary (monthly accounting + runway, parent-approved)
 *  - Meeting notes (financial-housekeeping meetings, parent-approved)
 *  - Wellness checks (cognition / mood / physical / unusual contacts)
 *  - Collaborators (parents control who is admitted, sibling invites)
 *
 * Hard rules honored:
 *  - Parents stay in control: invite-parent_approved + decision-parent_approved
 *    workflows live here.
 *  - Visibility-gap: every concerning observation surfaces. A wellness
 *    check with concerns is queryable + the dashboard can badge from it.
 *  - All clients by default: nothing Johnson-specific.
 */
import { getAvDb } from '@/lib/db/av';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';

// ── Public types ──────────────────────────────────────────────────────

export interface HealthRosterEntry {
  rosterId: number;
  caseId: number;
  partyId: number | null;
  category: string;
  label: string;
  details: string | null;
  contactName: string | null;
  contactPhone: string | null;
  contactAddress: string | null;
  carrierNumber: string | null;
  lastVisitDate: string | null;
  nextVisitDate: string | null;
  notes: string | null;
  addedAt: string | null;
  updatedAt: string | null;
}

export interface CareAppointment {
  appointmentId: number;
  caseId: number;
  partyId: number | null;
  appointmentKind: string | null;
  scheduledAt: string | null;
  providerName: string | null;
  location: string | null;
  transportResponsibleUserId: number | null;
  notes: string | null;
  completed: boolean;
  completedAt: string | null;
  outcomeNotes: string | null;
  createdAt: string | null;
}

export interface VeteransRecord {
  vaId: number;
  caseId: number;
  partyId: number | null;
  serviceBranch: string | null;
  serviceStartDate: string | null;
  serviceEndDate: string | null;
  dischargeStatus: string | null;
  vaCaseNumber: string | null;
  vaCaseWorkerName: string | null;
  vaCaseWorkerPhone: string | null;
  disabilityRatingPct: number | null;
  benefitsInPlay: Array<Record<string, unknown>> | null;
  applicationsInFlight: Array<Record<string, unknown>> | null;
  notes: string | null;
}

export interface FinancialSummary {
  summaryId: number;
  caseId: number;
  reportingPeriodStart: string | null;
  reportingPeriodEnd: string | null;
  incomeTotalCents: number | null;
  expenseTotalCents: number | null;
  endingBalanceCents: number | null;
  monthlyBurnEstimateCents: number | null;
  estimatedRunwayMonths: number | null;
  notes: string | null;
  preparedByUserId: number | null;
  preparedAt: string | null;
  approvedByParent: boolean;
  approvedAt: string | null;
  approvedByUserId: number | null;
}

export interface MeetingNote {
  meetingId: number;
  caseId: number;
  meetingDate: string | null;
  meetingKind: string | null;
  attendees: Array<Record<string, unknown>> | null;
  agenda: string | null;
  notes: string | null;
  decisions: Array<Record<string, unknown>> | null;
  parentsApproved: boolean;
  parentsApprovedAt: string | null;
  followUpActions: Array<Record<string, unknown>> | null;
  ledByUserId: number | null;
  createdAt: string | null;
}

export interface WellnessCheck {
  checkId: number;
  caseId: number;
  partyObservedId: number | null;
  observedAt: string | null;
  observedByUserId: number;
  observationKind: string | null;
  cognitionNote: string | null;
  moodNote: string | null;
  physicalNote: string | null;
  unusualContactsNote: string | null;
  concerns: string | null;
  positiveObservations: string | null;
  createdAt: string | null;
}

export interface Collaborator {
  collaboratorId: number;
  caseId: number;
  clientUserId: number;
  role: string;
  invitedByUserId: number;
  invitedAt: string | null;
  invitationAccepted: boolean;
  acceptedAt: string | null;
  parentApproved: boolean;
  parentApprovedAt: string | null;
  parentApprovedByUserId: number | null;
  revokedAt: string | null;
  permissions: Record<string, unknown> | null;
}

// ── Row types ─────────────────────────────────────────────────────────

interface HealthRow extends RowDataPacket {
  roster_id: number; case_id: number; party_id: number | null;
  category: string; label: string; details: string | null;
  contact_name: string | null; contact_phone: string | null;
  contact_address: string | null; carrier_number: string | null;
  last_visit_date: Date | string | null; next_visit_date: Date | string | null;
  notes: string | null; added_at: Date | string | null; updated_at: Date | string | null;
}
interface ApptRow extends RowDataPacket {
  appointment_id: number; case_id: number; party_id: number | null;
  appointment_kind: string | null; scheduled_at: Date | string | null;
  provider_name: string | null; location: string | null;
  transport_responsible_user_id: number | null; notes: string | null;
  completed: number | boolean; completed_at: Date | string | null;
  outcome_notes: string | null; created_at: Date | string | null;
}
interface VaRow extends RowDataPacket {
  va_id: number; case_id: number; party_id: number | null;
  service_branch: string | null; service_start_date: Date | string | null;
  service_end_date: Date | string | null; discharge_status: string | null;
  va_case_number: string | null; va_case_worker_name: string | null;
  va_case_worker_phone: string | null; disability_rating_pct: number | null;
  benefits_in_play: string | object | null; applications_in_flight: string | object | null;
  notes: string | null;
}
interface FinSumRow extends RowDataPacket {
  summary_id: number; case_id: number;
  reporting_period_start: Date | string | null; reporting_period_end: Date | string | null;
  income_total_cents: number | null; expense_total_cents: number | null;
  ending_balance_cents: number | null; monthly_burn_estimate_cents: number | null;
  estimated_runway_months: number | null; notes: string | null;
  prepared_by_user_id: number | null; prepared_at: Date | string | null;
  approved_by_parent: number | boolean; approved_at: Date | string | null;
  approved_by_user_id: number | null;
}
interface MeetingRow extends RowDataPacket {
  meeting_id: number; case_id: number; meeting_date: Date | string | null;
  meeting_kind: string | null; attendees: string | object | null;
  agenda: string | null; notes: string | null; decisions: string | object | null;
  parents_approved: number | boolean; parents_approved_at: Date | string | null;
  follow_up_actions: string | object | null; led_by_user_id: number | null;
  created_at: Date | string | null;
}
interface CheckRow extends RowDataPacket {
  check_id: number; case_id: number; party_observed_id: number | null;
  observed_at: Date | string | null; observed_by_user_id: number;
  observation_kind: string | null; cognition_note: string | null;
  mood_note: string | null; physical_note: string | null;
  unusual_contacts_note: string | null; concerns: string | null;
  positive_observations: string | null; created_at: Date | string | null;
}
interface CollabRow extends RowDataPacket {
  collaborator_id: number; case_id: number; client_user_id: number;
  role: string; invited_by_user_id: number; invited_at: Date | string | null;
  invitation_accepted: number | boolean; accepted_at: Date | string | null;
  parent_approved: number | boolean; parent_approved_at: Date | string | null;
  parent_approved_by_user_id: number | null; revoked_at: Date | string | null;
  permissions: string | object | null;
}

// ── Helpers ───────────────────────────────────────────────────────────

function toIso(v: Date | string | null | undefined): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
function toDateString(v: Date | string | null | undefined): string | null {
  if (!v) return null;
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}
function parseJson<T>(v: string | object | null | undefined): T | null {
  if (v == null) return null;
  if (typeof v === 'object') return v as T;
  try { return JSON.parse(v) as T; } catch { return null; }
}

// ── Health roster ─────────────────────────────────────────────────────

export async function listHealthRoster(caseId: number, partyId?: number): Promise<HealthRosterEntry[]> {
  if (!Number.isInteger(caseId) || caseId <= 0) return [];
  try {
    const db = getAvDb();
    const where = partyId ? 'WHERE case_id = ? AND party_id = ?' : 'WHERE case_id = ?';
    const params = partyId ? [caseId, partyId] : [caseId];
    const [rows] = await db.execute<HealthRow[]>(
      `SELECT * FROM family_health_roster ${where}
       ORDER BY party_id ASC, category ASC, label ASC`,
      params
    );
    return rows.map((r) => ({
      rosterId: r.roster_id, caseId: r.case_id, partyId: r.party_id,
      category: r.category, label: r.label, details: r.details,
      contactName: r.contact_name, contactPhone: r.contact_phone,
      contactAddress: r.contact_address, carrierNumber: r.carrier_number,
      lastVisitDate: toDateString(r.last_visit_date),
      nextVisitDate: toDateString(r.next_visit_date),
      notes: r.notes, addedAt: toIso(r.added_at), updatedAt: toIso(r.updated_at)
    }));
  } catch (err) { console.error('listHealthRoster failed', err); return []; }
}

export interface AddHealthRosterInput {
  caseId: number; partyId?: number | null; category: string; label: string;
  details?: string | null; contactName?: string | null; contactPhone?: string | null;
  contactAddress?: string | null; carrierNumber?: string | null;
  lastVisitDate?: string | null; nextVisitDate?: string | null;
  notes?: string | null; addedByUserId?: number | null;
}

export async function addHealthRosterEntry(input: AddHealthRosterInput): Promise<number | null> {
  if (!Number.isInteger(input.caseId) || input.caseId <= 0) return null;
  if (!input.category || !input.label) return null;
  try {
    const db = getAvDb();
    const [res] = await db.execute<ResultSetHeader>(
      `INSERT INTO family_health_roster (
         case_id, party_id, category, label, details, contact_name,
         contact_phone, contact_address, carrier_number,
         last_visit_date, next_visit_date, notes, added_by_user_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.caseId, input.partyId ?? null, input.category, input.label,
        input.details ?? null, input.contactName ?? null,
        input.contactPhone ?? null, input.contactAddress ?? null,
        input.carrierNumber ?? null, input.lastVisitDate ?? null,
        input.nextVisitDate ?? null, input.notes ?? null,
        input.addedByUserId ?? null
      ]
    );
    return res.insertId || null;
  } catch (err) { console.error('addHealthRosterEntry failed', err); return null; }
}

// ── Care appointments ────────────────────────────────────────────────

export async function listAppointments(caseId: number, includeCompleted = false): Promise<CareAppointment[]> {
  if (!Number.isInteger(caseId) || caseId <= 0) return [];
  try {
    const db = getAvDb();
    const where = includeCompleted ? 'WHERE case_id = ?' : 'WHERE case_id = ? AND completed = 0';
    const [rows] = await db.execute<ApptRow[]>(
      `SELECT * FROM family_care_appointments ${where} ORDER BY scheduled_at ASC`,
      [caseId]
    );
    return rows.map((r) => ({
      appointmentId: r.appointment_id, caseId: r.case_id, partyId: r.party_id,
      appointmentKind: r.appointment_kind, scheduledAt: toIso(r.scheduled_at),
      providerName: r.provider_name, location: r.location,
      transportResponsibleUserId: r.transport_responsible_user_id,
      notes: r.notes, completed: !!r.completed, completedAt: toIso(r.completed_at),
      outcomeNotes: r.outcome_notes, createdAt: toIso(r.created_at)
    }));
  } catch (err) { console.error('listAppointments failed', err); return []; }
}

export interface AddAppointmentInput {
  caseId: number; partyId?: number | null; appointmentKind?: string | null;
  scheduledAt: string; providerName?: string | null; location?: string | null;
  transportResponsibleUserId?: number | null; notes?: string | null;
}

export async function addAppointment(input: AddAppointmentInput): Promise<number | null> {
  if (!Number.isInteger(input.caseId) || input.caseId <= 0) return null;
  if (!input.scheduledAt) return null;
  try {
    const db = getAvDb();
    const [res] = await db.execute<ResultSetHeader>(
      `INSERT INTO family_care_appointments (
         case_id, party_id, appointment_kind, scheduled_at,
         provider_name, location, transport_responsible_user_id, notes
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.caseId, input.partyId ?? null, input.appointmentKind ?? null,
        input.scheduledAt, input.providerName ?? null, input.location ?? null,
        input.transportResponsibleUserId ?? null, input.notes ?? null
      ]
    );
    return res.insertId || null;
  } catch (err) { console.error('addAppointment failed', err); return null; }
}

// ── Veterans ──────────────────────────────────────────────────────────

export async function getVeteransRecord(caseId: number, partyId: number): Promise<VeteransRecord | null> {
  if (!Number.isInteger(caseId) || caseId <= 0) return null;
  try {
    const db = getAvDb();
    const [rows] = await db.execute<VaRow[]>(
      `SELECT * FROM family_veterans_services WHERE case_id = ? AND party_id = ? LIMIT 1`,
      [caseId, partyId]
    );
    if (!rows.length) return null;
    const r = rows[0];
    return {
      vaId: r.va_id, caseId: r.case_id, partyId: r.party_id,
      serviceBranch: r.service_branch,
      serviceStartDate: toDateString(r.service_start_date),
      serviceEndDate: toDateString(r.service_end_date),
      dischargeStatus: r.discharge_status, vaCaseNumber: r.va_case_number,
      vaCaseWorkerName: r.va_case_worker_name, vaCaseWorkerPhone: r.va_case_worker_phone,
      disabilityRatingPct: r.disability_rating_pct,
      benefitsInPlay: parseJson<Array<Record<string, unknown>>>(r.benefits_in_play),
      applicationsInFlight: parseJson<Array<Record<string, unknown>>>(r.applications_in_flight),
      notes: r.notes
    };
  } catch (err) { console.error('getVeteransRecord failed', err); return null; }
}

// ── Financial summary ────────────────────────────────────────────────

export async function listFinancialSummaries(caseId: number): Promise<FinancialSummary[]> {
  if (!Number.isInteger(caseId) || caseId <= 0) return [];
  try {
    const db = getAvDb();
    const [rows] = await db.execute<FinSumRow[]>(
      `SELECT * FROM family_financial_summary WHERE case_id = ?
       ORDER BY reporting_period_start DESC, summary_id DESC`,
      [caseId]
    );
    return rows.map((r) => ({
      summaryId: r.summary_id, caseId: r.case_id,
      reportingPeriodStart: toDateString(r.reporting_period_start),
      reportingPeriodEnd: toDateString(r.reporting_period_end),
      incomeTotalCents: r.income_total_cents == null ? null : Number(r.income_total_cents),
      expenseTotalCents: r.expense_total_cents == null ? null : Number(r.expense_total_cents),
      endingBalanceCents: r.ending_balance_cents == null ? null : Number(r.ending_balance_cents),
      monthlyBurnEstimateCents: r.monthly_burn_estimate_cents == null ? null : Number(r.monthly_burn_estimate_cents),
      estimatedRunwayMonths: r.estimated_runway_months,
      notes: r.notes, preparedByUserId: r.prepared_by_user_id, preparedAt: toIso(r.prepared_at),
      approvedByParent: !!r.approved_by_parent, approvedAt: toIso(r.approved_at),
      approvedByUserId: r.approved_by_user_id
    }));
  } catch (err) { console.error('listFinancialSummaries failed', err); return []; }
}

// ── Meetings ─────────────────────────────────────────────────────────

export async function listMeetingNotes(caseId: number): Promise<MeetingNote[]> {
  if (!Number.isInteger(caseId) || caseId <= 0) return [];
  try {
    const db = getAvDb();
    const [rows] = await db.execute<MeetingRow[]>(
      `SELECT * FROM family_meeting_notes WHERE case_id = ?
       ORDER BY meeting_date DESC, meeting_id DESC`,
      [caseId]
    );
    return rows.map((r) => ({
      meetingId: r.meeting_id, caseId: r.case_id,
      meetingDate: toDateString(r.meeting_date),
      meetingKind: r.meeting_kind,
      attendees: parseJson<Array<Record<string, unknown>>>(r.attendees),
      agenda: r.agenda, notes: r.notes,
      decisions: parseJson<Array<Record<string, unknown>>>(r.decisions),
      parentsApproved: !!r.parents_approved,
      parentsApprovedAt: toIso(r.parents_approved_at),
      followUpActions: parseJson<Array<Record<string, unknown>>>(r.follow_up_actions),
      ledByUserId: r.led_by_user_id, createdAt: toIso(r.created_at)
    }));
  } catch (err) { console.error('listMeetingNotes failed', err); return []; }
}

// ── Wellness checks ──────────────────────────────────────────────────

export async function listWellnessChecks(caseId: number, limit = 50): Promise<WellnessCheck[]> {
  if (!Number.isInteger(caseId) || caseId <= 0) return [];
  // (val 2026-06-16, #706) mysql2 prepared-statement quirk: binding LIMIT as
  // a parameter throws ER_WRONG_ARGUMENTS / errno 1210 on some MySQL versions
  // (HostGator's MariaDB hits this). The fix is to validate the limit as a
  // positive integer + interpolate it into the SQL string (no SQL injection
  // risk: we control the value and clamp it to [1, 500]). The bug was crashing
  // the live /client/cases/[caseId] page render (server-side exception
  // digest 2183789934) for every viewer that landed on a case with this
  // call in the loader.
  const safeLimit = Math.min(Math.max(Math.trunc(limit) || 50, 1), 500);
  try {
    const db = getAvDb();
    const [rows] = await db.execute<CheckRow[]>(
      `SELECT * FROM family_wellness_checks WHERE case_id = ?
       ORDER BY observed_at DESC LIMIT ${safeLimit}`,
      [caseId]
    );
    return rows.map((r) => ({
      checkId: r.check_id, caseId: r.case_id, partyObservedId: r.party_observed_id,
      observedAt: toIso(r.observed_at), observedByUserId: r.observed_by_user_id,
      observationKind: r.observation_kind, cognitionNote: r.cognition_note,
      moodNote: r.mood_note, physicalNote: r.physical_note,
      unusualContactsNote: r.unusual_contacts_note, concerns: r.concerns,
      positiveObservations: r.positive_observations, createdAt: toIso(r.created_at)
    }));
  } catch (err) { console.error('listWellnessChecks failed', err); return []; }
}

export interface AddWellnessCheckInput {
  caseId: number; partyObservedId?: number | null; observedAt: string;
  observedByUserId: number; observationKind?: string | null;
  cognitionNote?: string | null; moodNote?: string | null;
  physicalNote?: string | null; unusualContactsNote?: string | null;
  concerns?: string | null; positiveObservations?: string | null;
}

export async function addWellnessCheck(input: AddWellnessCheckInput): Promise<number | null> {
  if (!Number.isInteger(input.caseId) || input.caseId <= 0) return null;
  try {
    const db = getAvDb();
    const [res] = await db.execute<ResultSetHeader>(
      `INSERT INTO family_wellness_checks (
         case_id, party_observed_id, observed_at, observed_by_user_id,
         observation_kind, cognition_note, mood_note, physical_note,
         unusual_contacts_note, concerns, positive_observations
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.caseId, input.partyObservedId ?? null, input.observedAt,
        input.observedByUserId, input.observationKind ?? null,
        input.cognitionNote ?? null, input.moodNote ?? null,
        input.physicalNote ?? null, input.unusualContactsNote ?? null,
        input.concerns ?? null, input.positiveObservations ?? null
      ]
    );
    return res.insertId || null;
  } catch (err) { console.error('addWellnessCheck failed', err); return null; }
}

// ── Collaborators ────────────────────────────────────────────────────

export async function listCollaborators(caseId: number): Promise<Collaborator[]> {
  if (!Number.isInteger(caseId) || caseId <= 0) return [];
  try {
    const db = getAvDb();
    const [rows] = await db.execute<CollabRow[]>(
      `SELECT * FROM family_case_collaborators WHERE case_id = ? AND revoked_at IS NULL
       ORDER BY parent_approved DESC, role ASC, invited_at ASC`,
      [caseId]
    );
    return rows.map((r) => ({
      collaboratorId: r.collaborator_id, caseId: r.case_id, clientUserId: r.client_user_id,
      role: r.role, invitedByUserId: r.invited_by_user_id, invitedAt: toIso(r.invited_at),
      invitationAccepted: !!r.invitation_accepted, acceptedAt: toIso(r.accepted_at),
      parentApproved: !!r.parent_approved, parentApprovedAt: toIso(r.parent_approved_at),
      parentApprovedByUserId: r.parent_approved_by_user_id,
      revokedAt: toIso(r.revoked_at),
      permissions: parseJson<Record<string, unknown>>(r.permissions)
    }));
  } catch (err) { console.error('listCollaborators failed', err); return []; }
}

// ── Combined load (one query path for the wellness panel mount) ──────

export interface FullWellnessLoad {
  healthRoster: HealthRosterEntry[];
  upcomingAppointments: CareAppointment[];
  financialSummaries: FinancialSummary[];
  meetingNotes: MeetingNote[];
  recentWellnessChecks: WellnessCheck[];
  collaborators: Collaborator[];
}

export async function loadFullWellness(caseId: number): Promise<FullWellnessLoad> {
  const [healthRoster, upcomingAppointments, financialSummaries, meetingNotes, recentWellnessChecks, collaborators] = await Promise.all([
    listHealthRoster(caseId),
    listAppointments(caseId, false),
    listFinancialSummaries(caseId),
    listMeetingNotes(caseId),
    listWellnessChecks(caseId, 25),
    listCollaborators(caseId)
  ]);
  return { healthRoster, upcomingAppointments, financialSummaries, meetingNotes, recentWellnessChecks, collaborators };
}
