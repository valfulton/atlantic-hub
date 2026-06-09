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
import { getEngagementKind } from '@/lib/client/engagement_kind';
import ClientV3TopNav from '@/app/client/_components/ClientV3TopNav';
import ClientIntakeForm from './ClientIntakeForm';
import { getCopyMap } from '@/lib/copy/store';
import { accent } from '@/lib/copy/accent';

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

  // (val 2026-06-07) Prefer COMPANY name from intake first — display_name is
  // the signed-in person, not their brand. We want "Let's make Circa Energy
  // shine", not "Let's make Chip Zenke shine".
  function pickFromInitial(...keys: string[]): string | null {
    for (const k of keys) {
      const v = (initial as Record<string, unknown>)[k];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return null;
  }
  const brandName =
    pickFromInitial('company', 'companyName', 'company_name', 'business_name', 'brandName', 'brand_name', 'business')
    || user.display_name?.trim()
    || 'your business';
  const copy = await getCopyMap(['intake.eyebrow', 'intake.h1', 'intake.lede'], { clientId: clientId ?? undefined });
  // (#551) Active engagement kind → filters which intake questions are asked.
  const engagementKind = await getEngagementKind({ clientId, clientUserId: actor.clientUserId });

  return (
    <main className="v3-wrap">
      <ClientV3TopNav />
      <section className="v3-greet">
        <p className="v3-eyebrow">{copy['intake.eyebrow']}</p>
        <h1 className="v3-h1">{accent(copy['intake.h1'], { brandName })}</h1>
        <p className="v3-lede" style={{ fontStyle: 'normal', fontSize: 16 }}>
          {copy['intake.lede']}
        </p>
      </section>
      <ClientIntakeForm initial={initial} brandName={brandName} engagementKind={engagementKind} />
      <p className="v3-foot" style={{ textAlign: 'left', marginTop: 28 }}>
        Signed in as {user.email}
      </p>
    </main>
  );
}
