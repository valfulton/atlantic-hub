/**
 * POST /api/admin/av/smtp-test
 *
 * (val 2026-06-13) Confirms SMTP is actually configured + delivering, so val
 * doesn't have to guess whether "Forgot password?" emails are going out. Sends
 * a real test email and returns the REAL sendEmail() result — not the generic
 * "if that email exists" message the public resend endpoint returns.
 *
 * Body: { to: string }   (operator picks any address — her own is fine)
 *
 * Returns: {
 *   ok: true,
 *   sent: boolean,
 *   reason?: 'smtp_not_configured' | 'smtp_bad_port' | other,
 *   messageId?: string,
 *   envPresent: { host, port, user, from }
 * }
 *
 * If sent === false and reason === 'smtp_not_configured', the four SMTP_*
 * env vars are missing on Netlify. Add them in Site settings → Environment
 * variables and redeploy.
 *
 * Operator-only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { sendEmail } from '@/lib/email/smtp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const guard = await guardAdminRequest(req, {
    targetResource: 'smtp_test',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
  }

  let body: { to?: unknown };
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: 'body must be json' }, { status: 400 }); }
  const to = typeof body.to === 'string' ? body.to.trim() : '';
  if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
    return NextResponse.json({ ok: false, error: 'valid recipient email required' }, { status: 400 });
  }

  // Echo back which env vars are PRESENT (never the values) so val can see at
  // a glance whether the deploy has SMTP configured.
  const envPresent = {
    host: Boolean(process.env.SMTP_HOST),
    port: Boolean(process.env.SMTP_PORT),
    user: Boolean(process.env.SMTP_USER),
    pass: Boolean(process.env.SMTP_PASS),
    from: Boolean(process.env.SMTP_FROM)
  };

  const result = await sendEmail({
    to,
    subject: 'Atlantic Hub · SMTP test',
    text: `This is a test from /api/admin/av/smtp-test confirming SMTP delivery is live.\n\nIf you got this, "Forgot password?" on /client/login is working too.\n\nSent ${new Date().toISOString()}.`,
    html: `<p>This is a test from <code>/api/admin/av/smtp-test</code> confirming SMTP delivery is live.</p>
<p>If you got this, <strong>Forgot password?</strong> on <code>/client/login</code> is working too.</p>
<p style="color:#666;font-size:12px;">Sent ${new Date().toISOString()}.</p>`
  });

  return NextResponse.json({
    ok: true,
    sent: result.sent,
    reason: result.reason,
    messageId: result.messageId,
    envPresent
  });
}
