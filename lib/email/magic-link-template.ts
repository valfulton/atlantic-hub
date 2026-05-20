/**
 * Magic-link email template.
 * Plain-text + HTML versions. Brand voice: warm, confident, brief.
 */
export interface MagicLinkEmailParams {
  recipientName: string | null;
  magicLinkUrl: string;
  expiresInHours: number;
  isFirstTime: boolean;
}

export function buildMagicLinkEmail(params: MagicLinkEmailParams): {
  subject: string;
  text: string;
  html: string;
} {
  const name = params.recipientName?.split(/[ ,]/)[0] || 'there';
  const cta = params.isFirstTime
    ? 'Open your portal and set your password'
    : 'Sign in to your portal';

  const subject = params.isFirstTime
    ? 'Your Atlantic & Vine portal is ready'
    : 'Your Atlantic & Vine sign-in link';

  const text = [
    `Hi ${name},`,
    '',
    params.isFirstTime
      ? "Welcome to Atlantic & Vine. Your client portal is ready. Click the link below to open it and set your password."
      : "Click the link below to sign in to your Atlantic & Vine portal.",
    '',
    params.magicLinkUrl,
    '',
    `This link expires in ${params.expiresInHours} hours and can only be used once.`,
    '',
    "If you didn't request this, you can safely ignore this email.",
    '',
    '- The Atlantic & Vine team',
    'atlanticandvine.com'
  ].join('\n');

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#0f0f0f;color:#e8e8e8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#0f0f0f;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;background:#1a1a1a;border:1px solid #333;border-radius:8px;padding:32px;">
          <tr>
            <td style="padding-bottom:24px;border-bottom:1px solid #333;">
              <div style="font-size:11px;letter-spacing:1.6px;text-transform:uppercase;color:#b8b8b8;">Atlantic &amp; Vine</div>
              <div style="font-size:20px;font-weight:600;color:#d4af37;margin-top:4px;">Client Portal</div>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 0 16px;">
              <p style="margin:0 0 16px;font-size:16px;color:#e8e8e8;">Hi ${escapeHtml(name)},</p>
              <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#e8e8e8;">
                ${params.isFirstTime
                  ? 'Welcome to Atlantic &amp; Vine. Your client portal is ready. Click the button below to open it and set your password.'
                  : 'Click the button below to sign in to your Atlantic &amp; Vine portal.'}
              </p>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:8px 0 24px;">
              <a href="${escapeHtml(params.magicLinkUrl)}"
                 style="display:inline-block;background:#d4af37;color:#0f0f0f;text-decoration:none;font-weight:700;padding:14px 28px;border-radius:6px;font-size:15px;">
                ${escapeHtml(cta)}
              </a>
            </td>
          </tr>
          <tr>
            <td style="padding:0 0 16px;">
              <p style="margin:0 0 8px;font-size:13px;color:#b8b8b8;">
                Or paste this URL into your browser:
              </p>
              <p style="margin:0;font-size:12px;color:#8a8a8a;word-break:break-all;">
                ${escapeHtml(params.magicLinkUrl)}
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding-top:24px;border-top:1px solid #333;">
              <p style="margin:0 0 8px;font-size:12px;color:#8a8a8a;">
                This link expires in ${params.expiresInHours} hours and can only be used once.
              </p>
              <p style="margin:0;font-size:12px;color:#8a8a8a;">
                If you didn&apos;t request this, you can safely ignore this email.
              </p>
            </td>
          </tr>
        </table>
        <p style="font-size:11px;color:#8a8a8a;margin-top:16px;">
          Atlantic &amp; Vine &middot; <a href="https://atlanticandvine.com" style="color:#d4af37;text-decoration:none;">atlanticandvine.com</a>
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, text, html };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
