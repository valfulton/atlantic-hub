/**
 * /admin/av/copy/map — copy map & legend (newsroom team, 2026-06-04 — D6)
 *
 * Read-only registry: every copy_key, its default text, which page renders it,
 * and how many overrides exist (global / per-client / per-stage). The answer to
 * "where does this headline come from?" Each row links to the editor for that key.
 * Operator-gated by middleware (same as the rest of /admin/av).
 */
import { getAvDb } from '@/lib/db/av';
import { DEFAULTS, COPY_KEYS } from '@/lib/copy/store';
import CopyMapTable from './CopyMapTable';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Which page renders a key — derived from its namespace. */
function pageFor(key: string): string {
  if (key.startsWith('channel.')) return '/newsroom/channel/[slug]';
  if (key.startsWith('newsroom.')) return '/newsroom (+ channel)';
  const seg = key.split('.')[0];
  return (
    {
      dashboard: '/client/dashboard',
      leads: '/client/leads',
      watchlist: '/client/watchlist',
      pr: '/client/pr',
      audit: '/client/audit',
      intake: '/client/intake',
      login: '/client/login',
    } as Record<string, string>
  )[seg] || '—';
}

export interface CopyMapRow {
  key: string; def: string; page: string; g: number; pc: number; ps: number;
}

export default async function CopyMapPage() {
  const counts: Record<string, { g: number; pc: number; ps: number }> = {};
  try {
    const db = getAvDb();
    const [rows] = await db.execute(
      `SELECT copy_key,
              SUM(client_id = 0 AND stage = '') AS g,
              SUM(client_id <> 0)              AS pc,
              SUM(stage <> '')                 AS ps
         FROM site_copy
        GROUP BY copy_key`
    );
    for (const r of rows as any[]) {
      counts[r.copy_key] = { g: Number(r.g) || 0, pc: Number(r.pc) || 0, ps: Number(r.ps) || 0 };
    }
  } catch {
    /* empty table / pre-migration → all zeroes */
  }

  const rows: CopyMapRow[] = COPY_KEYS.map((key) => ({
    key,
    def: DEFAULTS[key] ?? '',
    page: pageFor(key),
    g: counts[key]?.g ?? 0,
    pc: counts[key]?.pc ?? 0,
    ps: counts[key]?.ps ?? 0,
  }));

  return <CopyMapTable rows={rows} />;
}
