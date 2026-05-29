/**
 * lib/client/weekly_digest.ts  (#216 v1)
 *
 * Build + send a client's weekly digest email. Reuses the ThisWeek data
 * builder (#242) so the email and the in-portal feed never disagree.
 *
 * Theming: pulls the client's brand kit (colors + logo + aesthetic) from
 * their brief so the digest LOOKS like their brand. Defaults to AV's amber
 * + navy when no brand kit is on file.
 *
 * v1 sends via the existing SMTP transport. The "send now" button on the
 * operator client page uses this. v2 will wire a Friday-morning cron over
 * all active clients.
 */
import { fetchClientThisWeek, type ThisWeekItem } from '@/lib/client/this_week';
import { getBriefPayload } from '@/lib/client/brief_store';
import { getAvDb } from '@/lib/db/av';
import { sendEmail, type SendEmailResult } from '@/lib/email/smtp';
import { logEvent } from '@/lib/events/log';
import type { RowDataPacket } from 'mysql2';

interface RecipientRow extends RowDataPacket {
  email: string | null;
  display_name: string | null;
  client_name: string | null;
}

export interface DigestBuildResult {
  /** The recipient email + display name (resolved from client_users + clients). */
  to: string | null;
  brandName: string;
  firstName: string;
  /** The HTML body. */
  html: string;
  /** Plain-text fallback. */
  text: string;
  subject: string;
  /** Items the digest summarized (same shape as the in-portal feed). */
  items: ThisWeekItem[];
  /** True when there's literally nothing worth sending — operator should skip. */
  isEmpty: boolean;
}

const DEFAULT_PRIMARY = '#0a1f3d';
const DEFAULT_ACCENT = '#fcd34d';

