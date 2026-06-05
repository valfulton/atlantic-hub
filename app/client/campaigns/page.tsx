/**
 * /client/campaigns  (#433, val 2026-06-05)
 *
 * Client-side campaigns view — surfaces the narrative-line spine scoped to
 * the active brand. v1 ships as a real route with the v3 shell + an honest
 * empty-state when no campaigns have been spawned yet, so the nav promise
 * is kept (no 404) without faking content the client hasn't earned. Real
 * content wiring lands in a follow-up bundle (the cascade-to-content recipe
 * + auto-spawn from watchlist signals).
 *
 * Mirror lives at /admin/av/clients/[id]/preview/campaigns — per the nav-tab
 * mirror discipline. Updating one without the other is a memory rule
 * violation.
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

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface CampaignRow extends RowDataPacket {
  lane_id: number;
  name: string | null;
  thesis: string | null;
  state: string | null;
}

async function loadCampaigns(clientId: number | null): Promise<CampaignRow[]> {
  if (!clientId) return [];
  try {
    const db = getAvDb();
    const [rows] = await db.execute<CampaignRow[]>(
      `SELECT lane_id, name, thesis, state
         FROM narrative_lanes
        WHERE client_id = ? AND state IN ('active', 'reinforcing')
        ORDER BY updated_at DESC
        LIMIT 8`,
      [clientId]
    );
    return rows;
  } catch {
    return [];
  }
}

export default async function ClientCampaignsPage() {
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
  const campaigns = await loadCampaigns(clientId);

  return (
    <main className="v3-wrap">
      <ClientV3TopNav />

      <section className="v3-greet">
        <p className="v3-eyebrow">YOUR CAMPAIGNS</p>
        <h1 className="v3-h1">
          {firstName === 'there'
            ? 'Your campaigns.'
            : <>The story you&apos;re telling, <em>{firstName}</em>.</>}
        </h1>
        <p className="v3-lede">
          Every piece of outreach, every post, every press hit — anchored to the lines you stand for.
        </p>
      </section>

      {campaigns.length === 0 ? (
        <article className="v3-card">
          <h3 className="v3-card__h">Your campaigns are taking shape.</h3>
          <p className="v3-card__p">
            We&apos;re assembling the narrative lines from your intake — what you stand for,
            who you serve, the moments worth marking. Each one becomes a campaign you
            approve before anything goes out. Check back here once they&apos;re ready for your eyes.
          </p>
        </article>
      ) : (
        <section className="v3-grid">
          {campaigns.map((c) => (
            <article key={c.lane_id} className="v3-card">
              <h3 className="v3-card__h">{c.name ?? 'Untitled campaign'}</h3>
              <p className="v3-card__p">{c.thesis ?? 'Thesis pending — refining from your intake.'}</p>
            </article>
          ))}
        </section>
      )}

      <p className="v3-foot">QUIET · LEGIBLE · VERIFIABLE</p>
    </main>
  );
}
