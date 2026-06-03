/**
 * POST /api/admin/av/clients/[client_id]/attach-login   (#368, val 2026-06-02)
 *
 * Two modes operator can pick:
 *
 *   1. mode='create' — make a fresh client_user with the given email + display
 *      name and BIND it directly to this brand (client_users.client_id = ?).
 *      Optionally sets a password too (auto or manual). When omitted, leaves
 *      password_hash NULL so the only way in is the magic link.
 *
 *   2. mode='attach' — find an EXISTING client_user by email and attach them
 *      to this brand via brand_members (role=owner by default). This is the
 *      Adriana case: she already exists as the CBB owner, just needs CLDA
 *      added to her visible set.
 *
 * On success the magic-link + send-password endpoints will now find a login
 * to act on (#368 fallback resolves the same brand_members path).
 *
 * Owner + staff only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { getAvDb } from '@/lib/db/av';
import { findClientUserByEmail } from '@/lib/auth/client-user';
import { setBrandMember } from '@/lib/client/membership';
import { hashPassword } from '@/lib/auth/password';
import { randomBytes } from 'crypto';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';

export const runtime = 'nodejs';

interface AttachBody {
  mode: 'create' | 'attach';
  email?: string;
  displayName?: string;
  /** Only used for mode='create'; ignored on attach. */
  password?: string;
  /** When mode='attach', the role to grant. Default 'owner'. */
  role?: 'owner' | 'rep' | 'viewer';
}

function generateTempPassword(): string {
  const ALPH = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const buf = randomBytes(18);
  let out = '';
  for (let i = 0; i < 12; i++) out += ALPH[buf[i] % ALPH.length];
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}`;
}

export async function POST(req: NextRequest, { params }: { params: { client_id: string } }) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/clients/attach-login:POST',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const clientId = Number.parseInt(params.client_id, 10);
  if (!Number.isFinite(clientId) || clientId <= 0) {
    return NextResponse.json({ error: 'invalid client id' }, { status: 400 });
  }

  let body: Partial<AttachBody>;
  try {
    body = (await req.json()) as Partial<AttachBody>;
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }

  const mode = body.mode;
  if (mode !== 'create' && mode !== 'attach') {
    return NextResponse.json({ error: 'mode must be "create" or "attach"' }, { status: 400 });
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: 'valid email required' }, { status: 400 });
  }
  const displayName = typeof body.displayName === 'string' ? body.displayName.trim().slice(0, 200) : '';

  try {
    const db = getAvDb();

    if (mode === 'attach') {
      // (Adriana) — find the existing login by email, attach to this brand.
      const existing = await findClientUserByEmail(email);
      if (!existing) {
        return NextResponse.json(
          {
            error: 'no_existing_user',
            reason: `No client_user found with email ${email}. Switch to "Create new" to mint one, or check the spelling.`
          },
          { status: 404 }
        );
      }
      const role: 'owner' | 'rep' | 'viewer' =
        body.role === 'rep' || body.role === 'viewer' ? body.role : 'owner';
      const ok = await setBrandMember(existing.client_user_id, clientId, role);
      if (!ok) {
        return NextResponse.json({ error: 'attach failed' }, { status: 500 });
      }
      return NextResponse.json({
        ok: true,
        mode: 'attach',
        clientUserId: existing.client_user_id,
        email: existing.email,
        displayName: existing.display_name,
        role,
        message: `Attached ${existing.email} to this brand as ${role}.`
      });
    }

    // mode === 'create' — fresh client_user bound directly to this brand.
    // Check for collisions: an existing client_user with this email already
    // means we should be in 'attach' mode (avoid creating a dup row).
    const collision = await findClientUserByEmail(email);
    if (collision) {
      return NextResponse.json(
        {
          error: 'email_exists',
          reason: `A login already exists for ${email} (id ${collision.client_user_id}). Use "Attach existing" instead — that adds them to this brand without minting a duplicate.`,
          existingClientUserId: collision.client_user_id
        },
        { status: 409 }
      );
    }

    // Optional password — if provided, hash it; otherwise leave password_hash
    // NULL so the only way in is a magic link.
    let passwordHash: string | null = null;
    let plaintext: string | null = null;
    const manual = typeof body.password === 'string' ? body.password.trim() : '';
    if (manual && manual.length > 0) {
      if (manual.length < 6) {
        return NextResponse.json({ error: 'password too short', minLength: 6 }, { status: 400 });
      }
      plaintext = manual;
      passwordHash = await hashPassword(manual);
    }

    const [insertRes] = await db.execute<ResultSetHeader>(
      `INSERT INTO client_users
         (email, display_name, password_hash, tier, client_id)
       VALUES (?, ?, ?, 'audit_only', ?)`,
      [email, displayName || null, passwordHash, clientId]
    );
    const clientUserId = insertRes.insertId;

    // Sanity re-read so we return the row's actual state, not what we asked for.
    const [rows] = await db.execute<(RowDataPacket & { client_user_id: number; email: string; display_name: string | null })[]>(
      `SELECT client_user_id, email, display_name FROM client_users WHERE client_user_id = ? LIMIT 1`,
      [clientUserId]
    );

    return NextResponse.json({
      ok: true,
      mode: 'create',
      clientUserId,
      email: rows[0]?.email ?? email,
      displayName: rows[0]?.display_name ?? displayName ?? null,
      passwordSet: !!passwordHash,
      password: plaintext, // returned ONCE for val to copy; never logged
      message: passwordHash
        ? `Created login for ${email}. Password is ready — copy from the field below.`
        : `Created login for ${email}. No password set yet — generate one with the "Email + password" panel, or send a magic link.`
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'server error', errorClass: (err as Error).name },
      { status: 500 }
    );
  }
}
