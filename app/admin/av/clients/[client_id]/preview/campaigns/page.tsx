/**
 * /admin/av/clients/[client_id]/preview/campaigns  (#433, val 2026-06-05)
 *
 * Operator mirror of /client/campaigns. Renders the same view scoped to the
 * specified client so val can SEE what each client sees from her own session
 * (per the mirror-every-client-page rule).
 *
 * Server-renders the campaigns list directly (operator cookie can't hit the
 * /api/client/* endpoints — they'd 401). Same data the client sees on the
 * live route. data-skin="social" wraps so v3-* CSS scopes resolve here too.
 */
import { headers } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import { getAvDb } from '@/lib/db/av';
import type { RowDataPacket } from 'mysql2';
import ClientV3TopNav from '@/app/client/_components/ClientV3TopNav';
import OperatorPreviewChrome from '@/app/admin/av/clients/[client_id]/preview/_components/OperatorPreviewChrome';
import '@/app/client/skin.social.css';
import '@/app/client/client-social.css';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ClientRow extends RowDataPacket {
  client_name: string | null;
}
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
const KIND_LABEL: Record<DraftRow['approval_kind'], string> = {
  press_release: 'Press release',
  op_ed: 'Op-ed',
  social: 'Social post',
  commercial: 'Commercial'
};

export default async function PreviewCampaignsMirror({ params }: { params: { client_id: string } }) {
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

  let campaigns: (CampaignRow & { drafts: DraftRow[] })[] = [];
  try {
    const [rows] = await db.execute<CampaignRow[]>(
      `SELECT lane_id, name, thesis, state
         FROM narrative_lanes
        WHERE client_id = ? AND state IN ('active', 'reinforcing')
        ORDER BY updated_at DESC
        LIMIT 8`,
      [clientId]
    );
    // (#701) Join drafts under each campaign — mirror of /client/campaigns fix.
    let draftRows: DraftRow[] = [];
    if (rows.length > 0) {
      const laneIds = rows.map((r) => r.lane_id);
      const placeholders = laneIds.map(() => '?').join(',');
      const [drows] = await db.execute<DraftRow[]>(
        `SELECT approval_id, narrative_line_id, approval_kind, title, status
           FROM cockpit_approvals
          WHERE client_id = ?
            AND narrative_line_id IN (${placeholders})
            AND status IN ('pending','approved','published')
          ORDER BY FIELD(status,'pending','approved','published'), created_at DESC`,
        [clientId, ...laneIds]
      );
      draftRows = drows;
    }
    campaigns = rows.map((r) => ({
      ...r,
      drafts: draftRows.filter((d) => d.narrative_line_id === r.lane_id)
    }));
  } catch {
    campaigns = [];
  }

  return (
    <div data-skin="social">
      <OperatorPreviewChrome
        clientId={clientId}
        clientName={clientName}
        active="campaigns"
        bannerLine={<span>Read-only.</span>}
      />

      <main className="v3-wrap">
        <ClientV3TopNav preview />
        <section className="v3-greet">
          <p className="v3-eyebrow">YOUR CAMPAIGNS</p>
          <h1 className="v3-h1">The story you&apos;re telling, <em>{firstName}</em>.</h1>
          <p className="v3-lede">
            Every piece of outreach, every post, every press hit — anchored to the lines you stand for.
          </p>
        </section>

        {campaigns.length === 0 ? (
          <article className="v3-card">
            <h3 className="v3-card__h">Your campaigns are taking shape.</h3>
            <p className="v3-card__p">
              We&apos;re assembling the narrative lines from your intake. Each one becomes a campaign
              you approve before anything goes out.
            </p>
          </article>
        ) : (
          <section className="v3-grid">
            {campaigns.map((c) => {
              const pending = c.drafts.filter((d) => d.status === 'pending').length;
              return (
                <article key={c.lane_id} className="v3-card">
                  <h3 className="v3-card__h">{c.name ?? 'Untitled campaign'}</h3>
                  <p className="v3-card__p">{c.thesis ?? 'Thesis pending.'}</p>
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
                            <span>{d.title}</span>
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
    </div>
  );
}
