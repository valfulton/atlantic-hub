/**
 * SMTP transport for transactional emails.
 *
 * Uses HostGator-hosted SMTP (or any RFC-compliant SMTP). Configured via
 * Netlify env vars:
 *   SMTP_HOST  e.g. api.atlanticandvine.com  (the cPanel "Outgoing Server" host;
 *              NOT mail.<domain> for a subdomain mailbox -- copy it verbatim from
 *              cPanel > Email Accounts > Connect Devices > Mail Client Manual Settings)
 *   SMTP_PORT  e.g. 465 (SSL) or 587 (TLS)
 *   SMTP_USER  e.g. outreach@api.atlanticandvine.com
 *   SMTP_PASS  the mailbox password
 *   SMTP_FROM  e.g. Atlantic & Vine <outreach@api.atlanticandvine.com>
 *              defaults to SMTP_USER if unset
 *
 * If any of the four required vars are missing, sendEmail() returns
 * { sent: false, reason: 'smtp_not_configured' } and the caller falls
 * back to console-logging the link. This lets the system survive a
 * misconfigured deploy without breaking the intake flow.
 */
import nodemailer, { type Transporter } from 'nodemailer';

let transporter: Transporter | null = null;
let transporterError: string | null = null;

function getTransporter(): Transporter | null {
  if (transporter) return transporter;
  if (transporterError) return null;
  const host = process.env.SMTP_HOST;
  const portStr = process.env.SMTP_PORT;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !portStr || !user || !pass) {
    transporterError = 'smtp_not_configured';
    return null;
  }
  const port = parseInt(portStr, 10);
  if (!Number.isFinite(port) || port <= 0) {
    transporterError = 'smtp_bad_port';
    return null;
  }
  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465, // 465 = implicit TLS; 587 = STARTTLS
    auth: { user, pass }
  });
  return transporter;
}

export interface SendEmailParams {
  to: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
}

export interface SendEmailResult {
  sent: boolean;
  messageId?: string;
  reason?: string;
}

export async function sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
  const t = getTransporter();
  if (!t) {
    return { sent: false, reason: transporterError || 'smtp_not_configured' };
  }
  const from = process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@api.atlanticandvine.com';
  try {
    const info = await t.sendMail({
      from,
      to: params.to,
      subject: params.subject,
      text: params.text,
      html: params.html,
      replyTo: params.replyTo
    });
    return { sent: true, messageId: info.messageId };
  } catch (err) {
    return { sent: false, reason: (err as Error).message };
  }
}
