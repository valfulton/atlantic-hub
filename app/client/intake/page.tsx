/**
 * /client/intake — V3 (Velvet Royale chat, 2026-06-03)
 *
 * The logged-in client reviews + perfects the details A&V prefilled (the brief
 * in client-friendly language). V3 shell (ClientV3TopNav + Cormorant); the
 * ClientIntakeForm inherits the navy register via the skin's token remap.
 * No PortalHeader. Door A/B treatment (cream vs Royale) flows from the
 * two-doors routing — see V3_spec_entry_doors.md.
 */
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { readClientActorFromHeaders } from '@/lib/auth/client-session';
import { findClientUserById } from '@/lib/auth/client-user';
import { ensureClientHub } from '@/lib/client/provision';
import { activeBrandFor } from '@/lib/client/active-brand';
import { getBriefPayload } from '@/lib/client/brief_store';
import ClientV3TopNav from '@/app/client/_components/ClientV3TopNav';
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
    } catch {
      /* non-fatal */
    }
  }

  const clientId = await activeBrandFor(actor.clientUserId, user.client_id ?? null);

  let initial: Record<string, unknown> = {};
  if (clientId) {
    try {
      initial = (await getBriefPayload('av', clientId)) ?? {};
    } catch {
      initial = {};
    }
  }

  const brandName = user.display_name?.trim() || 'your business';

  return (
    <main className="v3-wrap">
      <ClientV3TopNav />
      <section className="v3-greet">
        <p className="v3-eyebrow">Your details</p>
        <h1 className="v3-h1">Tell us about <em>your business.</em></h1>
        <p className="v3-lede" style={{ fontStyle: 'normal', fontSize: 16 }}>
          Review and perfect what we&rsquo;ve prefilled for you. Every save keeps a restore point.
        </p>
      </section>
      <ClientIntakeForm initial={initial} brandName={brandName} />
      <p className="v3-foot" style={{ textAlign: 'left', marginTop: 28 }}>
        Signed in as {user.email}
      </p>
    </main>
  );
}
