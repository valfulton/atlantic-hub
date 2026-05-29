/**
 * ClientInfluenceCard  (#98)
 *
 * A compact, read-only "what this client cares about" panel for surfaces where
 * val writes content FOR a client (PR desk, narrative line editor, social
 * drafter). Renders directly from the brief seed — no AI call — so the answer
 * is immediate and free.
 *
 * Use it anywhere a client_id is in scope and val is about to write something
 * the client's voice/topics/outlets should shape. Server component: pass a
 * resolved clientId from the parent route.
 */
import Link from 'next/link';
import { getBriefSeed } from '@/lib/client/brief_store';
import { getAvDb } from '@/lib/db/av';
import type { RowDataPacket } from 'mysql2';

interface ClientRow extends RowDataPacket { client_name: string | null }

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value || !value.trim()) return null;
  return (
    <div>
      <div className="text-[9.5px] uppercase tracking-[0.16em] text-white/45 mb-0.5">{label}</div>
      <div className="text-[12px] text-white/85 leading-relaxed">{value.trim()}</div>
    </div>
  );
}

export default async function ClientInfluenceCard({
  clientId,
  tenantId = 'av',
  variant = 'standalone',
  className = ''
}: {
  clientId: number | null;
  tenantId?: string;
  /** 'standalone' for a full card; 'inline' for a flatter, no-border panel inside another card. */
  variant?: 'standalone' | 'inline';
  className?: string;
}) {
  if (!clientId) return null;

  const db = getAvDb();
  let clientName = `Client #${clientId}`;
  try {
    const [rows] = await db.execute<ClientRow[]>(
      `SELECT client_name FROM clients WHERE client_id = ? LIMIT 1`,
      [clientId]
    );
    if (rows[0]?.client_name) clientName = rows[0].client_name;
  } catch {
    /* non-fatal */
  }

  const seed = await getBriefSeed(tenantId, clientId);

  const wrapper =
    variant === 'inline'
      ? 'rounded-xl border border-amber-400/15 bg-amber-400/[0.03] p-3'
      : 'rounded-2xl border border-border bg-surface p-4';

  if (!seed) {
    return (
      <div className={`${wrapper} ${className}`}>
        <div className="text-[11px] uppercase tracking-[0.12em] text-amber-300/70 mb-1">
          {clientName} — influence
        </div>
        <div className="text-[12px] text-white/55 italic">
          No brief on file yet. <Link href={`/admin/av/brief?clientId=${clientId}`} className="text-amber-300/85 hover:underline">Add their brief</Link> so the content engine grounds in their voice.
        </div>
      </div>
    );
  }

  return (
    <div className={`${wrapper} ${className}`}>
      <div className="flex items-baseline justify-between gap-3 mb-2.5 flex-wrap">
        <div>
          <div className="text-[11px] uppercase tracking-[0.12em] text-amber-300/85">
            {clientName} — influence
          </div>
          <div className="text-[10.5px] text-white/45 mt-0.5">
            What to ground in when you write for them.
          </div>
        </div>
        <Link
          href={`/admin/av/brief?clientId=${clientId}`}
          className="text-[10px] uppercase tracking-wider text-white/50 hover:text-amber-300 transition shrink-0"
        >
          Edit brief →
        </Link>
      </div>

      <div className="grid sm:grid-cols-2 gap-x-4 gap-y-2.5">
        <Field label="Key message" value={seed.keyMessage} />
        <Field label="Brand voice" value={seed.brandVoice} />
        <Field label="Authority topics" value={seed.prExpertTopics} />
        <Field label="Dream outlets" value={seed.prDreamOutlets} />
        <Field label="Spokesperson" value={seed.prSpokesperson} />
        <Field label="Timely hooks" value={seed.prNewsHooks} />
      </div>
    </div>
  );
}
