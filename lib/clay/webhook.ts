/**
 * lib/clay/webhook.ts
 *
 * Helpers for the Clay enrichment webhook receiver.
 *
 *   verifyClaySecret(req)   - constant-time check of the X-Webhook-Secret
 *                             header against process.env.CLAY_WEBHOOK_SECRET.
 *                             Returns boolean; never throws.
 *
 *   parseClayPayload(body)  - fuzzy field extraction. Clay column names are
 *                             user-defined, so we accept many aliases and
 *                             return a normalized ClayPayload regardless.
 *
 * Auth model: shared secret in a custom header. Security-equivalent to HMAC
 * given HTTPS for v1, and avoids the HMAC complexity. Upgrade path: bolt on
 * an X-Clay-Signature HMAC verifier alongside verifyClaySecret if Clay ever
 * needs replay protection.
 */
import { timingSafeEqual } from 'crypto';
import type { NextRequest } from 'next/server';

export interface ClayPayload {
  /** Best-effort row identifier. May come from Clay's "row_id", a Clay column,
   *  or be absent. Used for the audit log only. */
  clayRowId: string | null;
  /** Clay table ID if the operator wires it in (recommended via custom column
   *  or a header). Used for rate limiting and audit log filtering. */
  clayTableId: string | null;
  /** The fields we map onto the leads table. All optional; the receiver
   *  rejects payloads with none of the structurally useful fields below. */
  company: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  linkedinUrl: string | null;
  contactName: string | null;
  contactTitle: string | null;
  industry: string | null;
  location: string | null;
  /** Anything extra Clay sent that we did not map. Persisted verbatim on the
   *  lead's source_payload + the audit log row. */
  extra: Record<string, unknown>;
}

/**
 * Constant-time check of the X-Webhook-Secret header. Returns false (never
 * throws) when:
 *   - CLAY_WEBHOOK_SECRET is unset (treat as "receiver disabled")
 *   - header is missing or empty
 *   - byte length differs
 *   - bytes differ
 */
