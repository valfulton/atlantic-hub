/**
 * /api/admin/av/copy  (newsroom team, 2026-06-04)
 *
 * Operator-editable site copy (the general-purpose sibling of /popups).
 *   GET    ?clientId=&stage=  → every copy key with its DEFAULT + the override
 *                              at THIS exact (clientId, stage), plus the client list.
 *   POST   { key, value, clientId?, stage? }  → upsert an override
 *   DELETE { key, clientId?, stage? }          → remove an override (Reset)
 *
 * Owner/staff only — same gate as /api/admin/av/popups.
 */
import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { getAvDb } from '@/lib/db/av';
import type { RowDataPacket } from 'mysql2';
import { DEFAULTS, COPY_KEYS, saveCopy, clearCopy } from '@/lib/copy/store';
import { getEngagementKind, ENGAGEMENT_KIND_CONFIG } from '@/lib/client/engagement_kind';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function requireOperator(): NextResponse | null {
  const role = headers().get('x-ah-user-role');
  if (role !== 'owner' && role !== 'staff') {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
  }
  return null;
}
function actor(): string {
  return headers().get('x-ah-user-email') || headers().get('x-ah-user-role') || 'operator';
}

const GROUP_LABEL: Record<string, string> = {
  newsroom: 'Newsroom', channel: 'Channel', dashboard: 'Dashboard', leads: 'Leads',
  watchlist: 'Watchlist', pr: 'Press', welcome: 'Welcome', audit: 'Audit', intake: 'Intake', login: 'Login', footer: 'Footer',
};
const groupOf = (key: string) => {
  if (key.startsWith('newsroom.footer')) return 'Footer';
  return GROUP_LABEL[key.split('.')[0]] || 'Other';
};

interface OverrideRow extends RowDataPacket { copy_key: string; value_text: string }
interface ClientRow extends RowDataPacket { id: number; client_name: string }

export async function GET(req: NextRequest) {
  const forbidden = requireOperator();
  if (forbidden) return forbidden;

  const sp = req.nextUrl.searchParams;
  const clientId = sp.get('clientId') ? Number(sp.get('clientId')) : 0;   // 0 = global
  const stage = sp.get('stage') || '';                                     // '' = any

  const db = getAvDb();

  // Overrides at THIS exact context (so the editor can show + Reset them).
  const [ov] = await db.execute<OverrideRow[]>(
    `SELECT copy_key, value_text FROM site_copy WHERE client_id = ? AND stage = ?`,
    [clientId, stage]
  );
  const overrides = new Map(ov.map((r) => [r.copy_key, r.value_text]));

  // Client list for the selector.
  let clients: { id: number; name: string }[] = [];
  try {
    const [cl] = await db.execute<ClientRow[]>(
      `SELECT id, client_name FROM clients ORDER BY client_name LIMIT 300`
    );
    clients = cl.map((c) => ({ id: c.id, name: c.client_name }));
  } catch { /* clients table shape differs → editor still works on global */ }

  // (#551) Welcome popover keys are kind-namespaced (welcome.<kind>.sN). When a
  // specific client is picked, show ONLY that client's engagement-kind welcome
  // keys (plus all the non-welcome keys). On global defaults (clientId 0) show
  // every welcome key so val can edit each kind's default.
  let allowedWelcome: Set<string> | null = null;
  if (clientId !== 0) {
    const kind = await getEngagementKind({ clientId });
    allowedWelcome = new Set(ENGAGEMENT_KIND_CONFIG[kind].welcomePopoverKeys);
  }

  const keys = COPY_KEYS
    .filter((key) => {
      if (!key.startsWith('welcome.')) return true;
      return allowedWelcome ? allowedWelcome.has(key) : true;
    })
    .map((key) => ({
      key,
      group: groupOf(key),
      def: DEFAULTS[key] ?? '',
      value: overrides.get(key) ?? '',     // '' = no override at this context
    }));

  return NextResponse.json({ ok: true, context: { clientId, stage }, clients, keys });
}

export async function POST(req: NextRequest) {
  const forbidden = requireOperator();
  if (forbidden) return forbidden;
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'bad_json' }, { status: 400 }); }
  const key = typeof body?.key === 'string' ? body.key : '';
  const value = typeof body?.value === 'string' ? body.value : '';
  if (!key) return NextResponse.json({ ok: false, error: 'key_required' }, { status: 400 });
  const ctx = {
    clientId: body?.clientId ? Number(body.clientId) : undefined,
    stage: body?.stage ? String(body.stage) : undefined,
  };
  const written = await saveCopy(key, value, ctx, actor());
  return NextResponse.json({ ok: true, written });
}

export async function DELETE(req: NextRequest) {
  const forbidden = requireOperator();
  if (forbidden) return forbidden;
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'bad_json' }, { status: 400 }); }
  const key = typeof body?.key === 'string' ? body.key : '';
  if (!key) return NextResponse.json({ ok: false, error: 'key_required' }, { status: 400 });
  await clearCopy(key, {
    clientId: body?.clientId ? Number(body.clientId) : undefined,
    stage: body?.stage ? String(body.stage) : undefined,
  });
  return NextResponse.json({ ok: true });
}
