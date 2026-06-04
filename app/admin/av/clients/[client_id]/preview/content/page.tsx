/**
 * /admin/av/clients/[client_id]/preview/content  (#419)
 *
 * V3 mirror of /client/content (Content Studio). Renders the SAME ContentStudio
 * body the client sees, with server-rendered items (operator session can't
 * hit /api/client/* and would 401) and preview=true (disables Approve/Edit/
 * Reject so val doesn't accidentally trigger client-side writes from the
 * operator surface).
 *
 * The body itself is identical to the live client view — it cannot drift.
 * Wraps in <div data-skin="social"> so the V3 CSS scopes hit on the operator
 * route, with the navy skin + component CSS imported here too.
 */
import { headers } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import { getAvDb } from '@/lib/db/av';
import type { RowDataPacket } from 'mysql2';
import { listClientReviewQueue } from '@/lib/client/social_review';
import ContentStudio from '@/app/client/content/ContentStudio';
import ClientV3TopNav from '@/app/client/_components/ClientV3TopNav';
import OperatorPreviewChrome from '@/app/admin/av/clients/[client_id]/preview/_components/OperatorPreviewChrome';
import '@/app/client/skin.social.css';
import '@/app/client/client-social.css';
import '@/app/client/content/content.css';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ClientRow extends RowDataPacket {
  client_name: string | null;
}

export default async function PreviewContentMirror({ params }: { params: { client_id: string } }) {
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

  // Server-render the queue (operator session works here; the /api/client/*
  // endpoint would 401). Identical data to what the client sees.
  let items: Awaited<ReturnType<typeof listClientReviewQueue>> = [];
  try {
    items = await listClientReviewQueue(clientId);
  } catch {
    items = [];
  }

  return (
    <div data-skin="social">
      <OperatorPreviewChrome
        clientId={clientId}
        clientName={clientName}
        active="content"
        bannerLine={
          <span style={{ opacity: 0.85 }}>
            Read-only — clients approve from <code>/client/content</code>.
          </span>
        }
      />
      <main className="v3-wrap" style={{ maxWidth: 760 }}>
        <ClientV3TopNav preview />
        <ContentStudio items={items} firstName={firstName} preview />
      </main>
    </div>
  );
}
