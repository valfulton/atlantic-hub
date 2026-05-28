/**
 * /client/intake — the logged-in client reviews + perfects the details Atlantic &
 * Vine prefilled for them (the brief, in client-friendly language). Loads the
 * effective brief payload for their client_id and renders an editable, prefilled
 * form. Saving snapshots a restore point (see /api/client/intake-update).
 *
 * Protected by middleware (matcher '/client/intake').
 */
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { readClientActorFromHeaders } from '@/lib/auth/client-session';
import { findClientUserById } from '@/lib/auth/client-user';
import { ensureClientHub } from '@/lib/client/provision';
import { activeBrandFor } from '@/lib/client/active-brand';
import { getBriefPayload } from '@/lib/client/brief_store';
import PortalHeader from '@/app/client/_components/PortalHeader';
import ClientIntakeForm from './ClientIntakeForm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function ClientIntakePage() {
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

  // Multi-brand (#101): edit the brief of the brand currently being viewed.
  const clientId = await activeBrandFor(actor.clientUserId, user.client_id ?? null);

  let initial: Record<string, unknown> = {};
  if (clientId) {
    try {
      initial = (await getBriefPayload('av', clientId)) ?? {};
    } catch { initial = {}; }
  }

  const brandName = user.display_name?.trim() || 'your business';

  return (
    <>
      <PortalHeader displayName={user.display_name} email={user.email} tier={user.tier} active="details" />
      <main className="max-w-4xl mx-auto px-4 py-8 sm:py-10">
        <ClientIntakeForm initial={initial} brandName={brandName} />
      </main>
    </>
  );
}
