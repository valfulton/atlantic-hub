/**
 * /client/content — the Content Studio.
 *
 * The client's generated content, threaded as true-to-platform social posts
 * (LinkedIn / Instagram / X / Facebook), with Approve · Edit · Reject. Reuses
 * the existing review queue (listClientReviewQueue) + decide endpoint — same
 * data + gate as /client/social/review, re-rendered as the social feed val
 * approved. Pulls the campaign (narrative line) each post advances.
 *
 * Auth + clientId resolution mirror the other /client/* pages. The operator
 * mirror is /admin/av/clients/[id]/preview/content (same component).
 */
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { readClientActorFromHeaders } from '@/lib/auth/client-session';
import { findClientUserById } from '@/lib/auth/client-user';
import { ensureClientHub } from '@/lib/client/provision';
import { activeBrandFor } from '@/lib/client/active-brand';
import { getClientAccessState } from '@/lib/av/client_access';
import { listClientReviewQueue } from '@/lib/client/social_review';
import AccessPaused from '@/app/client/_components/AccessPaused';
import ClientV3TopNav from '@/app/client/_components/ClientV3TopNav';
import ContentStudio from './ContentStudio';
import { resolveGreetingName } from '@/lib/client/display_name';
import './content.css';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function ClientContentPage() {
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
    if (!access.active) {
      return (
        <main className="v3-wrap">
          <ClientV3TopNav />
          <AccessPaused expired={access.expired} />
        </main>
      );
    }
  }

  // (#420) Brand-aware greeting — never address the human by their company name.
  const firstName = await resolveGreetingName(user.display_name, clientId, '');
  const items = clientId ? await listClientReviewQueue(clientId) : [];

  return (
    <main className="v3-wrap" style={{ maxWidth: 760 }}>
      <ClientV3TopNav />
      <ContentStudio items={items} firstName={firstName} />
    </main>
  );
}
