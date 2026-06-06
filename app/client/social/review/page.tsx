/**
 * /client/social/review  — V3 (Velvet Royale chat, 2026-06-03)
 *
 * Client approval queue for queued social/commercial drafts. V3 shell
 * (ClientV3TopNav + Cormorant); ReviewQueue inherits the navy skin via the
 * token remap. No PortalHeader.
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
import { ReviewQueue } from './ReviewQueue';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function ClientSocialReviewPage() {
  // (val 2026-06-06) Retired — Content Studio (/client/content) is the ONE approve
  // queue. Two divergent queues over the same data was a hazard, so this route
  // redirects there. The code below is kept (unreachable) for reference.
  redirect('/client/content');

  const actor = readClientActorFromHeaders(headers() as unknown as Headers);
  if (!actor) redirect('/client/login');

  const user = await findClientUserById(actor.clientUserId);
  if (!user) redirect('/client/login');

  if (!user.client_id) {
    try {
      const cid = await ensureClientHub(user);
      if (cid) user.client_id = cid;
    } catch {
      /* non-fatal */
    }
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

  const items = clientId ? await listClientReviewQueue(clientId) : [];

  return (
    <main className="v3-wrap" style={{ maxWidth: 760 }}>
      <ClientV3TopNav />
      <section className="v3-greet">
        <p className="v3-eyebrow">Awaiting your approval</p>
        <h1 className="v3-h1">Ready for your <em>eyes.</em></h1>
        <p className="v3-lede" style={{ fontStyle: 'normal', fontSize: 16 }}>
          Commercials and posts queued for your approval. Approve to schedule for publish; pass to keep an angle off the feed.
        </p>
      </section>
      <ReviewQueue initialItems={items} />
      <p className="v3-foot" style={{ textAlign: 'left', marginTop: 28 }}>QUIET · LEGIBLE · VERIFIABLE</p>
    </main>
  );
}
