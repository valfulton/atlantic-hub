// CRON-ONLY — invoked by Netlify/worker schedule (some also via a manual "run now" button).
// Zero/limited in-app fetch call sites is BY DESIGN. Do NOT delete in a dead-code sweep.
// See Atlantic_Hub_Playbook/Hidden_Pages_Audit.md (PR A).

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
import { ensureClientHub } from '@/lib/client/provision';
import { getBriefPayload, saveBriefPayload, type BriefPayload } from '@/lib/client/brief_store';
import { suggestIcpFromIntake, getClientIcpWithProvenance, saveClientIcp, mergeIntakeIcp } from '@/lib/client/icp';
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
  source: z.string().max(120).optional(),

  // ── Creative-brief feeders (val's canonical 6-question brief) ──────────────
  // These auto-populate the creative brief + seed the first narrative line.
  // The marketing form should ask these; they're optional here so the form can
  // roll out incrementally. Maps: see lib/client/intake_brief.ts.
  why_advertise: z.string().max(2000).optional(),      // Q1 why advertise -> campaign goal
  goals: z.string().max(2000).optional(),              // Q2 what it accomplishes -> objectives
  target_audience: z.string().max(1000).optional(),    // Q3 who -> line.audience
  audience_insights: z.string().max(2000).optional(),  // Q4 insights about them
  key_message: z.string().max(1000).optional(),        // Q5 single most effective message -> line.thesis
  message_support: z.string().max(2000).optional(),    // Q6 what supports it -> proof_points
  // Brand/voice + targeting extras the brief and commercials use:
  brand_voice: z.string().max(1000).optional(),        // tone -> emotional_driver / voice guardrails
  differentiators: z.string().max(2000).optional(),    // -> authority_angle / proof_points
  competitors: z.string().max(1000).optional(),
  brand_colors: z.string().max(500).optional(),        // -> brand kit
  preferred_channels: z.string().max(500).optional(),  // -> best_channels
  timeline: z.string().max(500).optional(),            // -> seasonality

  // Anything else the form sends is still captured verbatim into intake_payload.
}).passthrough();

/**
 * Map the PUBLIC FORM's field names onto the brief's canonical keys so a client's
 * richest answers actually populate the labeled Creative Brief — not just sit in
 * the raw payload. The website form uses ideal_client / founder_story /
 * proof_points / client_problems and three brand-personality radios; the brief
 * reads target_audience / why_advertise / message_support / audience_insights /
 * brand_voice / preferred_channels.
 *
 * Non-destructive: only fills a canonical key the form didn't already send
 * directly, and keeps every original field too (nothing is lost). Fixes the
 * intake→brief "drift" where submitted answers didn't reach the labeled brief.
 */
