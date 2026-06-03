/**
 * /client/social/review   (#61 Inc 3)
 *
 * The client's approval queue for line-born social drafts the operator has
 * queued for them. Each row shows: branded video preview, caption, target
 * platform, the narrative line it advances — plus Approve / Reject buttons.
 *
 * Approval lifecycle (lib/client/social_review.ts):
 *   draft (queued)  ── approve ──>  scheduled (publisher picks up)
 *                   ── reject  ──>  canceled (kept as audit/learning signal)
 *
 * Scoped strictly to the client's active brand (multi-brand owners use the
 * brand switcher to see CBB-vs-CLDA review queues separately).
 */
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { readClientActorFromHeaders } from '@/lib/auth/client-session';
import { findClientUserById } from '@/lib/auth/client-user';
import { ensureClientHub } from '@/lib/client/provision';
import { activeBrandFor } from '@/lib/client/active-brand';
import { getClientAccessState } from '@/lib/av/client_access';
import { listClientReviewQueue } from '@/lib/client/social_review';
import PortalHeader from '@/app/client/_components/PortalHeader';
import AccessPaused from '@/app/client/_components/AccessPaused';
import { ReviewQueue } from './ReviewQueue';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function ClientSocialReviewPage() {
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
        <>
          <PortalHeader displayName={user.display_name} email={user.email} tier={user.tier} active="review" />
          <AccessPaused expired={access.expired} />
        </>
      );
    }
  }

  const items = clientId ? await listClientReviewQueue(clientId) : [];

  return (
    <>
      <PortalHeader displayName={user.display_name} email={user.email} tier={user.tier} active="review" />
      <main className="w-full max-w-4xl mx-auto px-3 sm:px-4 py-6 sm:py-10">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold text-ink">To Review</h1>
          <p className="text-sm text-muted mt-1 max-w-2xl">
            Commercials and social posts queued for your approval. Approve to
            schedule for publish; reject to keep this angle off the feed.
          </p>
        </header>
        <ReviewQueue initialItems={items} />
      </main>
    </>
  );
}
