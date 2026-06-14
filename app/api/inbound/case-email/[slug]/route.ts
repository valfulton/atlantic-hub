/**
 * POST /api/inbound/case-email/[slug]
 *
 * (val 2026-06-13, #645) Inbound webhook for the per-case email bridge.
 * SendGrid / Postmark / Mailgun / SES inbound-parse all POST a multipart
 * form here with the parsed email + attachments. We map the slug back to
 * a case, write a row in case_inbound_messages, save attachments, and
 * surface to operator/Rebecca for triage.
 *
 * SECURITY: the slug is the only auth — 16 hex chars = 64-bit guess
 * space, fine for a non-replay write-only endpoint. We additionally
 * verify the inbound provider's signature header when the secret is
 * configured (CASE_INBOUND_SHARED_SECRET). Unknown / wrong slug 404s.
 *
 * Attachments: stored via Netlify Blobs / S3 (whichever provider is
 * wired in lib/asset/storage). For v1 we just log the URLs we got and
 * surface them in the triage UI — operator drags into the document
 * vault. Auto-attach-to-vault lands in a follow-up so we don't auto-publish
 * something un-vetted into the case (especially for a fact-gathering case
 * like Johnson).
 */
import { NextRequest, NextResponse } from 'next/server';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { getAvDb } from '@/lib/db/av';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface CaseLookupRow extends RowDataPacket {
  case_id: number;
}
interface PartyLookupRow extends RowDataPacket {
  party_id: number;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { slug: string } }
) {
  const slug = (params.slug || '').toLowerCase().trim();
  if (!/^[a-f0-9]{8,40}$/.test(slug)) {
    return NextResponse.json({ error: 'bad slug' }, { status: 400 });
  }

  // Optional shared-secret check — provider sets a custom header on every
  // inbound POST. If we configured one, require it.
  const requiredSecret = process.env.CASE_INBOUND_SHARED_SECRET;
  if (requiredSecret) {
    const got = req.headers.get('x-inbound-secret') ?? '';
    if (got !== requiredSecret) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
  }

  const db = getAvDb();

  // Look up the case by slug.
  const [caseRows] = await db.execute<CaseLookupRow[]>(
    `SELECT case_id FROM cases WHERE email_slug = ? LIMIT 1`,
    [slug]
  );
  const caseId = caseRows[0]?.case_id;
  if (!caseId) {
    // 404 to avoid leaking which slugs are valid.
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  // Parse the inbound body. Most providers POST JSON; SES/Mailgun use
  // multipart. We accept either — JSON is the simple path.
  let payload: Record<string, unknown> = {};
  try {
    const contentType = req.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      payload = await req.json();
    } else {
      const form = await req.formData();
      for (const [k, v] of form.entries()) {
        payload[k] = typeof v === 'string' ? v : (v as File).name;
      }
    }
  } catch {
    return NextResponse.json({ error: 'bad payload' }, { status: 400 });
  }

  // Field extraction — common shapes across providers normalized.
  const subject = pickString(payload, ['subject', 'Subject']);
  const fromAddr = pickString(payload, ['from', 'From', 'sender']);
  const bodyText = pickString(payload, ['text', 'plain', 'body-plain', 'body_text']);
  const bodyHtml = pickString(payload, ['html', 'body-html', 'body_html']);

  // SMS-via-email carrier wrappers: the From address often encodes the
  // phone number, e.g. 5105551234@vzwpix.com / 5105551234@mms.att.net.
  const phoneFromAddr = fromAddr ? extractPhoneFromCarrierAddress(fromAddr) : null;

  // Attribution — match the sender phone to a known case party.
  let matchedPartyId: number | null = null;
  if (phoneFromAddr) {
    const [partyRows] = await db.execute<PartyLookupRow[]>(
      `SELECT party_id FROM case_parties
        WHERE case_id = ?
          AND contact_phone IS NOT NULL
          AND REPLACE(REPLACE(REPLACE(REPLACE(contact_phone,' ',''),'-',''),'(',''),')','') LIKE CONCAT('%', ?, '%')
        LIMIT 1`,
      [caseId, phoneFromAddr]
    );
    matchedPartyId = partyRows[0]?.party_id ?? null;
  }

  // Attachments stub — we capture metadata only for v1; actual blob
  // storage wiring lands when lib/asset/storage gets the case-inbound
  // path added. Providers send attachments as `attachment-N` or as a
  // structured array. Normalize to {filename, contentType, sizeBytes}.
  const attachments = extractAttachmentsMeta(payload);

  // Insert. raw_payload preserved for re-processing once attachment
  // storage is wired.
  const [res] = await db.execute<ResultSetHeader>(
    `INSERT INTO case_inbound_messages
       (case_id, sender_address, sender_phone, matched_party_id,
        subject, body_text, body_html, attachments, status, raw_payload)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'received', ?)`,
    [
      caseId,
      fromAddr || null,
      phoneFromAddr,
      matchedPartyId,
      subject || null,
      bodyText || null,
      bodyHtml || null,
      attachments.length > 0 ? JSON.stringify(attachments) : null,
      JSON.stringify(payload)
    ]
  );

  return NextResponse.json({
    ok: true,
    messageId: res.insertId,
    caseId,
    attachmentCount: attachments.length,
    matchedParty: matchedPartyId !== null
  });
}

// ── Helpers ───────────────────────────────────────────────────────────

function pickString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
}

/**
 * SMS-via-email senders look like `5105551234@vzwpix.com` (Verizon MMS),
 * `5105551234@mms.att.net` (AT&T MMS), `5105551234@tmomail.net` (T-Mobile),
 * `5105551234@vtext.com` (Verizon SMS). Pull the 10-digit phone for
 * matching against case_parties.contact_phone.
 */
function extractPhoneFromCarrierAddress(addr: string): string | null {
  const local = addr.split('@')[0]?.replace(/[^0-9]/g, '') ?? '';
  if (local.length >= 10) return local.slice(-10);
  return null;
}

function extractAttachmentsMeta(payload: Record<string, unknown>): Array<{
  filename: string; contentType: string | null; sizeBytes: number | null;
}> {
  const out: Array<{ filename: string; contentType: string | null; sizeBytes: number | null }> = [];

  // Mailgun: `attachment-count` + `attachment-1` etc.
  const countStr = payload['attachment-count'];
  if (typeof countStr === 'string') {
    const count = parseInt(countStr, 10);
    for (let i = 1; i <= count; i++) {
      const fn = payload[`attachment-${i}`];
      if (typeof fn === 'string') {
        out.push({ filename: fn, contentType: null, sizeBytes: null });
      }
    }
  }

  // SendGrid: `attachments` integer + `attachment1` etc.
  const sg = payload.attachments;
  if (typeof sg === 'string') {
    const count = parseInt(sg, 10);
    for (let i = 1; i <= count; i++) {
      const fn = payload[`attachment${i}`];
      if (typeof fn === 'string') {
        out.push({ filename: fn, contentType: null, sizeBytes: null });
      }
    }
  }

  // Generic structured array.
  if (Array.isArray(payload.attachments)) {
    for (const a of payload.attachments as Array<Record<string, unknown>>) {
      const fn = typeof a.filename === 'string' ? a.filename
        : typeof a.name === 'string' ? a.name : null;
      if (!fn) continue;
      out.push({
        filename: fn,
        contentType: typeof a.contentType === 'string' ? a.contentType
          : typeof a.content_type === 'string' ? a.content_type : null,
        sizeBytes: typeof a.size === 'number' ? a.size
          : typeof a.sizeBytes === 'number' ? a.sizeBytes : null
      });
    }
  }

  return out;
}
