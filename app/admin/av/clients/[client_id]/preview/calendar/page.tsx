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
import '@/app/client/skin.social.css';
import '@/app/client/client-social.css';
import '@/app/client/calendar/calendar.css';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ClientRow extends RowDataPacket {
  client_name: string | null;
}
interface OutboxRow extends RowDataPacket {
  outbox_id: number;
  scheduled_for: Date | string | null;
  channel: string | null;
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

  const items: CalItem[] = [];
  try {
    const [outbox] = await db.execute<OutboxRow[]>(
      `SELECT outbox_id, scheduled_for, channel, body_text, status
         FROM social_outbox
        WHERE client_id = ? AND status IN ('queued','scheduled','approved')
        ORDER BY scheduled_for ASC
        LIMIT 25`,
      [clientId]
    );
    for (const r of outbox) {
      items.push({
        id: `outbox-${r.outbox_id}`,
        whenISO: r.scheduled_for ? new Date(r.scheduled_for).toISOString() : null,
        kind: 'queued',
        channel: r.channel,
        title: (r.body_text ?? '').slice(0, 100) || 'Queued post',
        detail: r.status ?? null
      });
    }
  } catch { /* non-fatal */ }

  try {
    const tenant = `client:${clientId}`;
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
        whenISO: r.created_at ? new Date(r.created_at).toISOString() : null,
        kind: 'draft',
        channel: r.artifact_type,
        title: r.title ?? 'Untitled draft',
        detail: 'Awaiting review'
      });
    }
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
          <ClientCalendar items={items} />
        )}

        <p className="v3-foot">QUIET · LEGIBLE · VERIFIABLE</p>
      </main>
    </div>
  );
}
