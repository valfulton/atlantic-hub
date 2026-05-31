/**
 * lib/client/lead_detail.ts
 *
 * One client-owned lead, in full, for the client portal's lead-DETAIL page
 * (/client/leads/[audit_id]). Scoped strictly to the client's account the same
 * way lib/client/leads.ts is: we match audit_id AND client_id = ? exactly, never
 * client_id IS NULL (the operator's own pipeline). A lead the client does not own
 * returns null -> the page 404s.
 *
 * CLIENT-SAFE BY DESIGN (what we deliberately DO and DON'T expose):
 *   - DO: company/contact, the audit (their seller-lens call brief), the Living
 *     Score + band + breakdown, the "what to say on the call" script.
 *   - DON'T: the AI model/version or any "scored by GPT" mechanism (clients see
 *     the result, not the machinery — see feedback_ai_verbiage), lead sourcing
 *     internals, or the self-reported intake "challenge" (empty for client-found
 *     prospects; the operator-only Challenge tab is omitted on the client side).
 *
 * Read-only. Called from a client portal server component that middleware has
 * already authenticated as a client_user.
 */
import { getAvDb } from '@/lib/db/av';
import { linkedLinesForLead } from '@/lib/campaigns/lines_for_lead';
import type { RowDataPacket } from 'mysql2';

export type LeadBand = 'hot' | 'warm' | 'cool' | null;

export interface ClientScoreBreakdown {
  fit: number | null;
  intent: number | null;
  reachability: number | null;
  icp_match: number | null;
}

export interface ClientCallScript {
  primaryPain: string | null;
  urgency: string | null;
  openers: string[];
  avoid: string[];
}

export interface ClientOutreachMessage {
  id: number;
  subject: string | null;
  status: string | null;
  sentAt: string | null;
  repliedAt: string | null;
}

/**
 * (#253) "About this prospect" — distilled view of the smart-scraped intake
 * draft that lives in source_payload.lead_intake_draft. This is the layer
 * that turns a lead's row into actual prospect research a rep can read
 * before a call. Every field is OPTIONAL; an empty object means we have no
 * smart-scrape draft for this lead yet (Smart enrich button hasn't been
 * pressed, or the page-read failed).
 *
 * Only the fields a salesperson actually USES are surfaced. The full draft
 * has 12+ keys; some of them (brand_colors, preferred_channels, etc.) are
 * about the prospect's own marketing strategy — irrelevant to someone
 * selling TO them. We hide those here intentionally.
 */
export interface ProspectIntel {
  /** Plain-language "what they actually do" — the rep's opener anchor. */
  businessDescription: string | null;
  /** Their tagline — sometimes paraphrases nicely into a warm-call line. */
  slogan: string | null;
  /** How they position themselves to their own customers. */
  keyMessage: string | null;
  /** Who they sell to — helps the rep talk to peers, not generically. */
  targetAudience: string | null;
  /** What they emphasize as their angle — usually the right hook. */
  differentiators: string | null;
  /** Names they drop — credibility bridge if the rep recognizes any. */
  notableClients: string | null;
  /** Press / awards / certifications — proof points the rep can mirror back. */
  pressAwards: string | null;
  /** Founder story — warm-call angle, personal connection. */
  founderStory: string | null;
  /** Brand voice the prospect uses — rep matches tone in outreach. */
  brandVoice: string | null;
}

/** (#46 Inc 5) Client-safe read-only view of a narrative line this lead is
 *  linked to. Includes outcomes so the client sees track record but never the
 *  operator-side machinery (no candidates, no overlap math, no link buttons). */
export interface ClientLeadNarrativeLine {
  lineId: number;
  name: string;
  thesis: string | null;
  role: 'advances' | 'reinforces' | 'tests';
  outcomes: {
    leadsLinked: number;
    contacted: number;
    qualified: number;
    converted: number;
    lost: number;
    postsPublished: number;
  };
}

