/**
 * CORS helpers for /api/client/intake.
 *
 * The marketing site at atlanticandvine.netlify.app POSTs the
 * client-intake form directly to atlantic-hub.netlify.app/api/client/intake.
 * That's cross-origin, so we need an explicit allow list.
 *
 * Configure via env:
 *   PORTAL_ALLOWED_ORIGINS = comma-separated list, e.g.
 *     "https://atlanticandvine.netlify.app,https://atlanticandvine.com"
 *
 * Falls back to the marketing-site origin if unset.
 */
const DEFAULT_ALLOWED = [
  'https://atlanticandvine.netlify.app',
  'https://atlanticandvine.com',
  'https://www.atlanticandvine.com'
];

function allowedOrigins(): string[] {
  const raw = process.env.PORTAL_ALLOWED_ORIGINS;
  if (!raw) return DEFAULT_ALLOWED;
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function corsHeadersFor(origin: string | null): Record<string, string> {
  const allowed = allowedOrigins();
  // Echo the origin back only if it's on the allow list. This is stricter
  // than '*' and required when we ever add Allow-Credentials.
  const allowOrigin = origin && allowed.includes(origin) ? origin : allowed[0] || '';
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
  };
}
