/**
 * lib/client/team.ts
 *
 * A managing client's sales team: the rep client-accounts whose
 * clients.manager_client_id points at this manager (e.g. Mike -> Skip at EHP).
 * Powers the "Your sales team" view in the manager's hub — each rep with their
 * live pipeline count and monthly pipeline value (in the manager's deal economics).
 *
 * Read-only, scoped strictly to the manager's own client_id.
 */
import { getAvDb } from '@/lib/db/av';
import { clientMonthlyPipelineCents } from '@/lib/sales/deal_model';
import type { RowDataPacket } from 'mysql2';

export interface TeamRep {
  clientId: number;
  name: string;
  liveLeadCount: number;
  monthlyPipelineCents: number | null;
}

/** The rep accounts reporting to this manager client, with pipeline stats. */
export async function listClientTeam(managerClientId: number | null | undefined): Promise<TeamRep[]> {
  if (!managerClientId || !Number.isInteger(managerClientId) || managerClientId <= 0) return [];
  const db = getAvDb();

  const [reps] = await db.execute<(RowDataPacket & { client_id: number; client_name: string | null })[]>(
    `SELECT client_id, client_name FROM clients WHERE manager_client_id = ? ORDER BY client_name ASC`,
    [managerClientId]
  );
  if (reps.length === 0) return [];

  // Live lead counts for all reps in one query.
  const ids = reps.map((r) => Number(r.client_id));
  const placeholders = ids.map(() => '?').join(', ');
  const [countRows] = await db.execute<(RowDataPacket & { client_id: number; n: number | string })[]>(
    `SELECT client_id, COUNT(*) AS n FROM leads
      WHERE archived_at IS NULL
        AND lead_status IN ('new','contacted','qualified')
        AND client_id IN (${placeholders})
      GROUP BY client_id`,
    ids
  );
  const counts = new Map<number, number>();
  for (const c of countRows) counts.set(Number(c.client_id), Number(c.n) || 0);

  // Monthly pipeline value per rep (reuses the deal-economics engine).
  const out: TeamRep[] = [];
  for (const r of reps) {
    const id = Number(r.client_id);
    const monthlyPipelineCents = await clientMonthlyPipelineCents(id).catch(() => null);
    out.push({
      clientId: id,
      name: r.client_name || `Rep #${id}`,
      liveLeadCount: counts.get(id) ?? 0,
      monthlyPipelineCents
    });
  }
  return out;
}