export interface ClientLeadDetail {
  id: number;
  auditId: string | null;
  company: string;
  industry: string | null;
  contactName: string | null;
  contactTitle: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  /** Data-quality flag on the website (#180/#195). */
  websiteStatus: 'unknown' | 'valid' | 'placeholder' | 'dead';
  /** Address fields backfilled from source_payload + future enrichment. */
  addressStreet: string | null;
  addressCity: string | null;
  addressState: string | null;
  addressPostal: string | null;
  addressCountry: string | null;
  leadStatus: string;
  /** Visible Living Score: combined when present, else fit-only. */
  score: number | null;
  band: LeadBand;
  /** The engagement half of the Living Score (how the lead is warming). */
  engagementScore: number | null;
  /** Sub-scores for the breakdown chart. No model/version is ever included. */
  breakdown: ClientScoreBreakdown | null;
  /** Plain-language reason for the score (no mechanism/jargon). */
  scoreReason: string | null;
  auditContent: string | null;
  auditGenerated: string | null;
  painSummary: string | null;
  callScript: ClientCallScript | null;
  submittedAt: string | null;
  /** Read-only history of outreach messages sent for this lead. */
  outreach: ClientOutreachMessage[];
  /**
   * (#253) Smart-scraped prospect intel — what the LLM read off the prospect's
   * own website. ALL fields null/empty when no Smart enrich has run yet. The
   * client surface renders the panel only when at least one field is populated.
   */
  prospectIntel: ProspectIntel | null;
  /** (#46 Inc 5) Narrative lines this lead is linked to (read-only mirror of
   *  the operator panel). Empty array = panel hides — no day-one weight. */
  narrativeLines: ClientLeadNarrativeLine[];
}

