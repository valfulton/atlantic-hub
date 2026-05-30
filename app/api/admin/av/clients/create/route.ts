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
import type { RowDataPacket } from 'mysql2';

export const runtime = 'nodejs';
export const maxDuration = 30;

const TIERS: ClientTier[] = ['audit_only', 'sprint', 'momentum', 'scale'];
// Brief fields the operator may pre-fill; everything here lands in intake_payload.
const INTAKE_KEYS = ['key_message', 'target_audience', 'audience_insights', 'why_advertise', 'goals', 'message_support', 'differentiators', 'competitors', 'brand_voice', 'brand_colors', 'preferred_channels', 'timeline', 'founder_story', 'market_position', 'proof_points', 'ideal_client'];

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
  const auditId = typeof body.auditId === 'string' ? body.auditId.trim() : '';
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(auditId)) {
    try {
      const db = getAvDb();
      const [rows] = await db.execute<(RowDataPacket & { source_payload: string | object | null })[]>(
        `SELECT source_payload FROM leads WHERE audit_id = ? AND archived_at IS NULL LIMIT 1`,
        [auditId]
      );
      const raw = rows[0]?.source_payload ?? null;
      const parsed: Record<string, unknown> = typeof raw === 'string'
        ? safeJson(raw)
        : (raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {});
      const draftBlob = parsed['lead_intake_draft'];
      const draft: Record<string, unknown> = draftBlob && typeof draftBlob === 'object' && !Array.isArray(draftBlob)
        ? (draftBlob as Record<string, unknown>)
        : {};
      for (const k of INTAKE_KEYS) {
        if (k in intake) continue; // operator typed something — they win
        const v = draft[k];
        if (typeof v === 'string' && v.trim() && v.trim() !== '[ask]') {
          intake[k] = v.trim();
          draftFieldsMerged += 1;
        }
      }
      if (draftFieldsMerged > 0) auditIdUsedForDraft = auditId;
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
