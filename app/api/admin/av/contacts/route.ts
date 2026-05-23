/**
 * POST /api/admin/av/contacts
 *
 * Create (or find, by email) a contact = a person, and associate them with one
 * or more companies (leads). A person can belong to many companies; a company
 * can have many people. See schema/033_contacts.sql.
 *
 * Body: {
 *   fullName?: string,
 *   email?: string,
 *   phone?: string,
 *   title?: string,           // role at these companies
 *   notes?: string,
 *   leadIds: number[]         // companies to attach this person to (>= 1)
 * }
 *
 * Behavior:
 *   - If email matches an existing non-archived contact, reuse it (fills blank
 *     fields); otherwise insert a new contact.
 *   - Inserts a lead_contacts row per leadId (INSERT ... ON DUPLICATE = no-op),
 *     so re-adding is safe.
 *
 * Owner + staff only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { getAvDb } from '@/lib/db/av';
import { logEvent } from '@/lib/events/log';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

export const runtime = 'nodejs';

interface ContactRow extends RowDataPacket {
  id: number;
}

function str(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

export async function POST(req: NextRequest) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/av/contacts:POST', tenantId: 'av' });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const fullName = str(body.fullName, 255);
  const email = str(body.email, 320)?.toLowerCase() ?? null;
  const phone = str(body.phone, 64);
  const title = str(body.title, 255);
  const notes = str(body.notes, 2000);
  const leadIds = Array.isArray(body.leadIds)
    ? Array.from(
        new Set(
          (body.leadIds as unknown[])
            .map((n) => (typeof n === 'number' ? n : Number.parseInt(String(n), 10)))
            .filter((n) => Number.isFinite(n) && n > 0)
        )
      )
    : [];

  if (!fullName && !email) {
    return NextResponse.json({ error: 'a name or email is required' }, { status: 400 });
  }
  if (leadIds.length === 0) {
    return NextResponse.json({ error: 'select at least one company to attach this person to' }, { status: 400 });
  }

  try {
    const db = getAvDb();

    // Find-or-create the person (match by email when provided).
    let contactId: number | null = null;
    if (email) {
      const [found] = await db.execute<ContactRow[]>(
        `SELECT id FROM contacts WHERE email = ? AND archived_at IS NULL LIMIT 1`,
        [email]
      );
      contactId = found[0]?.id ?? null;
    }
    if (contactId == null) {
      const [ins] = await db.execute<ResultSetHeader>(
        `INSERT INTO contacts (full_name, email, phone, notes) VALUES (?, ?, ?, ?)`,
        [fullName, email, phone, notes]
      );
      contactId = ins.insertId;
    } else {
      // Backfill any blanks on the existing person without clobbering data.
      await db.execute(
        `UPDATE contacts
            SET full_name = COALESCE(full_name, ?),
                phone = COALESCE(phone, ?),
                notes = COALESCE(notes, ?),
                updated_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
        [fullName, phone, notes, contactId]
      );
    }

    // Associate with each company. Unique(lead_id, contact_id) makes this safe to
    // repeat; ON DUPLICATE refreshes the title/primary flag.
    let associated = 0;
    for (const leadId of leadIds) {
      const [res] = await db.execute<ResultSetHeader>(
        `INSERT INTO lead_contacts (lead_id, contact_id, title, is_primary)
         VALUES (?, ?, ?, 0)
         ON DUPLICATE KEY UPDATE title = COALESCE(VALUES(title), title), archived_at = NULL`,
        [leadId, contactId, title]
      );
      if (res.affectedRows > 0) associated += 1;
    }

    await logEvent({
      eventType: 'contact.upserted',
      userId: guard.actor.userId,
      source: 'av_contacts',
      status: 'success',
      payload: { contact_id: contactId, lead_ids: leadIds, associated, has_email: !!email }
    });

    return NextResponse.json({ ok: true, contactId, companiesLinked: leadIds.length });
  } catch (err) {
    console.error('[av:contacts:create]', (err as Error).message);
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}