interface DetailRow extends RowDataPacket {
  id: number;
  audit_id: string | null;
  company: string | null;
  industry: string | null;
  contact_name: string | null;
  contact_title: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  website_status: 'unknown' | 'valid' | 'placeholder' | 'dead' | null;
  address_street: string | null;
  address_city: string | null;
  address_state: string | null;
  address_postal: string | null;
  address_country: string | null;
  lead_status: string | null;
  ai_score: number | null;
  ai_combined_score: number | null;
  ai_engagement_score: number | null;
  ai_score_band: LeadBand;
  ai_score_reason: string | null;
  ai_score_breakdown: string | object | null;
  audit_content: string | null;
  audit_generated: string | Date | null;
  pain_point_profile: string | object | null;
  submission_date: string | Date | null;
  /** (#253) Source provenance + the smart-scrape intake stash. */
  source_payload: string | object | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Hide the apollo/clay/no-email placeholders the discovery providers mint. */
function realEmail(e: string | null): string | null {
  if (!e || !e.trim()) return null;
  const v = e.trim();
  if (/^(prospect|apollo|noemail)\+/i.test(v)) return null;
  if (/^info@eventsbywater\.com$/i.test(v)) return null;
  return v;
}

function asObj(raw: string | object | null): Record<string, unknown> | null {
  if (raw == null) return null;
  try {
    const o = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return o && typeof o === 'object' ? (o as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function numOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function breakdownOf(raw: string | object | null): ClientScoreBreakdown | null {
  const o = asObj(raw);
  if (!o) return null;
  const b: ClientScoreBreakdown = {
    fit: numOrNull(o.fit),
    intent: numOrNull(o.intent),
    reachability: numOrNull(o.reachability),
    icp_match: numOrNull(o.icp_match)
  };
  if (b.fit == null && b.intent == null && b.reachability == null && b.icp_match == null) return null;
  return b;
}

function painSummaryOf(raw: string | object | null): string | null {
  const o = asObj(raw);
  if (!o) return null;
  const s = o.summary ?? o.headline ?? o.primary_pain ?? o.primary;
  if (typeof s === 'string' && s.trim()) return s.trim();
  return null;
}

function callScriptOf(raw: string | object | null): ClientCallScript | null {
  const o = asObj(raw);
  if (!o) return null;
  const strArr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0) : [];
  const openers = strArr(o.conversation_starters ?? o.openers);
  const avoid = strArr(o.do_not_say ?? o.avoid);
  const primaryPain = typeof o.primary_pain === 'string' && o.primary_pain.trim() ? o.primary_pain.trim() : null;
  const urgency = typeof o.urgency_signal === 'string' && o.urgency_signal.trim() ? o.urgency_signal.trim() : null;
  if (!openers.length && !avoid.length && !primaryPain) return null;
  return { primaryPain, urgency, openers, avoid };
}

/**
 * (#253) Pull the smart-scraped intake stash out of source_payload and
 * project it down to the salesperson-relevant fields. Returns null when the
 * draft is absent or empty — the UI panel skips render in that case.
 *
 * Field selection notes:
 *   - business_description, slogan, key_message, target_audience,
 *     differentiators, notable_clients, press_awards, founder_story,
 *     brand_voice ARE included — these are research the rep would normally
 *     do manually before a call.
 *   - brand_colors, preferred_channels, brand_kit, etc are INTENTIONALLY
 *     excluded — they're about the prospect's own marketing strategy and
 *     irrelevant to a salesperson selling TO them. Keeping the panel lean
 *     beats showing every available field.
 *   - "[ask]" sentinels from the intake filler are filtered out so the UI
 *     never renders the model's "I couldn't infer this" marker.
 */
export function prospectIntelFrom(raw: string | object | null): ProspectIntel | null {
  const sp = asObj(raw);
  if (!sp) return null;
  const draftBlob = sp['lead_intake_draft'];
  if (!draftBlob || typeof draftBlob !== 'object' || Array.isArray(draftBlob)) return null;
  const draft = draftBlob as Record<string, unknown>;
  const pick = (k: string): string | null => {
    const v = draft[k];
    if (typeof v !== 'string') return null;
    const t = v.trim();
    if (!t || /^\[ask\]?/i.test(t)) return null;
    return t;
  };
  const intel: ProspectIntel = {
    businessDescription: pick('business_description'),
    slogan: pick('slogan'),
    keyMessage: pick('key_message'),
    targetAudience: pick('target_audience'),
    differentiators: pick('differentiators'),
    notableClients: pick('notable_clients'),
    pressAwards: pick('press_awards'),
    founderStory: pick('founder_story'),
    brandVoice: pick('brand_voice')
  };
  // If every field came back null, no point returning an empty shell — the
  // UI uses `=== null` as its "skip render" signal.
  if (Object.values(intel).every((v) => v === null)) return null;
  return intel;
}

/**
 * (#291) Fallback address extractor for leads whose dedicated address_* columns
 * are still empty. The columns get populated by #224 (Apollo backfill) and the
 * Google Places enricher, but a lot of older leads were imported before that
 * landed and still have all their location info living inside source_payload.
 *
 * Sources we know about (priority order):
 *   1. source_payload.google_places.formatted_address (most precise — Places
 *      returns "123 Main St, Newport Beach, CA 92660, USA")
 *   2. source_payload.apollo_location ("Newport Beach, California, US")
 *   3. source_payload.lead_intake_draft.location / .city / .state
 *
 * Returns a shape that matches the column-extracted version so callers can
 * fall back transparently. Returns nulls when nothing is found — never throws.
 */
export interface FallbackAddress {
  street: string | null;
  city: string | null;
  state: string | null;
  postal: string | null;
  country: string | null;
}
function pickStr(o: Record<string, unknown>, k: string): string | null {
  const v = o[k];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}
export function addressFromSourcePayload(raw: string | object | null): FallbackAddress {
  const empty: FallbackAddress = { street: null, city: null, state: null, postal: null, country: null };
  const sp = asObj(raw);
  if (!sp) return empty;

  // 1. Google Places — most precise.
  const gp = sp['google_places'];
  if (gp && typeof gp === 'object' && !Array.isArray(gp)) {
    const fa = (gp as Record<string, unknown>)['formatted_address'];
    if (typeof fa === 'string' && fa.trim()) {
      // We don't try to split — the formatted_address is human-readable on
      // its own. Cram it into `street` so the existing UI renders it as the
      // first line. If a more structured split is needed later we can parse
      // the address_components array Google returns alongside.
      return { ...empty, street: fa.trim() };
    }
  }

  // 2. Apollo location ("City, State, Country" comma-separated).
  const apolloLoc = sp['apollo_location'];
  if (typeof apolloLoc === 'string' && apolloLoc.trim()) {
    const parts = apolloLoc.split(',').map((s) => s.trim()).filter(Boolean);
    return {
      street: null,
      city: parts[0] || null,
      state: parts[1] || null,
      postal: null,
      country: parts[2] || null
    };
  }

  // 3. Smart-scrape intake draft — has a free-text `location` field
  //    (and sometimes `headquarters` / `city` / `state`).
  const draftBlob = sp['lead_intake_draft'];
  if (draftBlob && typeof draftBlob === 'object' && !Array.isArray(draftBlob)) {
    const d = draftBlob as Record<string, unknown>;
    const loc = pickStr(d, 'location') || pickStr(d, 'headquarters') || pickStr(d, 'address');
    if (loc) return { ...empty, street: loc };
    const city = pickStr(d, 'city');
    const state = pickStr(d, 'state');
    if (city || state) return { ...empty, city, state };
  }

  return empty;
}

function toIso(v: string | Date | null): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString();
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * One lead the client owns, by audit_id. Returns null if the audit_id is invalid,
 * the lead doesn't exist, is archived, or is NOT owned by this client_id.
 */
export async function getClientLeadDetail(
  clientId: number | null,
  auditId: string
): Promise<ClientLeadDetail | null> {
  const cid = Number(clientId);
  if (!Number.isInteger(cid) || cid <= 0) return null;
  if (!auditId || !UUID_RE.test(auditId)) return null;

  const db = getAvDb();
  const [rows] = await db.execute<DetailRow[]>(
    `SELECT id, audit_id, company, industry, contact_name, contact_title, email, phone, website,
            website_status,
            address_street, address_city, address_state, address_postal, address_country,
            lead_status, ai_score, ai_combined_score, ai_engagement_score, ai_score_band,
            ai_score_reason, ai_score_breakdown, audit_content, audit_generated,
            pain_point_profile, submission_date, source_payload
       FROM leads
      WHERE archived_at IS NULL
        AND audit_id = ?
        AND client_id = ?
      LIMIT 1`,
    [auditId, cid]
  );
  const r = rows[0];
  if (!r) return null;

  // Read-only outreach history for this lead (what's been sent + replies).
  let outreach: ClientOutreachMessage[] = [];
  try {
    const [orows] = await db.execute<(RowDataPacket & {
      id: number; subject: string | null; status: string | null;
      sent_at: string | Date | null; replied_at: string | Date | null;
    })[]>(
      `SELECT id, subject, status, sent_at, replied_at
         FROM outreach_messages
        WHERE lead_id = ?
        ORDER BY created_at DESC
        LIMIT 50`,
      [r.id]
    );
    outreach = orows.map((o) => ({
      id: o.id,
      subject: o.subject && o.subject.trim() ? o.subject : null,
      status: o.status && o.status.trim() ? o.status : null,
      sentAt: toIso(o.sent_at),
      repliedAt: toIso(o.replied_at)
    }));
  } catch {
    outreach = [];
  }

  // (#46 Inc 5) Linked narrative lines for the client mirror — read-only,
  // no candidates, no machinery. Never throws; empty array hides the panel.
  const narrativeLines = await linkedLinesForLead(r.id);

  return {
    id: r.id,
    auditId: r.audit_id,
    company: r.company || 'Untitled lead',
    industry: r.industry,
    contactName: r.contact_name && !r.contact_name.trim().startsWith('(') ? r.contact_name : null,
    contactTitle: r.contact_title && r.contact_title.trim() ? r.contact_title : null,
    email: realEmail(r.email),
    phone: r.phone && r.phone.trim() ? r.phone : null,
    website: r.website && r.website.trim() ? r.website : null,
    websiteStatus: r.website_status ?? 'unknown',
    // (#291) Columns first; fall back to source_payload for legacy leads
    // whose Google Places / Apollo / smart-scrape data never got backfilled
    // into the dedicated columns. Address was rendering as a hidden Field
    // because all five columns came back NULL on older client leads.
    ...((): {
      addressStreet: string | null; addressCity: string | null;
      addressState: string | null; addressPostal: string | null;
      addressCountry: string | null;
    } => {
      const street = r.address_street && r.address_street.trim() ? r.address_street : null;
      const city = r.address_city && r.address_city.trim() ? r.address_city : null;
      const state = r.address_state && r.address_state.trim() ? r.address_state : null;
      const postal = r.address_postal && r.address_postal.trim() ? r.address_postal : null;
      const country = r.address_country && r.address_country.trim() ? r.address_country : null;
      if (street || city || state || postal || country) {
        return { addressStreet: street, addressCity: city, addressState: state, addressPostal: postal, addressCountry: country };
      }
      const fb = addressFromSourcePayload(r.source_payload);
      return {
        addressStreet: fb.street,
        addressCity: fb.city,
        addressState: fb.state,
        addressPostal: fb.postal,
        addressCountry: fb.country
      };
    })(),
    leadStatus: r.lead_status || 'new',
    score:
      r.ai_combined_score !== null
        ? Number(r.ai_combined_score)
        : r.ai_score !== null
          ? Number(r.ai_score)
          : null,
    band: r.ai_score_band,
    engagementScore: r.ai_engagement_score == null ? null : Number(r.ai_engagement_score),
    breakdown: breakdownOf(r.ai_score_breakdown),
    scoreReason: r.ai_score_reason && r.ai_score_reason.trim() ? r.ai_score_reason.trim() : null,
    auditContent: r.audit_content,
    auditGenerated: toIso(r.audit_generated),
    painSummary: painSummaryOf(r.pain_point_profile),
    callScript: callScriptOf(r.pain_point_profile),
    submittedAt: toIso(r.submission_date),
    outreach,
    prospectIntel: prospectIntelFrom(r.source_payload),
    narrativeLines
  };
}
