/**
 * lib/av/client_dossier.ts  (#521, val 2026-06-08)
 *
 * Server-side read/write for the operator-only Due Diligence file. Backed
 * by schema/081_client_dossier.sql.
 *
 * WHY: val needs PII + screening notes per prospective client to decide
 * whether to take them on + know who she's working for. None of this
 * belongs on the creative_brief — that's client-readable. The dossier is
 * operator-only, never previewable as the client, never written to the
 * brief, never bled to /client/* surfaces.
 *
 * Red-flag log shape (JSON array on red_flags_json):
 *   [{
 *     id: string,           // client-generated nanoid for delete targeting
 *     label: string,        // "Federal lawsuit · ATX vs Smith"
 *     source: string,       // "courtlistener" | "manual" | "uspto_patents" | ...
 *     severity: 'low' | 'medium' | 'high',
 *     surfaced_at: string,  // ISO timestamp
 *     dossier_url?: string  // optional deep-link to the intel detail page
 *   }, ...]
 */
import { getAvDb } from '@/lib/db/av';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';

export interface RedFlag {
  id: string;
  label: string;
  source: string;
  severity: 'low' | 'medium' | 'high';
  surfaced_at: string;
  dossier_url?: string;
}

export interface ClientDossier {
  clientId: number;
  personalAddress: string | null;
  dobYear: number | null;
  priorEntities: string | null;
  spouseOrCosignerName: string | null;
  notesMd: string | null;
  redFlags: RedFlag[];
  lastScreenedAt: Date | null;
  updatedBy: string | null;
  updatedAt: Date | null;
}

const EMPTY_DOSSIER = (clientId: number): ClientDossier => ({
  clientId,
  personalAddress: null,
  dobYear: null,
  priorEntities: null,
  spouseOrCosignerName: null,
  notesMd: null,
  redFlags: [],
  lastScreenedAt: null,
  updatedBy: null,
  updatedAt: null
});

interface Row extends RowDataPacket {
  client_id: number;
  personal_address: string | null;
  dob_year: number | null;
  prior_entities: string | null;
  spouse_or_cosigner_name: string | null;
  notes_md: string | null;
  red_flags_json: unknown;
  last_screened_at: Date | null;
  updated_by: string | null;
  updated_at: Date | null;
}

function parseRedFlags(raw: unknown): RedFlag[] {
  if (!raw) return [];
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    try { parsed = JSON.parse(raw); } catch { return []; }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((x): x is RedFlag => {
    return (
      x != null && typeof x === 'object'
      && typeof (x as RedFlag).id === 'string'
      && typeof (x as RedFlag).label === 'string'
      && typeof (x as RedFlag).source === 'string'
    );
  });
}

export async function getDossier(clientId: number): Promise<ClientDossier> {
  if (!Number.isFinite(clientId) || clientId <= 0) return EMPTY_DOSSIER(clientId);
  try {
    const db = getAvDb();
    const [rows] = await db.execute<Row[]>(
      `SELECT client_id, personal_address, dob_year, prior_entities,
              spouse_or_cosigner_name, notes_md, red_flags_json,
              last_screened_at, updated_by, updated_at
         FROM client_dossier
        WHERE client_id = ? LIMIT 1`,
      [clientId]
    );
    const r = rows[0];
    if (!r) return EMPTY_DOSSIER(clientId);
    return {
      clientId,
      personalAddress: r.personal_address,
      dobYear: r.dob_year,
      priorEntities: r.prior_entities,
      spouseOrCosignerName: r.spouse_or_cosigner_name,
      notesMd: r.notes_md,
      redFlags: parseRedFlags(r.red_flags_json),
      lastScreenedAt: r.last_screened_at,
      updatedBy: r.updated_by,
      updatedAt: r.updated_at
    };
  } catch (err) {
    console.error('[client_dossier:get]', (err as Error).message);
    return EMPTY_DOSSIER(clientId);
  }
}

export interface DossierPatch {
  personalAddress?: string | null;
  dobYear?: number | null;
  priorEntities?: string | null;
  spouseOrCosignerName?: string | null;
  notesMd?: string | null;
  redFlags?: RedFlag[];
  /** Stamp when the personal risk screen ran. */
  lastScreenedAtNow?: boolean;
}

export async function saveDossier(
  clientId: number,
  patch: DossierPatch,
  opts: { updatedBy?: string | null } = {}
): Promise<boolean> {
  if (!Number.isFinite(clientId) || clientId <= 0) return false;
  try {
    const db = getAvDb();
    // Upsert: INSERT ... ON DUPLICATE KEY UPDATE. The PK is client_id so
    // duplicates collapse to update.
    const current = await getDossier(clientId);
    const next: ClientDossier = {
      ...current,
      personalAddress: patch.personalAddress !== undefined ? patch.personalAddress : current.personalAddress,
      dobYear: patch.dobYear !== undefined ? patch.dobYear : current.dobYear,
      priorEntities: patch.priorEntities !== undefined ? patch.priorEntities : current.priorEntities,
      spouseOrCosignerName: patch.spouseOrCosignerName !== undefined ? patch.spouseOrCosignerName : current.spouseOrCosignerName,
      notesMd: patch.notesMd !== undefined ? patch.notesMd : current.notesMd,
      redFlags: patch.redFlags !== undefined ? patch.redFlags : current.redFlags
    };
    await db.execute<ResultSetHeader>(
      `INSERT INTO client_dossier
         (client_id, personal_address, dob_year, prior_entities,
          spouse_or_cosigner_name, notes_md, red_flags_json,
          last_screened_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, CAST(? AS JSON), ${patch.lastScreenedAtNow ? 'NOW()' : '?'}, ?)
       ON DUPLICATE KEY UPDATE
         personal_address = VALUES(personal_address),
         dob_year = VALUES(dob_year),
         prior_entities = VALUES(prior_entities),
         spouse_or_cosigner_name = VALUES(spouse_or_cosigner_name),
         notes_md = VALUES(notes_md),
         red_flags_json = VALUES(red_flags_json),
         ${patch.lastScreenedAtNow ? 'last_screened_at = NOW(),' : ''}
         updated_by = VALUES(updated_by)`,
      patch.lastScreenedAtNow
        ? [
            clientId,
            next.personalAddress,
            next.dobYear,
            next.priorEntities,
            next.spouseOrCosignerName,
            next.notesMd,
            JSON.stringify(next.redFlags ?? []),
            opts.updatedBy ?? null
          ]
        : [
            clientId,
            next.personalAddress,
            next.dobYear,
            next.priorEntities,
            next.spouseOrCosignerName,
            next.notesMd,
            JSON.stringify(next.redFlags ?? []),
            null,
            opts.updatedBy ?? null
          ]
    );
    return true;
  } catch (err) {
    console.error('[client_dossier:save]', (err as Error).message);
    return false;
  }
}

/** Generate a short client-side id for a red flag entry. Not a UUID, just
 *  unique enough to target for deletion. */
export function newRedFlagId(): string {
  return 'rf_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
