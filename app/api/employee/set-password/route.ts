/**
 * POST /api/employee/set-password   { token, password }
 *
 * PUBLIC, no-login. Authorized purely by the signed invite token issued at
 * create-employee (schema 052). Verifies the token, sets the employee's
 * password, clears the token, and marks their profile active. They then log in
 * normally at /login. Not in the middleware matcher, so reachable without a
 * session.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { userIdForSetPasswordToken, setEmployeePassword } from '@/lib/employees/store';

export const runtime = 'nodejs';

const Schema = z.object({
  token: z.string().length(64),
  password: z.string().min(10, 'Password must be at least 10 characters').max(200)
});

export async function POST(req: NextRequest) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const parsed = Schema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message ?? 'invalid input' }, { status: 400 });
  }

  const userId = await userIdForSetPasswordToken(parsed.data.token);
  if (!userId) {
    return NextResponse.json({ error: 'this link is invalid or expired — ask Atlantic & Vine for a fresh one' }, { status: 401 });
  }

  try {
    await setEmployeePassword(userId, parsed.data.password);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}
