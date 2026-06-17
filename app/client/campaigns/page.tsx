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

interface DraftRow extends RowDataPacket {
  approval_id: number;
  narrative_line_id: number | null;
  approval_kind: 'press_release' | 'social' | 'commercial' | 'op_ed';
  title: string;
  status: 'pending' | 'approved' | 'published' | 'killed';
}

interface CampaignWithDrafts extends CampaignRow {
  drafts: DraftRow[];
}

async function loadCampaigns(clientId: number | null): Promise<CampaignWithDrafts[]> {
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
    if (rows.length === 0) return [];
    // (val 2026-06-17, #701) Join the drafts. Was reading lanes only and
    // rendering them as empty thesis cards — the disconnect val flagged.
    // narrative_lanes.lane_id IS the id cockpit_approvals.narrative_line_id
    // references, per schema + the dashboard's JOIN.
    const laneIds = rows.map((r) => r.lane_id);
    const placeholders = laneIds.map(() => '?').join(',');
    const [draftRows] = await db.execute<DraftRow[]>(
      `SELECT approval_id, narrative_line_id, approval_kind, title, status
         FROM cockpit_approvals
        WHERE client_id = ?
          AND narrative_line_id IN (${placeholders})
          AND status IN ('pending','approved','published')
        ORDER BY FIELD(status,'pending','approved','published'), created_at DESC`,
      [clientId, ...laneIds]
    );
    return rows.map((r) => ({
      ...r,
      drafts: draftRows.filter((d) => d.narrative_line_id === r.lane_id)
    }));
  } catch {
    return [];
  }
}

const KIND_LABEL: Record<DraftRow['approval_kind'], string> = {
  press_release: 'Press release',
  op_ed: 'Op-ed',
  social: 'Social post',
  commercial: 'Commercial'
};

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

  const campaigns = await loadCampaigns(clientId);

  return (
    <main className="v3-wrap">
      <ClientV3TopNav />

      <section className="v3-greet">
        <p className="v3-eyebrow">Your campaigns</p>
        {/* (val 2026-06-14) Neutral headline. The prior second-person line
            ("The story you're telling, Johnson") addressed a case-shaped client
            by its truncated brand nickname — a naming-drift bug. A campaign list
            is a workspace, not a personalized salutation. */}
        <h1 className="v3-h1">Your campaigns.</h1>
        <p className="v3-lede">
          Every piece of outreach, every post, every press hit — anchored to the lines you stand for.
        </p>
      </section>

      {campaigns.length === 0 ? (
        <article className="v3-card">
          <h3 className="v3-card__h">No campaigns yet.</h3>
          <p className="v3-card__p">
            A campaign is a through-line — the message you keep returning to across your
            outreach, posts, and press. They build from your brief. Finish yours and we&apos;ll
            line up the first campaigns here for your approval.
          </p>
          <a href="/client/intake" style={{ color: 'var(--emerald-deep)', fontWeight: 600, textDecoration: 'underline', textUnderlineOffset: 2, display: 'inline-block', marginTop: 10 }}>
            Complete your brief →
          </a>
        </article>
      ) : (
        <section className="v3-grid">
          {campaigns.map((c) => {
            const pending = c.drafts.filter((d) => d.status === 'pending').length;
            return (
              <article key={c.lane_id} className="v3-card">
                <h3 className="v3-card__h">{c.name ?? 'Untitled campaign'}</h3>
                <p className="v3-card__p">{c.thesis ?? 'Thesis pending — refining from your intake.'}</p>
                {c.drafts.length > 0 && (
                  <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--card-border)' }}>
                    <div style={{ fontFamily: 'var(--sans)', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-mute, #5F5E5A)', marginBottom: 8 }}>
                      {c.drafts.length} piece{c.drafts.length === 1 ? '' : 's'}
                      {pending > 0 ? ` · ${pending} waiting on you` : ''}
                    </div>
                    <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 6 }}>
                      {c.drafts.slice(0, 8).map((d) => (
                        <li key={d.approval_id} style={{ fontFamily: 'var(--sans)', fontSize: 13, color: 'var(--ink)' }}>
                          <span style={{ display: 'inline-block', minWidth: 92, fontSize: 11, color: 'var(--ink-mute, #5F5E5A)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                            {KIND_LABEL[d.approval_kind]}
                          </span>
                          <a href={`/client/dashboard#draft-${d.approval_id}`} style={{ color: 'var(--emerald-deep)', textDecoration: 'none' }}>
                            {d.title}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </article>
            );
          })}
        </section>
      )}

      <p className="v3-foot">QUIET · LEGIBLE · VERIFIABLE</p>
    </main>
  );
}
