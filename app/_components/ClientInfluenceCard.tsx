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
import { getBriefSeed, getBriefPayload } from '@/lib/client/brief_store';
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

/** (#243) Color swatches row, derived from brand_colors CSV. Renders nothing
 *  when no recognizable hex codes are present. */
function ColorSwatches({ raw }: { raw: string | null | undefined }) {
  if (!raw) return null;
  const hexes = raw.split(',').map((c) => c.trim()).filter((c) => /^#[0-9a-fA-F]{6}$/.test(c));
  if (hexes.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {hexes.map((hex) => (
        <span
          key={hex}
          className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-black/25 px-1.5 py-0.5 text-[10px] font-mono text-white/80"
          title={hex}
        >
          <span
            aria-hidden="true"
            className="inline-block h-3 w-3 rounded-sm border border-white/15"
            style={{ background: hex }}
          />
          {hex}
        </span>
      ))}
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
  // (#243) Pull the raw brief payload too so we can surface the brand kit
  // fields (brand_aesthetic / brand_typography / logo_url) that aren't part
  // of the BriefSeed type. Non-fatal.
  let brandAesthetic: string | null = null;
  let brandTypography: string | null = null;
  let logoUrl: string | null = null;
  try {
    const payload = (await getBriefPayload(tenantId, clientId)) as Record<string, unknown> | null;
    if (payload) {
      if (typeof payload.brand_aesthetic === 'string') brandAesthetic = payload.brand_aesthetic.trim() || null;
      if (typeof payload.brand_typography === 'string') brandTypography = payload.brand_typography.trim() || null;
      if (typeof payload.logo_url === 'string') logoUrl = payload.logo_url.trim() || null;
    }
  } catch { /* non-fatal */ }

  const wrapper =
    variant === 'inline'
      ? 'rounded-xl border border-[#EBCB6B]/15 bg-[#EBCB6B]/[0.03] p-3'
      : 'rounded-2xl border border-border bg-surface p-4';

  if (!seed) {
    return (
      <div className={`${wrapper} ${className}`}>
        <div className="text-[11px] uppercase tracking-[0.12em] text-[#EBCB6B]/75 mb-1">
          {clientName} — influence
        </div>
        <div className="text-[12px] text-white/55 italic">
          No brief on file yet. <Link href={`/admin/av/brief?clientId=${clientId}`} className="text-[#EBCB6B]/85 hover:underline">Add their brief</Link> so the content engine grounds in their voice.
        </div>
      </div>
    );
  }

  return (
    <div className={`${wrapper} ${className}`}>
      <div className="flex items-baseline justify-between gap-3 mb-2.5 flex-wrap">
        <div>
          <div className="text-[11px] uppercase tracking-[0.12em] text-[#EBCB6B]/85">
            {clientName} — influence
          </div>
          <div className="text-[10.5px] text-white/45 mt-0.5">
            What to ground in when you write for them.
          </div>
        </div>
        <Link
          href={`/admin/av/brief?clientId=${clientId}`}
          className="text-[10px] uppercase tracking-wider text-white/50 hover:text-[#EBCB6B] transition shrink-0"
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

      {/* (#243) Visual brand kit row — colors, aesthetic, typography, logo
          thumb. Renders nothing for clients without brand kit data, so it
          quietly appears the first time the BrandKitPanel or autopilot fires. */}
      {(seed.brandColors || brandAesthetic || brandTypography || logoUrl) && (
        <div className="mt-3 pt-3 border-t border-white/5">
          <div className="text-[9.5px] uppercase tracking-[0.16em] text-[#EBCB6B]/75 mb-2">
            Visual identity
          </div>
          <div className="grid sm:grid-cols-2 gap-x-4 gap-y-2.5 items-start">
            {seed.brandColors && (
              <div className="space-y-1.5">
                <div className="text-[9.5px] uppercase tracking-[0.16em] text-white/45">Colors</div>
                <ColorSwatches raw={seed.brandColors} />
              </div>
            )}
            <Field label="Aesthetic" value={brandAesthetic} />
            <Field label="Typography" value={brandTypography} />
            {logoUrl && (
              <div className="space-y-1">
                <div className="text-[9.5px] uppercase tracking-[0.16em] text-white/45">Logo</div>
                <div className="inline-flex items-center gap-2 rounded-md border border-white/10 bg-white/95 px-1.5 py-1">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={logoUrl}
                    alt={`${clientName} logo`}
                    className="h-7 w-auto max-w-[140px] object-contain"
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
