/**
 * /admin/av/clients/[client_id]/preview/calendar  (#433, val 2026-06-05)
 *
 * Operator mirror of /client/calendar. Same data the client sees, scoped to
 * the URL's client_id. Server-renders the items because the operator cookie
 * can't hit /api/client/* (it'd 401). Read-only.
 */
import { headers } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import { getAvDb } from '@/lib/db/av';
import type { RowDataPacket } from 'mysql2';
import ClientV3TopNav from '@/app/client/_components/ClientV3TopNav';
import OperatorPreviewChrome from '@/app/admin/av/clients/[client_id]/preview/_components/OperatorPreviewChrome';
import ClientCalendar from '@/app/client/calendar/ClientCalendar';
import { getImportantDatesForWindow } from '@/lib/calendar/important_dates';
import '@/app/client/skin.social.css';
import '@/app/client/client-social.css';
import '@/app/client/calendar/calendar.css';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ClientRow extends RowDataPacket {
  client_name: string | null;
}
interface OutboxRow extends RowDataPacket {
  id: number;
  scheduled_for: Date | string | null;
  published_at: Date | string | null;
  created_at: Date | string | null;
  body_text: string | null;
  status: string | null;
}
interface ArtifactRow extends RowDataPacket {
  id: number;
  created_at: Date | string | null;
  artifact_type: string | null;
  title: string | null;
  status: string | null;
}

interface CalItem {
  id: string;
  outboxId: number | null;
  reschedulable: boolean;
  whenISO: string | null;
  kind: 'queued' | 'draft';
  channel: string | null;
  title: string;
  detail: string | null;
}

export default async function PreviewCalendarMirror({ params }: { params: { client_id: string } }) {
  const role = headers().get('x-ah-user-role') as 'owner' | 'staff' | 'client_user' | null;
  if (role === 'client_user') redirect('/admin');

  const clientId = Number.parseInt(params.client_id, 10);
  if (!Number.isFinite(clientId) || clientId <= 0) notFound();

  const db = getAvDb();
  const [crows] = await db.execute<ClientRow[]>(
    `SELECT client_name FROM clients WHERE client_id = ? LIMIT 1`,
    [clientId]
  );
  if (!crows[0]) notFound();
  const clientName = crows[0].client_name || `Client #${clientId}`;
  const firstName = clientName.split(/[ ,]/)[0];

  const tenant = `client:${clientId}`;
  const items: CalItem[] = [];
  try {
    // social_outbox is keyed by id + tenant_id (NOT client_id/outbox_id).
    const [outbox] = await db.execute<OutboxRow[]>(
      `SELECT id, scheduled_for, published_at, created_at, body_text, status
         FROM social_outbox
        WHERE tenant_id = ? AND status IN ('draft','scheduled','publishing','published')
          AND archived_at IS NULL
        ORDER BY COALESCE(scheduled_for, published_at, created_at) ASC
        LIMIT 100`,
      [tenant]
    );
    for (const r of outbox) {
      const whenRaw = r.scheduled_for || r.published_at || r.created_at;
      const st = r.status ?? '';
      items.push({
        id: `outbox-${r.id}`,
        outboxId: r.id,
        reschedulable: st === 'draft' || st === 'scheduled',
        whenISO: whenRaw ? new Date(whenRaw).toISOString() : null,
        kind: st === 'draft' ? 'draft' : 'queued',
        channel: null,
        title: (r.body_text ?? '').slice(0, 100) || 'Social post',
        detail: st
      });
    }
  } catch { /* non-fatal */ }

  try {
    const [drafts] = await db.execute<ArtifactRow[]>(
      `SELECT id, created_at, artifact_type, title, status
         FROM content_artifacts
        WHERE tenant_id = ? AND status = 'draft'
        ORDER BY created_at DESC
        LIMIT 25`,
      [tenant]
    );
    for (const r of drafts) {
      items.push({
        id: `artifact-${r.id}`,
        outboxId: null,
        reschedulable: false,
        whenISO: r.created_at ? new Date(r.created_at).toISOString() : null,
        kind: 'draft',
        channel: r.artifact_type,
        title: r.title ?? 'Untitled draft',
        detail: 'Awaiting review'
      });
    }
  } catch { /* non-fatal */ }

  let importantDates: { iso: string; label: string; kind?: string }[] = [];
  try {
    const y = new Date().getFullYear();
    const rows = await getImportantDatesForWindow({ tenant, fromIso: `${y}-01-01`, toIso: `${y + 1}-12-31` });
    importantDates = rows.map((r) => ({ iso: r.iso, label: r.label, kind: r.kind }));
  } catch { /* non-fatal */ }

  return (
    <div data-skin="social">
      <OperatorPreviewChrome
        clientId={clientId}
        clientName={clientName}
        active="calendar"
        bannerLine={<span>Read-only.</span>}
      />

      <main className="v3-wrap">
        <ClientV3TopNav preview />
        <section className="v3-greet">
          <p className="v3-eyebrow">YOUR CALENDAR</p>
          <h1 className="v3-h1">What&apos;s on the wire, <em>{firstName}</em>.</h1>
          <p className="v3-lede">
            Drafts awaiting your review and posts queued to go out.
          </p>
        </section>

        {items.length === 0 ? (
          <article className="v3-card">
            <h3 className="v3-card__h">Calendar&apos;s clear.</h3>
            <p className="v3-card__p">
              When your campaigns spawn content, it lands here for your review before anything goes out.
            </p>
          </article>
        ) : (
          <ClientCalendar items={items} importantDates={importantDates} preview />
        )}

        <p className="v3-foot">QUIET · LEGIBLE · VERIFIABLE</p>
      </main>
    </div>
  );
}
