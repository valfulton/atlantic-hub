/**
 * lib/clay/discoverer.ts
 *
 * Clay rows -> shhdbite_AV.leads.
 *
 * For each parsed Clay payload:
 *   1. Run cross-source dedup via findExistingLead (normalized_domain first,
 *      phone as a weaker fallback).
 *   2. If a matching lead exists: UPDATE missing-only fields. We never
 *      overwrite a non-null email / phone / contact_name with Clay data --
 *      Clay is treated as fill-the-blanks, not as the source of truth.
 *   3. If no match: INSERT a new lead with source_type='api',
 *      target_business inferred from industry, and fire the background
 *      score+audit if the auto-scoring helper is wired.
 *   4. Always write one row to clay_enrichment_log with the outcome and the
 *      original payload (forensics + the status page).
 *   5. Fire logEvent('lead.enriched_clay' | 'lead.created') so the unified
 *      events stream sees it.
 *
 * NEVER throws to the caller. Returns an IngestOutcome so the route handler
 * can pick the HTTP status.
 */
import { randomUUID } from 'crypto';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { getAvDb } from '@/lib/db/av';
import { findExistingLead, normalizeDomain } from '@/lib/leads/dedup';
import { inferTargetBusinessFromRaw } from '@/lib/leads/target_business';
import { logEvent } from '@/lib/events/log';
import { scoreAndAuditLeadBackground } from '@/lib/ai/score_and_audit';
import type { ClayPayload } from '@/lib/clay/webhook';

export type ClayOutcome = 'inserted' | 'updated' | 'duplicate' | 'invalid' | 'error';

export interface ClayIngestResult {
  outcome: ClayOutcome;
  leadId: number | null;
  error?: string;
  /** Field names that were filled in on an existing lead. Empty for inserts. */
  fieldsFilled?: string[];
}

interface LeadFieldsRow extends RowDataPacket {
  id: number;
  company: string | null;
  contact_name: string | null;
  contact_title: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  linkedin_url: string | null;
  industry: string | null;
  location: string | null;
  normalized_domain: string | null;
}

/**
 * Heuristic: emails inserted by another discovery source as placeholders are
 * NOT real emails and may be overwritten by Clay. Apollo writes
 * 'apollo+person-...@eventsbywater.com', the Hunter-enriched rows always have
 * a real domain. Be conservative: treat anything matching the placeholder
 * patterns as null for "should we fill?" purposes.
 */
function isPlaceholderEmail(email: string | null): boolean {
  if (!email) return true;
  const lower = email.toLowerCase();
  return (
    lower.startsWith('apollo+') ||
    lower.startsWith('places+') ||
    lower.startsWith('instagram+') ||
    lower.startsWith('scrape+') ||
    lower.startsWith('prospect+') ||
    lower.endsWith('@eventsbywater.com.placeholder')
  );
}

/**
 * Write one row to clay_enrichment_log. Errors are swallowed -- the audit log
 * must never break the receiver.
 */
