import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getAvDb } from '@/lib/db/av';
import type { RowDataPacket } from 'mysql2';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * /admin/av/commercials -- a gallery of every AI commercial across leads.
 *
 * Commercials are generated + branded + pushed per-lead (the Commercial panel on
 * a lead). This top-level gallery makes them findable: each card links into its
 * lead, where the "Brand this video" + "Push to social" actions live.
 *
 * Owner + staff only.
 */
interface AssetRow extends RowDataPacket {
  id: number;
  asset_type: 'image' | 'video';
  storage_url: string | null;
  branded_status: string | null;
  created_at: Date | string | null;
  audit_id: string;
  company: string | null;
}

export default async function CommercialsPage({ searchParams }: { searchParams: { filter?: string } }) {
  const role = headers().get('x-ah-user-role') as 'owner' | 'staff' | 'client_user' | null;
  if (role === 'client_user') redirect('/admin');

  const filter = searchParams.filter === 'branded' || searchParams.filter === 'needs' ? searchParams.filter : 'all';

  let rows: AssetRow[] = [];
  let failed = false;
  try {
    const db = getAvDb();
    const [r] = await db.execute<AssetRow[]>(
      `SELECT a.id, a.asset_type, a.storage_url, a.branded_status, a.created_at,
              l.audit_id, l.company
         FROM grok_imagine_assets a
         JOIN leads l ON l.id = a.lead_id
        WHERE a.generation_status = 'succeeded'
          AND a.storage_url IS NOT NULL
          AND l.archived_at IS NULL
        ORDER BY a.id DESC
        LIMIT 60`
    );
    rows = r;
  } catch {
    failed = true;
  }

  return (
    <div className="max-w-5xl">
      <h1 className="text-3xl font-semibold tracking-tight mb-1">
        AI{' '}
        <span
          className="font-bold italic"
          style={{
            background: 'linear-gradient(120deg, #FF5A6E 0%, #FF9C5B 50%, #FFC73D 100%)',
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            color: 'transparent'
          }}
        >
          Commercials
        </span>
      </h1>
      <p className="text-sm text-muted mb-6 max-w-2xl">
        Every commercial generated across your leads. Open one to brand it with a logo and push it to
        social. To make a new one, open a lead and use the Commercial panel.
      </p>

      {!failed && rows.length > 0 && (() => {
        const brandedN = rows.filter((r) => r.branded_status === 'ready').length;
        const chips: Array<{ key: string; label: string; n: number }> = [
          { key: 'all', label: 'All', n: rows.length },
          { key: 'branded', label: 'Branded', n: brandedN },
          { key: 'needs', label: 'Needs branding', n: rows.length - brandedN }
        ];
        return (
          <div className="flex flex-wrap gap-2 mb-4">
            {chips.map((c) => {
              const active = filter === c.key;
              return (
                <a
                  key={c.key}
                  href={c.key === 'all' ? '/admin/av/commercials' : `/admin/av/commercials?filter=${c.key}`}
                  className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] no-underline"
                  style={
                    active
                      ? { background: 'rgba(255,156,91,0.18)', color: '#FFD9BE', border: '1px solid rgba(255,156,91,0.4)' }
                      : { background: 'rgba(255,255,255,0.05)', color: '#cbd5e1', border: '1px solid rgba(255,255,255,0.1)' }
                  }
                >
                  {c.label} <span style={{ opacity: 0.7 }}>{c.n}</span>
                </a>
              );
            })}
          </div>
        );
      })()}

      {failed ? (
        <div className="rounded-2xl border border-border bg-surface p-6 text-muted">Could not load commercials right now.</div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-border bg-surface p-6">
          <p className="text-ink font-medium">No commercials yet.</p>
          <p className="text-muted text-sm mt-1">Open a lead from Discover leads and generate one in the Commercial panel.</p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {rows
            .filter((a) => filter === 'all' || (filter === 'branded' ? a.branded_status === 'ready' : a.branded_status !== 'ready'))
            .map((a) => (
            <a
              key={a.id}
              href={`/admin/av/${a.audit_id}`}
              className="block rounded-2xl border border-border bg-surface overflow-hidden hover:border-pink-400/40 transition-colors no-underline"
            >
              <div className="aspect-video bg-black flex items-center justify-center">
                {a.asset_type === 'image' ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.storage_url ?? ''} alt="commercial" className="w-full h-full object-cover" />
                ) : (
                  <video src={a.storage_url ?? undefined} preload="metadata" muted className="w-full h-full object-contain bg-black" />
                )}
              </div>
              <div className="p-3">
                <div className="flex items-center gap-2 mb-1 text-[10px] uppercase tracking-[0.12em] text-muted">
                  <span>{a.asset_type}</span>
                  {a.branded_status === 'ready' && <span style={{ color: '#6ee7b7' }}>· branded</span>}
                </div>
                <div className="text-sm text-ink truncate">{a.company || `Lead ${a.audit_id.slice(0, 8)}`}</div>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
