/**
 * lib/calendar/important_dates.ts
 *
 * Reads structured client important dates (client_important_dates) and expands
 * them across a calendar window — recurring (month/day) entries get an instance
 * per year in range; one-off (event_date) entries pass through if in range.
 * Pure DB read, no LLM. Layers on top of the fun holidays in lib/calendar/holidays.
 */
import { getAvDb } from '@/lib/db/av';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';

export interface ImportantDate {
  iso: string;       // YYYY-MM-DD
  label: string;
  kind: string;      // birthday|anniversary|busy_season|launch|date
}

interface Row extends RowDataPacket {
  label: string;
  kind: string;
  event_date: string | null;
  recur_month: number | null;
  recur_day: number | null;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Emoji per kind so the marker reads at a glance (matches the holiday style). */
export const KIND_EMOJI: Record<string, string> = {
  birthday: '🎂',
  anniversary: '💍',
  busy_season: '📈',
  launch: '🚀',
  date: '📌'
};

export async function getImportantDatesForWindow(opts: {
  tenant: string | null;     // null = all brands
  fromIso: string;
  toIso: string;
}): Promise<ImportantDate[]> {
  try {
    const db = getAvDb();
    const where: string[] = ['archived_at IS NULL'];
    const params: unknown[] = [];
    if (opts.tenant) { where.push('tenant_id = ?'); params.push(opts.tenant); }
    const [rows] = await db.execute<Row[]>(
      `SELECT label, kind, event_date, recur_month, recur_day
         FROM client_important_dates
        WHERE ${where.join(' AND ')}`,
      params
    );

    const from = opts.fromIso;
    const to = opts.toIso;
    const years = new Set<number>();
    for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) years.add(y);

    const out: ImportantDate[] = [];
    for (const r of rows) {
      if (r.event_date) {
        const iso = String(r.event_date).slice(0, 10);
        if (iso >= from && iso <= to) out.push({ iso, label: r.label, kind: r.kind });
      } else if (r.recur_month && r.recur_day) {
        for (const y of years) {
          const iso = `${y}-${pad(r.recur_month)}-${pad(r.recur_day)}`;
          if (iso >= from && iso <= to) out.push({ iso, label: r.label, kind: r.kind });
        }
      }
    }
    return out;
  } catch {
    return [];
  }
}

export async function addImportantDate(input: {
  tenant: string;
  clientId: number | null;
  label: string;
  kind: string;
  eventDate?: string | null;   // YYYY-MM-DD one-off
  recurMonth?: number | null;
  recurDay?: number | null;
  source?: string;
}): Promise<number> {
  const db = getAvDb();
  const [res] = await db.execute<ResultSetHeader>(
    `INSERT INTO client_important_dates
       (tenant_id, client_id, label, kind, event_date, recur_month, recur_day, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.tenant || 'av',
      input.clientId && input.clientId > 0 ? input.clientId : null,
      input.label.slice(0, 160),
      input.kind || 'date',
      input.eventDate || null,
      input.recurMonth ?? null,
      input.recurDay ?? null,
      input.source || 'manual'
    ]
  );
  return res.insertId;
}
