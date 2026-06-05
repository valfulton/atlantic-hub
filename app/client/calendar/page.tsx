/**
 * /client/calendar  (#433, val 2026-06-05)
 *
 * Client-side calendar view — surfaces what's scheduled and what's queued
 * for review. v1 reads the social outbox + drafted content_artifacts scoped
 * to the active brand and groups by date. Honest empty state when nothing
 * is queued yet, so the nav promise is kept without faking it.
 *
 * Mirror lives at /admin/av/clients/[id]/preview/calendar — both nav arrays
 * must stay in sync per the mirror discipline (feedback_mirror_every_client_page).
 */
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { readClientActorFromHeaders } from '@/lib/auth/client-session';
import { findClientUserById } from '@/lib/auth/client-user';
import { ensureClientHub } from '@/lib/client/provision';
import { activeBrandFor } from '@/lib/client/active-brand';
import { getClientAccessState } from '@/lib/av/client_access';
import AccessPaused from '@/app/client/_components/AccessPaused';
import ClientV3TopNav from '@/app/client/_components/ClientV3TopNav';
import { resolveGreetingName } from '@/lib/client/display_name';
import { getAvDb } from '@/lib/db/av';
import type { RowDataPacket } from 'mysql2';
import ClientCalendar from './ClientCalendar';
import './calendar.css';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface CalendarItem {
  id: string;
  whenISO: string | null;
  kind: 'queued' | 'draft';
  channel: string | null;
  title: string;
  detail: string | null;
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

async function loadCalendar(clientId: number | null): Promise<CalendarItem[]> {
  if (!clientId) return [];
  const items: CalendarItem[] = [];
  try {
    const db = getAvDb();
    // Queued social posts — the "scheduled" side of the calendar.
    const [outbox] = await db.execute<OutboxRow[]>(
      `SELECT outbox_id, scheduled_for, channel, body_text, status
         FROM social_outbox
        WHERE client_id = ? AND status IN ('queued','scheduled','approved')
        ORDER BY scheduled_for ASC
        LIMIT 25`,
      [clientId]
    );
    for (const r of outbox) {
      const when = r.scheduled_for ? new Date(r.scheduled_for).toISOString() : null;
      items.push({
        id: `outbox-${r.outbox_id}`,
        whenISO: when,
        kind: 'queued',
        channel: r.channel,
        title: (r.body_text ?? '').slice(0, 100) || 'Queued post',
        detail: r.status ?? null
      });
    }
  } catch { /* table may not exist for this tenant */ }

  try {
    const db = getAvDb();
    // Drafted artifacts in approval queue — the "needs your review" side.
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
      const when = r.created_at ? new Date(r.created_at).toISOString() : null;
      items.push({
        id: `artifact-${r.id}`,
        whenISO: when,
        kind: 'draft',
        channel: r.artifact_type,
        title: r.title ?? 'Untitled draft',
        detail: 'Awaiting your review'
      });
    }
  } catch { /* non-fatal */ }

  return items;
}

export default async function ClientCalendarPage() {
  const actor = readClientActorFromHeaders(headers() as unknown as Headers);
  if (!actor) redirect('/client/login');

  const user = await findClientUserById(actor.clientUserId);
  if (!user) redirect('/client/login');

  if (!user.client_id) {
    try {
      const cid = await ensureClientHub(user);
      if (cid) user.client_id = cid;
    } catch { /* non-fatal */ }
  }

  const clientId = await activeBrandFor(actor.clientUserId, user.client_id ?? null);

  if (clientId) {
    const access = await getClientAccessState(clientId);
    if (!access.active) return <AccessPaused expired={access.expired} />;
  }

  const firstName = await resolveGreetingName(user.display_name, clientId, 'there');
  const items = await loadCalendar(clientId);

  return (
    <main className="v3-wrap">
      <ClientV3TopNav />

      <section className="v3-greet">
        <p className="v3-eyebrow">YOUR CALENDAR</p>
        <h1 className="v3-h1">
          {firstName === 'there'
            ? 'What’s scheduled.'
            : <>What&apos;s on the wire, <em>{firstName}</em>.</>}
        </h1>
        <p className="v3-lede">
          Drafts awaiting your review and posts queued to go out. Nothing publishes without your nod.
        </p>
      </section>

      {items.length === 0 ? (
        <article className="v3-card">
          <h3 className="v3-card__h">Calendar&apos;s clear.</h3>
          <p className="v3-card__p">
            When your campaigns spawn content — a brief, a post, a press piece — it lands here
            for your review before anything goes out. Quiet today, building tomorrow.
          </p>
        </article>
      ) : (
        <ClientCalendar items={items} />
      )}

      <p className="v3-foot">QUIET · LEGIBLE · VERIFIABLE</p>
    </main>
  );
}
