/**
 * POST /api/admin/av/clients/create
 *
 * Operator creates a client account in one shot: account + magic link + hub +
 * tier/trial + a seeded candidate narrative line. Owner + staff only.
 *
 * Body: { email*, name?, company?, industry?, tier?, trialDays?, sendInvite?,
 *         key_message?, target_audience?, differentiators?, proof_points?, ... }
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { createClientFromOperator } from '@/lib/av/create_client';
import type { ClientTier } from '@/lib/client-portal/tiers';
import { getAvDb } from '@/lib/db/av';
// (#272) Use the canonical intake key list — was previously hand-rolled here
// and missing basic identity keys (company, contact_name, phone, company_size,
// business_description, slogan, has_logo, ...) so the smart-scrape draft and
// the lead row's identity columns got filtered out at carryover. The canonical
// list lives in lib/client/intake_fields and includes every intake form key.
import { INTAKE_KEYS as CANONICAL_INTAKE_KEYS } from '@/lib/client/intake_fields';
import type { RowDataPacket } from 'mysql2';

export const runtime = 'nodejs';
export const maxDuration = 30;

const TIERS: ClientTier[] = ['audit_only', 'sprint', 'momentum', 'scale'];
const INTAKE_KEYS = CANONICAL_INTAKE_KEYS;

export async function POST(req: NextRequest) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/av/clients/create:POST', tenantId: 'av' });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const email = typeof body.email === 'string' ? body.email.trim() : '';
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: 'a valid email is required' }, { status: 400 });
  }

  const intake: Record<string, unknown> = {};
  for (const k of INTAKE_KEYS) if (typeof body[k] === 'string' && (body[k] as string).trim()) intake[k] = body[k];

  // (#253) Lead → client carryover. When the operator clicks "Make client"
  // from a lead detail page, MakeClientButton sends the lead's auditId. If
  // that lead has a stashed intake_draft on its source_payload (written by
  // the smart scraper, #251 Inc 1c-prime), merge those fields into the new
  // client's intake — but ONLY for keys the operator didn't explicitly type
  // in the modal. Operator-typed values always win, so the draft is purely
  // additive: it fills the blanks the operator didn't bother typing.
  //
  // This is what turns "Make client" into a real conversion: the brand
  // identity already lives on the lead row from the website scrape, so the
  // new client lands with a populated intake the second they exist — no
  // re-fetching the page, no re-typing, no manual intake task hanging over
  // val's head. The autopilot lifecycle hooks (#240) take it from there.
  let auditIdUsedForDraft: string | null = null;
  let draftFieldsMerged = 0;
  // (#272) Track lead-row-derived fills separately so the UI can show val
  // "Pulled X identity fields from the lead row + Y fields from the smart
  // scrape draft" — different sources, different confidence levels.
  let leadFieldsMerged = 0;
  const auditId = typeof body.auditId === 'string' ? body.auditId.trim() : '';
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(auditId)) {
    try {
      const db = getAvDb();
      // (#272) Read the lead's IDENTITY columns too — the previous version
      // only read source_payload, so any value val typed into the Identity
      // tab (Mark Francis / CEO / phone) never made it into the new client's
      // intake. The intake form's canonical keys (company, contact_name,
      // phone, industry) match the leads-table column names, so this is a
      // direct one-to-one map.
      const [rows] = await db.execute<(RowDataPacket & {
        source_payload: string | object | null;
        company: string | null;
        contact_name: string | null;
        contact_title: string | null;
        phone: string | null;
        email: string | null;
        website: string | null;
        industry: string | null;
        address_street: string | null;
        address_city: string | null;
        address_state: string | null;
        address_postal: string | null;
        address_country: string | null;
      })[]>(
        // (#274) Removed `AND archived_at IS NULL`. The previous version
        // silently failed to read identity from archived leads, which is
        // exactly what happens when val archives a lead in frustration after
        // a failed Make Client and then tries to convert it again. The lead's
        // data (company, contact, scraped intake draft) is still valid for
        // carryover regardless of archive state — archive only means "stop
        // showing in the active pipeline," not "delete." Reading archived
        // rows here is safe; we never write back to the lead.
        `SELECT source_payload, company, contact_name, contact_title, phone, email,
                website, industry, address_street, address_city, address_state,
                address_postal, address_country
           FROM leads WHERE audit_id = ? LIMIT 1`,
        [auditId]
      );
      const leadRow = rows[0];
      const raw = leadRow?.source_payload ?? null;
      const parsed: Record<string, unknown> = typeof raw === 'string'
        ? safeJson(raw)
        : (raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {});
      const draftBlob = parsed['lead_intake_draft'];
      const draft: Record<string, unknown> = draftBlob && typeof draftBlob === 'object' && !Array.isArray(draftBlob)
        ? (draftBlob as Record<string, unknown>)
        : {};

      // Tier 2: smart-scrape draft fills blanks the operator didn't type.
      // Operator-typed values always win.
      for (const k of INTAKE_KEYS) {
        if (k in intake) continue;
        const v = draft[k];
        if (typeof v === 'string' && v.trim() && v.trim() !== '[ask]') {
          intake[k] = v.trim();
          draftFieldsMerged += 1;
        }
      }
      if (draftFieldsMerged > 0) auditIdUsedForDraft = auditId;

      // Tier 3: lead row identity columns fill any remaining blanks. Lowest
      // priority — only writes when neither operator typed nor smart-scrape
      // had a value. Keys mirror the intake form (see lib/client/intake_fields).
      if (leadRow) {
        const leadMap: Array<[string, string | null | undefined]> = [
          ['company',      leadRow.company],
          ['contact_name', leadRow.contact_name],
          ['contact_title', leadRow.contact_title],
          ['phone',        leadRow.phone],
          ['email',        leadRow.email],
          ['website',      leadRow.website],
          ['industry',     leadRow.industry],
          ['address_street',  leadRow.address_street],
          ['address_city',    leadRow.address_city],
          ['address_state',   leadRow.address_state],
          ['address_postal',  leadRow.address_postal],
          ['address_country', leadRow.address_country]
        ];
        for (const [k, v] of leadMap) {
          if (k in intake) continue;
          if (typeof v === 'string' && v.trim()) {
            intake[k] = v.trim();
            leadFieldsMerged += 1;
          }
        }
      }
    } catch {
      // Non-fatal — fall back to whatever the operator typed. A bad lookup
      // never blocks client creation.
    }
  }

  try {
    const result = await createClientFromOperator({
      email,
      name: typeof body.name === 'string' ? body.name : null,
      company: typeof body.company === 'string' ? body.company : null,
      industry: typeof body.industry === 'string' ? body.industry : null,
      tier: typeof body.tier === 'string' && TIERS.includes(body.tier as ClientTier) ? (body.tier as ClientTier) : undefined,
      trialDays: typeof body.trialDays === 'number' ? body.trialDays : null,
      sendInvite: body.sendInvite === true,
      intake
    });
    // (#253) Surface the carryover counts on the response so the UI can
    // show val "Carried over 7 fields from this lead's smart-scrape draft"
    // and she knows the auto-fill happened.
    return NextResponse.json({
      ok: true,
      ...result,
      draftFieldsMerged,
      leadFieldsMerged,
      auditIdUsedForDraft
    });
  } catch (err) {
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}

function safeJson(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