async function logClayRow(args: {
  outcome: ClayOutcome;
  leadId: number | null;
  payload: ClayPayload;
  errorMessage?: string;
  rawBody: unknown;
}): Promise<void> {
  try {
    const db = getAvDb();
    const persisted = {
      parsed: {
        company: args.payload.company,
        email: args.payload.email,
        phone: args.payload.phone,
        website: args.payload.website,
        linkedin_url: args.payload.linkedinUrl,
        contact_name: args.payload.contactName,
        contact_title: args.payload.contactTitle,
        industry: args.payload.industry,
        location: args.payload.location,
        extra: args.payload.extra
      },
      raw: args.rawBody
    };
    await db.execute<ResultSetHeader>(
      `INSERT INTO clay_enrichment_log
         (clay_table_id, clay_row_id, lead_id, outcome, payload, error_message)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        args.payload.clayTableId,
        args.payload.clayRowId,
        args.leadId,
        args.outcome,
        JSON.stringify(persisted),
        args.errorMessage ? args.errorMessage.slice(0, 500) : null
      ]
    );
  } catch (err) {
    console.error('[clay:log]', (err as Error).message);
  }
}

/**
 * Main entry point. Called by the POST route after secret + payload checks.
 * Always logs and returns; never throws.
 */
export async function ingestClayRow(
  payload: ClayPayload,
  rawBody: unknown
): Promise<ClayIngestResult> {
  const db = getAvDb();

  // Resolve a usable domain key. Prefer explicit website, fall back to a
  // domain pulled from the email if the website is missing. Clay frequently
  // sends a fully-qualified email and an empty website cell.
  const domainSource =
    payload.website ??
    (payload.email && payload.email.includes('@') ? payload.email.split('@')[1] : null);
  const normDomain = normalizeDomain(domainSource);
  const targetBusiness = inferTargetBusinessFromRaw(payload.industry ?? payload.company);

  // Re-send dedup token. Clay can POST the same row more than once (manual
  // re-run, table reprocess). Its token lives in the unique apollo_person_id
  // column as clay:<row_id>, so a repeat is caught even when the row carries
  // no domain and no phone to dedup on. Null when Clay sends no row id.
  const clayToken = payload.clayRowId ? `clay:${payload.clayRowId}` : null;

  try {
    if (clayToken) {
      const [tokenRows] = await db.execute<(RowDataPacket & { id: number })[]>(
        `SELECT id FROM leads WHERE apollo_person_id = ? LIMIT 1`,
        [clayToken]
      );
      if (tokenRows.length > 0) {
        const result = await fillExistingLead(tokenRows[0].id, payload);
        await logClayRow({ outcome: result.outcome, leadId: tokenRows[0].id, payload, rawBody });
        await logEvent({
          eventType: 'lead.enriched_clay',
          leadId: tokenRows[0].id,
          source: 'clay',
          status: 'success',
          payload: {
            matched_on: 'clay_token',
            fields_filled: result.fieldsFilled ?? [],
            clay_table_id: payload.clayTableId,
            clay_row_id: payload.clayRowId
          }
        });
        return result;
      }
    }

    const existing = await findExistingLead(db, {
      domain: domainSource,
      phone: payload.phone,
      mode: 'loose'
    });

    if (existing) {
      const result = await fillExistingLead(existing.leadId, payload);
      await logClayRow({
        outcome: result.outcome,
        leadId: existing.leadId,
        payload,
        rawBody
      });
      await logEvent({
        eventType: 'lead.enriched_clay',
        leadId: existing.leadId,
        source: 'clay',
        status: 'success',
        payload: {
          matched_on: existing.matchedOn,
          fields_filled: result.fieldsFilled ?? [],
          clay_table_id: payload.clayTableId,
          clay_row_id: payload.clayRowId
        }
      });
      return result;
    }

    // No existing lead -> insert.
    const auditId = randomUUID();
    const sourcePayload = {
      source: 'clay.webhook',
      clay_table_id: payload.clayTableId,
      clay_row_id: payload.clayRowId,
      industry_raw: payload.industry,
      location: payload.location,
      extra: payload.extra
    };

    const company = payload.company ?? deriveCompanyFromDomain(normDomain) ?? 'Unknown company';
    const placeholderEmail = payload.email ?? `clay+${payload.clayRowId ?? auditId}@eventsbywater.com.placeholder`;
    const website = payload.website ?? (normDomain ? `https://${normDomain}` : null);

    const [insertResult] = await db.execute<ResultSetHeader>(
      `INSERT INTO leads (
         audit_id, company, contact_name, contact_title, email, phone, website,
         linkedin_url, industry, location, lead_status, source_type, target_business,
         source_payload, apollo_person_id, last_activity_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', 'api', ?, ?, ?, NOW())`,
      [
        auditId,
        company,
        payload.contactName,
        payload.contactTitle,
        placeholderEmail,
        payload.phone,
        website,
        payload.linkedinUrl,
        payload.industry,
        payload.location,
        targetBusiness,
        JSON.stringify(sourcePayload),
        clayToken
      ]
    );

    const newLeadId = insertResult.insertId;

    await logClayRow({
      outcome: 'inserted',
      leadId: newLeadId,
      payload,
      rawBody
    });

    await logEvent({
      eventType: 'lead.created',
      leadId: newLeadId,
      source: 'clay',
      status: 'success',
      payload: {
        sub_source: 'clay_webhook',
        company,
        domain: normDomain,
        industry: payload.industry,
        target_business: targetBusiness,
        clay_table_id: payload.clayTableId,
        clay_row_id: payload.clayRowId
      }
    });

    // Fire background score + audit. The helper itself is fire-and-forget,
    // never throws, and tolerates missing OpenAI key (logs + skips).
    scoreAndAuditLeadBackground(newLeadId);

    return { outcome: 'inserted', leadId: newLeadId };
  } catch (err) {
    const message = (err as Error).message.slice(0, 500);
    await logClayRow({
      outcome: 'error',
      leadId: null,
      payload,
      rawBody,
      errorMessage: message
    });
    await logEvent({
      eventType: 'workflow.failed',
      source: 'clay',
      status: 'failure',
      payload: {
        stage: 'ingestClayRow',
        clay_table_id: payload.clayTableId,
        clay_row_id: payload.clayRowId
      },
      errorMessage: message
    });
    return { outcome: 'error', leadId: null, error: message };
  }
}

/**
 * Merge Clay data into an existing lead. Only fills NULL or placeholder
 * fields -- never overwrites real data. Returns 'updated' if at least one
 * field was filled, 'duplicate' if every Clay field was already populated.
 */
async function fillExistingLead(
  leadId: number,
  payload: ClayPayload
): Promise<ClayIngestResult> {
  const db = getAvDb();
  const [rows] = await db.execute<LeadFieldsRow[]>(
    `SELECT id, company, contact_name, contact_title, email, phone, website,
            linkedin_url, industry, location, normalized_domain
       FROM leads
      WHERE id = ?
      LIMIT 1`,
    [leadId]
  );
  if (rows.length === 0) {
    return { outcome: 'duplicate', leadId };
  }
  const lead = rows[0];

  const sets: string[] = [];
  const setParams: (string | null)[] = [];
  const filled: string[] = [];

  function fillIfMissing(
    column: string,
    currentValue: string | null,
    candidate: string | null,
    treatPlaceholderAsMissing = false
  ): void {
    if (!candidate) return;
    const isMissing =
      currentValue === null ||
      currentValue === undefined ||
      currentValue === '' ||
      (treatPlaceholderAsMissing && isPlaceholderEmail(currentValue));
    if (!isMissing) return;
    sets.push(`${column} = ?`);
    setParams.push(candidate);
    filled.push(column);
  }

  fillIfMissing('company',       lead.company,       payload.company);
  fillIfMissing('contact_name',  lead.contact_name,  payload.contactName);
  fillIfMissing('contact_title', lead.contact_title, payload.contactTitle);
  fillIfMissing('email',         lead.email,         payload.email, true);
  fillIfMissing('phone',         lead.phone,         payload.phone);
  fillIfMissing('website',       lead.website,       payload.website);
  fillIfMissing('linkedin_url',  lead.linkedin_url,  payload.linkedinUrl);
  fillIfMissing('industry',      lead.industry,      payload.industry);
  fillIfMissing('location',      lead.location,      payload.location);

  if (sets.length === 0) {
    return { outcome: 'duplicate', leadId, fieldsFilled: [] };
  }

  sets.push('last_activity_at = NOW()');

  const sql = `UPDATE leads SET ${sets.join(', ')} WHERE id = ?`;
  const bindings: (string | number | null)[] = [...setParams, leadId];
  await db.execute<ResultSetHeader>(sql, bindings);

  return { outcome: 'updated', leadId, fieldsFilled: filled };
}

function deriveCompanyFromDomain(normDomain: string | null): string | null {
  if (!normDomain) return null;
  // e.g. atlanticandvine.com -> "Atlanticandvine". Better than "Unknown
  // company" but the operator will likely rename. Used only when Clay sends
  // a row with an email but no company name.
  const root = normDomain.split('.')[0];
  if (!root) return null;
  return root.charAt(0).toUpperCase() + root.slice(1);
}