function pickFirstHex(raw: string | null | undefined, fallback: string): string {
  if (!raw) return fallback;
  const hexes = raw.split(',').map((c) => c.trim()).filter((c) => /^#[0-9a-fA-F]{6}$/.test(c));
  return hexes[0] ?? fallback;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toneToColor(tone: ThisWeekItem['tone']): string {
  switch (tone) {
    case 'good': return '#10b981';
    case 'urgent': return '#f59e0b';
    case 'info':
    default: return '#60a5fa';
  }
}

/**
 * Resolve the recipient + brand name for this client. Prefers the most
 * recently active client_user with a non-empty email.
 */
async function resolveRecipient(clientId: number): Promise<{ email: string | null; displayName: string | null; clientName: string }> {
  try {
    const db = getAvDb();
    const [rows] = await db.execute<RecipientRow[]>(
      `SELECT cu.email, cu.display_name, c.client_name
         FROM client_users cu
         LEFT JOIN clients c ON c.client_id = cu.client_id
        WHERE cu.client_id = ? AND cu.archived_at IS NULL AND cu.email IS NOT NULL AND cu.email <> ''
        ORDER BY cu.last_login_at DESC, cu.client_user_id ASC
        LIMIT 1`,
      [clientId]
    );
    const r = rows[0];
    if (!r) {
      // Fall back to just the client name; no recipient (we'll surface this).
      const [cRows] = await db.execute<RecipientRow[]>(
        `SELECT NULL AS email, NULL AS display_name, client_name FROM clients WHERE client_id = ? LIMIT 1`,
        [clientId]
      );
      return { email: null, displayName: null, clientName: cRows[0]?.client_name?.trim() || `Client #${clientId}` };
    }
    return {
      email: r.email?.trim() || null,
      displayName: r.display_name?.trim() || null,
      clientName: r.client_name?.trim() || (r.display_name?.trim() || `Client #${clientId}`)
    };
  } catch {
    return { email: null, displayName: null, clientName: `Client #${clientId}` };
  }
}

/**
 * Build the digest (HTML + text) without sending. Useful for the "send now"
 * button to preview-then-send, and the future Friday cron.
 */
export async function buildClientDigest(clientId: number): Promise<DigestBuildResult> {
  const [{ items }, brief, recipient] = await Promise.all([
    fetchClientThisWeek(clientId),
    getBriefPayload('av', clientId) as Promise<Record<string, unknown> | null>,
    resolveRecipient(clientId)
  ]);

  const primary = pickFirstHex(typeof brief?.brand_colors === 'string' ? brief.brand_colors : null, DEFAULT_PRIMARY);
  const logoUrl = typeof brief?.logo_url === 'string' ? brief.logo_url : null;

  const firstName = recipient.displayName?.split(/[ ,]/)[0] || 'there';
  const brandName = recipient.clientName;

  const isEmpty = items.length === 0;

  const subject = isEmpty
    ? `${brandName} — quiet week at Atlantic & Vine`
    : `${brandName} — your week at Atlantic & Vine`;

  // ---- Plain-text fallback ----
  const textLines: string[] = [];
  textLines.push(`Hi ${firstName},`);
  textLines.push('');
  if (isEmpty) {
    textLines.push(`A quiet week on ${brandName}. We'll surface activity here as work lands.`);
  } else {
    textLines.push(`What Atlantic & Vine moved for ${brandName} since your last visit:`);
    textLines.push('');
    for (const it of items) textLines.push(`  • ${it.text}`);
    textLines.push('');
    textLines.push(`Open your hub: https://atlantic-hub.netlify.app/client/dashboard`);
  }
  textLines.push('');
  textLines.push('— Atlantic & Vine');
  const text = textLines.join('\n');

  // ---- HTML ----
  const itemsHtml = isEmpty
    ? `<p style="margin:16px 0 0;color:#475569;font-size:14px;line-height:1.55;">A quiet week on ${escapeHtml(brandName)}. We&rsquo;ll surface activity here as work lands.</p>`
    : items.map((it) => {
        const color = toneToColor(it.tone);
        return `
          <tr>
            <td valign="top" style="width:14px;padding:4px 0 4px 0;">
              <div style="width:6px;height:6px;border-radius:9999px;background:${color};margin-top:8px;"></div>
            </td>
            <td style="padding:4px 0 4px 0;color:#0f172a;font-size:14px;line-height:1.55;">
              ${escapeHtml(it.text)}
            </td>
          </tr>`;
      }).join('\n');

  const logoBlock = logoUrl
    ? `<img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(brandName)} logo" style="max-height:36px;max-width:160px;display:block;border:0;outline:none;" />`
    : `<div style="font-weight:700;font-size:18px;letter-spacing:0.02em;color:#0f172a;">${escapeHtml(brandName)}</div>`;

  const ctaHref = 'https://atlantic-hub.netlify.app/client/dashboard';

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f8fafc;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;">
            <tr>
              <td style="background:${primary};padding:20px 28px;">
                ${logoBlock}
              </td>
            </tr>
            <tr>
              <td style="padding:28px;">
                <div style="font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:#94a3b8;margin-bottom:6px;">Last 7 days</div>
                <h1 style="margin:0 0 6px;font-size:22px;font-weight:600;color:#0f172a;letter-spacing:-0.01em;">
                  This week for ${escapeHtml(firstName)}.
                </h1>
                <p style="margin:0 0 16px;color:#64748b;font-size:14px;line-height:1.55;">
                  What Atlantic &amp; Vine moved on your behalf since your last visit.
                </p>

                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:8px;">
                  ${itemsHtml}
                </table>

                ${isEmpty ? '' : `
                  <div style="margin-top:24px;">
                    <a href="${ctaHref}" style="display:inline-block;background:${primary};color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:13px;font-weight:500;letter-spacing:0.02em;">
                      Open your hub
                    </a>
                  </div>
                `}
              </td>
            </tr>
            <tr>
              <td style="padding:18px 28px;background:#f8fafc;border-top:1px solid #e2e8f0;color:#94a3b8;font-size:11px;line-height:1.55;text-align:center;">
                Atlantic &amp; Vine · This summary is generated each week so you always know what we moved for you.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return {
    to: recipient.email,
    brandName,
    firstName,
    html,
    text,
    subject,
    items,
    isEmpty
  };
}

/**
 * Build + send the digest. Returns the SMTP send result + the items that were
 * included so the caller can audit. Logs `client.digest.sent` /
 * `client.digest.send_failed` for traceability.
 */
export async function sendClientDigest(clientId: number, opts: { force?: boolean } = {}): Promise<{
  build: DigestBuildResult;
  send: SendEmailResult | { sent: false; reason: string };
}> {
  const build = await buildClientDigest(clientId);

  if (build.isEmpty && !opts.force) {
    return { build, send: { sent: false, reason: 'empty_week_skipped' } };
  }
  if (!build.to) {
    return { build, send: { sent: false, reason: 'no_recipient_email' } };
  }

  const sendRes = await sendEmail({
    to: build.to,
    subject: build.subject,
    text: build.text,
    html: build.html
  });

  await logEvent({
    eventType: sendRes.sent ? 'client.digest.sent' : 'client.digest.send_failed',
    organizationId: clientId,
    source: 'digest',
    status: sendRes.sent ? 'success' : 'failure',
    errorMessage: sendRes.sent ? undefined : (sendRes.reason || 'unknown'),
    payload: {
      client_id: clientId,
      to: build.to,
      items_count: build.items.length,
      is_empty: build.isEmpty
    }
  });

  return { build, send: sendRes };
}