export function verifyClaySecret(req: NextRequest): boolean {
  const expected = process.env.CLAY_WEBHOOK_SECRET;
  if (!expected) return false;

  const provided = req.headers.get('x-webhook-secret');
  if (!provided) return false;

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Fuzzy lookup: returns the first non-empty string value among the provided
 * keys, matching case-insensitively and tolerating spaces / underscores /
 * hyphens. Returns null if no key produces a usable value.
 */
function pickString(
  src: Record<string, unknown>,
  keys: string[],
  maxLen: number
): string | null {
  // Build a normalized index of the source keys once per call so the per-key
  // lookups are cheap.
  const norm = new Map<string, string>();
  for (const rawKey of Object.keys(src)) {
    norm.set(normalizeKey(rawKey), rawKey);
  }
  for (const k of keys) {
    const realKey = norm.get(normalizeKey(k));
    if (!realKey) continue;
    const v = src[realKey];
    if (typeof v === 'string') {
      const t = v.trim();
      if (t.length > 0) return t.slice(0, maxLen);
    } else if (typeof v === 'number' && Number.isFinite(v)) {
      return String(v).slice(0, maxLen);
    }
  }
  return null;
}

function normalizeKey(k: string): string {
  return k.toLowerCase().replace(/[\s\-_.]+/g, '');
}

/**
 * Extract the fields we map onto the leads table from a Clay row payload.
 * Clay column names are user-defined, so accept many aliases. Returns a
 * normalized ClayPayload; the caller (ingestClayRow) decides whether the
 * payload has enough fields to be useful.
 */
export function parseClayPayload(body: unknown): ClayPayload {
  // Clay can wrap the row payload in various envelopes. Probe the common ones.
  const root = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const candidate =
    pickObject(root, 'data') ??
    pickObject(root, 'row') ??
    pickObject(root, 'payload') ??
    root;

  const flat = candidate as Record<string, unknown>;

  const company = pickString(flat, [
    'company', 'company_name', 'business', 'business_name', 'account_name', 'organization', 'org', 'name'
  ], 255);

  const email = pickString(flat, [
    'email', 'email_address', 'work_email', 'business_email', 'primary_email', 'contact_email'
  ], 255);

  const phone = pickString(flat, [
    'phone', 'phone_number', 'mobile', 'mobile_number', 'work_phone', 'business_phone', 'primary_phone'
  ], 40);

  const website = pickString(flat, [
    'website', 'website_url', 'domain', 'url', 'homepage', 'company_website', 'company_url'
  ], 500);

  const linkedinUrl = pickString(flat, [
    'linkedin', 'linkedin_url', 'linkedin_profile', 'linkedin_company_url', 'li_url', 'linkedinurl'
  ], 500);

  const contactName = pickString(flat, [
    'contact_name', 'full_name', 'name', 'person_name', 'lead_name', 'first_last'
  ], 255);

  const contactTitle = pickString(flat, [
    'contact_title', 'title', 'job_title', 'position', 'role', 'seniority_role'
  ], 255);

  const industry = pickString(flat, [
    'industry', 'category', 'vertical', 'business_category', 'sub_industry'
  ], 120);

  const location = pickString(flat, [
    'location', 'city', 'address', 'region', 'state', 'country', 'city_state'
  ], 255);

  const clayRowId = pickString(flat, [
    'row_id', 'rowid', 'clay_row_id', 'clay_id', 'id'
  ], 128) ?? pickString(root, ['row_id', 'rowid', 'clay_row_id', 'clay_id', 'id'], 128);

  const clayTableId = pickString(flat, [
    'table_id', 'tableid', 'clay_table_id', 'workspace_table_id'
  ], 128) ?? pickString(root, ['table_id', 'tableid', 'clay_table_id', 'workspace_table_id'], 128);

  // Build extra (everything in the flat candidate that we did NOT consume).
  // Truncated to keep the row size reasonable. The full body is also written
  // to the audit-log payload column.
  const consumedKeys = new Set([
    ...candidateKeysFor('company', 'company_name', 'business', 'business_name', 'account_name', 'organization', 'org', 'name'),
    ...candidateKeysFor('email', 'email_address', 'work_email', 'business_email', 'primary_email', 'contact_email'),
    ...candidateKeysFor('phone', 'phone_number', 'mobile', 'mobile_number', 'work_phone', 'business_phone', 'primary_phone'),
    ...candidateKeysFor('website', 'website_url', 'domain', 'url', 'homepage', 'company_website', 'company_url'),
    ...candidateKeysFor('linkedin', 'linkedin_url', 'linkedin_profile', 'linkedin_company_url', 'li_url', 'linkedinurl'),
    ...candidateKeysFor('contact_name', 'full_name', 'name', 'person_name', 'lead_name', 'first_last'),
    ...candidateKeysFor('contact_title', 'title', 'job_title', 'position', 'role', 'seniority_role'),
    ...candidateKeysFor('industry', 'category', 'vertical', 'business_category', 'sub_industry'),
    ...candidateKeysFor('location', 'city', 'address', 'region', 'state', 'country', 'city_state'),
    ...candidateKeysFor('row_id', 'rowid', 'clay_row_id', 'clay_id', 'id'),
    ...candidateKeysFor('table_id', 'tableid', 'clay_table_id', 'workspace_table_id')
  ]);
  const extra: Record<string, unknown> = {};
  let extraCount = 0;
  for (const [rawKey, val] of Object.entries(flat)) {
    if (consumedKeys.has(normalizeKey(rawKey))) continue;
    if (val === null || val === undefined) continue;
    extra[rawKey] = val;
    extraCount += 1;
    if (extraCount >= 50) break;
  }

  return {
    clayRowId,
    clayTableId,
    company,
    email,
    phone,
    website,
    linkedinUrl,
    contactName,
    contactTitle,
    industry,
    location,
    extra
  };
}

function pickObject(src: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const v = src[key];
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

function candidateKeysFor(...keys: string[]): string[] {
  return keys.map(normalizeKey);
}

/**
 * True when the payload has at least one structurally useful field for a lead
 * insert. company + (email | phone | website | linkedinUrl) is the floor.
 */
export function payloadIsUseful(p: ClayPayload): boolean {
  if (!p.company) {
    // Allow standalone contact rows (e.g. Clay enriched a name + email) but
    // only if we have an email or LinkedIn to anchor on -- otherwise it is
    // unusable noise.
    return Boolean(p.email || p.linkedinUrl);
  }
  return Boolean(p.email || p.phone || p.website || p.linkedinUrl);
}
