/**
 * POST /api/client/intake
 *
 * Public endpoint. Receives the client-intake form submission from
 * atlanticandvine.netlify.app/client-intake, creates (or reuses) a
 * client_users row, issues a magic-link token, and logs the resulting
 * link to stdout/stderr for the operator to forward manually.
 *
 * Response is intentionally generic ({ ok: true }) to avoid leaking
 * which emails already have accounts.
 *
 * Rate limit: 5 submissions per IP per 15 minutes. Stops form-spam
 * brute-force without blocking legitimate retries.
 *
 * NO email send in v1. The magic link is console-logged with a
 * recognizable prefix; the operator pastes it into a hand-written
 * follow-up email. A future commit will swap this for a real email
 * send (Resend / Postmark) without changing the route contract.
 *
 * TODO(system_events): once the parallel session lands the unified
 * system_events table, wire client_intake events here:
 *   - event_type: 'client_intake.received'
 *   - event_type: 'client_intake.magic_link_issued'
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { extractClientIp, writeAuditRow } from '@/lib/audit';
import { checkAndConsume, LOGIN_RATE_LIMIT } from '@/lib/rate-limit';
import { ipHash } from '@/lib/crypto/hash';
import {
  generateMagicToken,
  magicTokenExpiresAt,
  buildMagicLinkUrl
} from '@/lib/auth/client-magic-token';
import { upsertClientUserForIntake } from '@/lib/auth/client-user';
import { corsHeadersFor } from '@/lib/auth/client-cors';
import { sendEmail } from '@/lib/email/smtp';
import { buildMagicLinkEmail } from '@/lib/email/magic-link-template';
import { MAGIC_TOKEN_TTL_HOURS } from '@/lib/auth/client-magic-token';

export const runtime = 'nodejs';

const IntakeSchema = z.object({
  email: z.string().email().max(255),
  name: z.string().max(255).optional(),
  company: z.string().max(255).optional(),
  phone: z.string().max(40).optional(),
  website: z.string().max(500).optional(),
  industry: z.string().max(120).optional(),
  message: z.string().max(4000).optional(),
  // Allow the marketing form to send any other fields without rejection;
  // we store them in intake_payload as forensic record.
  source: z.string().max(120).optional()
}).passthrough();

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeadersFor(req.headers.get('origin'))
  });
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get('origin');
  const cors = corsHeadersFor(origin);
  const ip = extractClientIp(req.headers);
  const ua = req.headers.get('user-agent');

  // Rate limit by IP.
  const rl = await checkAndConsume({
    bucketKey: `client_intake:ip:${ipHash(ip)}`,
    limit: LOGIN_RATE_LIMIT.limit,
    windowSeconds: LOGIN_RATE_LIMIT.windowSeconds
  });
  if (!rl.allowed) {
    await writeAuditRow({
      targetResource: '/api/client/intake',
      action: 'intake_rate_limited',
      ip,
      userAgent: ua,
      statusCode: 429,
      errorClass: 'RateLimited'
    });
    return NextResponse.json(
      { error: 'too many submissions, please try again later' },
      { status: 429, headers: cors }
    );
  }

  // Parse body.
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400, headers: cors });
  }
  const parsed = IntakeSchema.safeParse(body);
  if (!parsed.success) {
    await writeAuditRow({
      targetResource: '/api/client/intake',
      action: 'intake_bad_input',
      ip,
      userAgent: ua,
      statusCode: 400,
      errorClass: 'BadInput'
    });
    return NextResponse.json({ error: 'missing or invalid email' }, { status: 400, headers: cors });
  }
  const data = parsed.data;
  const email = data.email.toLowerCase().trim();
  const displayName =
    (data.name && data.name.trim()) ||
    (data.company && data.company.trim()) ||
    null;

  try {
    const magicToken = generateMagicToken();
    const expiresAt = magicTokenExpiresAt();

    const { row, created } = await upsertClientUserForIntake({
      email,
      displayName,
      magicToken,
      magicTokenExpiresAt: expiresAt,
      intakePayload: data
    });

    const link = buildMagicLinkUrl(magicToken);

    // Send the magic-link email via SMTP (HostGator outreach@ mailbox).
    // If SMTP is not configured, we fall back to console-logging so
    // the link is still recoverable from Netlify function logs.
    const emailBody = buildMagicLinkEmail({
      recipientName: row.display_name ?? displayName,
      magicLinkUrl: link,
      expiresInHours: MAGIC_TOKEN_TTL_HOURS,
      isFirstTime: created || !row.password_hash
    });
    const emailResult = await sendEmail({
      to: email,
      subject: emailBody.subject,
      text: emailBody.text,
      html: emailBody.html
    });

    // Always log a structured trail. If email sent, we record the
    // messageId; if not, we still log the link so it can be recovered
    // manually.
    console.log(
      '[client-portal:magic-link]',
      JSON.stringify({
        email,
        clientUserId: row.client_user_id,
        link,
        expiresAt: expiresAt.toISOString(),
        firstTime: created,
        emailSent: emailResult.sent,
        emailReason: emailResult.reason ?? null,
        messageId: emailResult.messageId ?? null
      })
    );

    await writeAuditRow({
      actorUserId: row.client_user_id,
      actorRole: 'client_user',
      targetResource: '/api/client/intake',
      action: emailResult.sent
        ? (created ? 'intake_created_emailed' : 'intake_returning_emailed')
        : (created ? 'intake_created' : 'intake_returning'),
      ip,
      userAgent: ua,
      statusCode: 200,
      errorClass: emailResult.sent ? null : (emailResult.reason ?? 'EmailNotSent')
    });

    return NextResponse.json(
      {
        ok: true,
        message:
          "Thanks - we've received your audit request. We'll be in touch with your secure access link shortly."
      },
      { status: 200, headers: cors }
    );
  } catch (err) {
    await writeAuditRow({
      targetResource: '/api/client/intake',
      action: 'intake_error',
      ip,
      userAgent: ua,
      statusCode: 500,
      errorClass: (err as Error).name || 'UnknownError'
    });
    console.error('[client-portal:intake-error]', (err as Error).message);
    return NextResponse.json(
      { error: 'something went wrong, please try again' },
      { status: 500, headers: cors }
    );
  }
}
