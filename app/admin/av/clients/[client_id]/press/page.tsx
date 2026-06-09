/**
 * /admin/av/clients/[client_id]/press — Operator press touches surface (#550 v2)
 *
 * Where val logs every journalist outreach for this brand. The table view +
 * "+ Log press touch" form. Owner + staff only (client_users can NEVER reach
 * this — defense-PR exposure if a client sees the internal notes column).
 *
 * Reads listPressTouches + getPressTouchStatusSummary server-side, then hands
 * the array to PressTouchesEditor (client component) for the inline form and
 * status-update interactions.
 */
import { headers } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import { getAvDb } from '@/lib/db/av';
import {
  listPressTouches,
  countPressTouchesThisWeek,
  getPressTouchStatusSummary
} from '@/lib/client/press_touches';
import type { RowDataPacket } from 'mysql2';
import PressTouchesEditor from './PressTouchesEditor';

export const dynamic = 'force-dynamic';

interface ClientRow extends RowDataPacket {
  client_id: number;
  client_name: string;
  short_name: string | null;
  industry: string | null;
}

export default async function PressPage({ params }: { params: { client_id: string } }) {
  const role = headers().get('x-ah-user-role') as 'owner' | 'staff' | 'client_user' | null;
  if (role === 'client_user') redirect('/client/dashboard');

  const clientId = Number.parseInt(params.client_id, 10);
  if (!Number.isFinite(clientId) || clientId <= 0) notFound();

  const db = getAvDb();
  const [rows] = await db.execute<ClientRow[]>(
    `SELECT client_id, client_name, short_name, industry
       FROM clients WHERE client_id = ? LIMIT 1`,
    [clientId]
  );
  if (rows.length === 0) notFound();
  const client = rows[0];

  // Parallel fetch — three reads, one round-trip's worth of latency.
  const [touches, weekCount, summary] = await Promise.all([
    listPressTouches(clientId, 50),
    countPressTouchesThisWeek(clientId),
    getPressTouchStatusSummary(clientId)
  ]);

  return (
    <div className="max-w-[1440px]">
      <div style={{ marginBottom: '1rem' }}>
        <div
          style={{
            fontSize: 11,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            color: 'var(--gold-ink, #7A5A18)'
          }}
        >
          Press desk · {client.client_name}
          {client.short_name ? (
            <span
              style={{
                marginLeft: 8,
                padding: '2px 8px',
                background: 'var(--paper-soft, #F7F1E1)',
                borderRadius: 6,
                fontSize: 10
              }}
            >
              {client.short_name}
            </span>
          ) : null}
        </div>
        <h1
          style={{
            fontFamily: 'var(--serif, Fraunces, Cormorant Garamond, serif)',
            fontWeight: 500,
            fontSize: 28,
            margin: '6px 0 4px',
            color: 'var(--ink, #0A0A0A)'
          }}
        >
          Press touches
        </h1>
        <p style={{ fontSize: 14, color: 'var(--ink-soft, #5F5E5A)', margin: 0 }}>
          Log every journalist outreach. The client sees the live count + their
          published wins on their dashboard. They never see your internal notes.
        </p>
      </div>

      {/* Status summary strip */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(6, minmax(0, 1fr))',
          gap: 10,
          marginBottom: '1.5rem'
        }}
      >
        {[
          { k: 'drafted',     label: 'Drafted',     bg: 'var(--paper-soft, #F7F1E1)',  fg: 'var(--ink-soft, #5F5E5A)' },
          { k: 'pitched',     label: 'Pitched',     bg: 'var(--harbor-soft, #E6F1FB)', fg: 'var(--harbor-deep, #0C447C)' },
          { k: 'replied',     label: 'Replied',     bg: 'var(--mint-soft, #E1F5EE)',   fg: 'var(--emerald-deep, #085041)' },
          { k: 'published',   label: 'Published',   bg: 'var(--gold-soft, #FAEEDA)',   fg: 'var(--gold-ink, #633806)' },
          { k: 'declined',    label: 'Declined',    bg: 'var(--rose-soft, #FBEAF0)',   fg: 'var(--rose-ink, #72243E)' },
          { k: 'no_response', label: 'No response', bg: 'var(--paper-soft, #F7F1E1)',  fg: 'var(--ink-soft, #5F5E5A)' }
        ].map((c) => (
          <div
            key={c.k}
            style={{
              background: c.bg,
              borderRadius: 10,
              padding: '10px 12px',
              color: c.fg
            }}
          >
            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.85 }}>
              {c.label}
            </div>
            <div style={{ fontSize: 20, fontWeight: 500, marginTop: 2 }}>
              {(summary as Record<string, number>)[c.k] ?? 0}
            </div>
          </div>
        ))}
      </div>

      <div style={{ fontSize: 13, color: 'var(--ink-soft, #5F5E5A)', marginBottom: 10 }}>
        {weekCount} touches this week · {touches.length} total visible
      </div>

      <PressTouchesEditor clientId={clientId} initialTouches={touches} />
    </div>
  );
}