function normalizeIntakeForBrief(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...data };
  const setIfEmpty = (key: string, val: unknown) => {
    if (val == null || val === '') return;
    const cur = out[key];
    if (cur == null || cur === '') out[key] = val;
  };

  setIfEmpty('target_audience', data.ideal_client);
  setIfEmpty('message_support', data.proof_points);
  setIfEmpty('why_advertise', data.founder_story);
  setIfEmpty('audience_insights', data.client_problems);

  // brand_voice ← compose from the three personality radios (Traditional/Modern,
  // Friendly/Corporate, High-end/Cost-effective).
  const voiceBits = [data.brand_traditional, data.brand_friendly, data.brand_pricing]
    .filter((v): v is string => typeof v === 'string' && v.trim() !== '');
  if (voiceBits.length) setIfEmpty('brand_voice', voiceBits.join(', '));

  // preferred_channels ← content platforms (checkboxes, may be array) + any
  // socials the client connected in-form.
  const channels: string[] = [];
  if (Array.isArray(data.content_platforms)) {
    for (const c of data.content_platforms) if (typeof c === 'string' && c) channels.push(c);
  } else if (typeof data.content_platforms === 'string' && data.content_platforms) {
    channels.push(data.content_platforms);
  }
  if (typeof data.social_connected === 'string' && data.social_connected) {
    for (const s of data.social_connected.split(',')) if (s.trim()) channels.push(s.trim());
  }
  if (channels.length) setIfEmpty('preferred_channels', channels.join(', '));

  return out;
}

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

    // Connect this submission to the client's hub + canonical brief store, so a
    // client's own answers actually reach the operator/PR/audit engine (which
    // reads the brief by client_id) and the intake gate sees them as done.
    // Historically this endpoint only wrote client_users.intake_payload (by
    // email), leaving the submission siloed. Non-fatal: never block the magic
    // link on a brief-write failure.
    try {
      const clientId = await ensureClientHub(row);
      if (clientId) {
        const existingBrief =
          ((await getBriefPayload('av', clientId)) as Record<string, unknown> | null) ?? {};
        const mergedBrief: Record<string, unknown> = { ...existingBrief };
        // Preserve the operator's ORIGINAL answers once, before the client's first
        // submission can overwrite any of them — so val can always retrieve what she
        // wrote at setup. Snapshotted a single time; later submissions leave it alone.
        if (existingBrief.operator_intake_snapshot == null && Object.keys(existingBrief).length > 0) {
          const snapshot = { ...existingBrief };
          delete (snapshot as Record<string, unknown>).operator_intake_snapshot;
          mergedBrief.operator_intake_snapshot = snapshot;
          mergedBrief.operator_intake_snapshot_at = new Date().toISOString();
        }
        // Map form field names onto the brief's canonical keys first (fixes drift),
        // then apply the client's answers — never overwriting an existing value
        // (e.g. operator prefill) with a blank the client left empty.
        for (const [k, v] of Object.entries(normalizeIntakeForBrief(data))) {
          if (v === '' || v == null) continue;
          mergedBrief[k] = v;
        }
        mergedBrief.client_completed_at = new Date().toISOString();
        await saveBriefPayload('av', clientId, mergedBrief as BriefPayload, {
          source: 'client_intake',
          changedBy: email
        });

        // Repopulate the client's ICP from this submission so their new answers
        // (geographic focus, ideal-client text) actually reach discovery — not just
        // the brief. Historically the ICP only persisted on first discovery run or
        // manual "Save ICP", so fresh intake never updated it. Merge-preserving:
        // operator-curated excludes survive; new geo/notes repopulate. Non-fatal.
        try {
          const suggested = suggestIcpFromIntake(data);
          const { icp: existingIcp, provenance: priorProv } = await getClientIcpWithProvenance(clientId);
          const { icp: mergedIcp, provenance } = mergeIntakeIcp(existingIcp, suggested, priorProv);
          await saveClientIcp(clientId, mergedIcp, null, provenance);
        } catch (icpErr) {
          console.error('[client-portal:intake] icp refresh skipped:', (icpErr as Error).message);
        }
      }
    } catch (e) {
      console.error('[client-portal:intake] brief link skipped:', (e as Error).message);
    }

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

    // Operator notification — so val knows the moment a submission lands (not just
    // the client getting their magic link). Address is configurable; non-fatal.
    try {
      const notifyTo = process.env.INTAKE_NOTIFY_EMAIL || 'val@atlanticandvine.com';
      const company = typeof data.company === 'string' && data.company.trim() ? data.company.trim() : '(not given)';
      const summary =
        `New client intake submitted.\n\n` +
        `Name: ${displayName || '(not given)'}\n` +
        `Email: ${email}\n` +
        `Company: ${company}\n` +
        `Returning account: ${created ? 'no — first time' : 'yes'}\n\n` +
        `Review it in the hub: https://atlantic-hub.netlify.app/admin/av/clients`;
      await sendEmail({
        to: notifyTo,
        subject: `New intake: ${displayName || email}`,
        text: summary,
        html: `<p>New client intake submitted.</p>
<ul>
  <li><strong>Name:</strong> ${displayName || '(not given)'}</li>
  <li><strong>Email:</strong> ${email}</li>
  <li><strong>Company:</strong> ${company}</li>
  <li><strong>Returning account:</strong> ${created ? 'no — first time' : 'yes'}</li>
</ul>
<p><a href="https://atlantic-hub.netlify.app/admin/av/clients">Review it in the hub</a></p>`
      });
    } catch (notifyErr) {
      console.error('[client-portal:intake] operator notify failed:', (notifyErr as Error).message);
    }

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

    // Smoke-test diagnostics: only echoed back when the request carries a
    // matching X-Smoke-Test secret header. Lets scripts/smoke-intake.mjs read
    // the real email send result without log-diving. Never exposed publicly:
    // requires SMOKE_TEST_SECRET to be set AND the header to match exactly.
    const smokeSecret = process.env.SMOKE_TEST_SECRET;
    const smokeHeader = req.headers.get('x-smoke-test');
    const smokeOk = Boolean(smokeSecret) && smokeHeader === smokeSecret;

    return NextResponse.json(
      {
        ok: true,
        message:
          "Thanks - we've received your audit request. We'll be in touch with your secure access link shortly.",
        ...(smokeOk
          ? {
              _smoke: {
                emailSent: emailResult.sent,
                emailReason: emailResult.reason ?? null,
                messageId: emailResult.messageId ?? null
              }
            }
          : {})
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
