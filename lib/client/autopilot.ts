/**
 * lib/client/autopilot.ts  (#240)
 *
 * Lifecycle hooks that "do the obvious next thing" without making val click.
 * Closes the last manual steps in the intake → ICP → discovery → fit-score
 * pipeline:
 *
 *   - maybeSharpenIcpAfterBriefSave: when a client's brief gets written and
 *     their ICP table is empty, fire-and-forget the LLM sharpener so the
 *     "Find new leads" form auto-fills from the ICP next time val opens it.
 *     Skipped when the ICP already has values (val's hand-curated state is
 *     never touched).
 *
 *   - maybeScoreDiscoveryBatch: after a discovery run drops leads into a
 *     specific client's hub, score them against that client's ICP/brief in
 *     the background so the fit pills appear on Tim's pipeline without val
 *     clicking "Score unscored."
 *
 * Both helpers:
 *   - NEVER throw. The wrapping call site continues on any failure.
 *   - Are fire-and-forget by design — they intentionally don't `await` their
 *     own work so the user-facing response returns immediately.
 *   - Log events (autopilot.*) so you can audit what ran without intent.
 *   - Respect the "operator's hand wins" rule: if the operator already
 *     populated something, autopilot leaves it alone.
 */
import { getClientIcp, saveClientIcp, type ClientIcp, type IcpProvenance } from '@/lib/client/icp';
import { sharpenIcpFromBrief } from '@/lib/client/icp_sharpener';
import { scoreClientLeadsBulk } from '@/lib/ai/client_icp_fit';
import { getAvDb } from '@/lib/db/av';
import { logEvent } from '@/lib/events/log';
import type { RowDataPacket } from 'mysql2';

/**
 * Run the ICP sharpener for a client IF their ICP table is currently empty.
 * Writes the result via saveClientIcp with provenance 'ai_intake'. Fire-and-
 * forget: never awaited at the call site, never throws.
 *
 * Triggered after brief writes (operator brief editor, intake form submit,
 * web-filler apply, voice picker save — anything that hits saveBriefPayload).
 * We DON'T trigger off small touches like the voice picker because they pass
 * a known `source` that we filter against.
 */
export async function maybeSharpenIcpAfterBriefSave(args: {
  clientId: number | null;
  /** The source label passed to saveBriefPayload. Used to skip auto-sharpen
   *  for small writes (voice picker, restore) that shouldn't trigger LLM. */
  source?: string;
}): Promise<void> {
  try {
    const { clientId, source } = args;
    if (!clientId) return; // tenant-level briefs don't have a client ICP
    // Skip lifecycle events that aren't real intake/brief writes.
    if (source === 'voice_picker' || source === 'restore') return;

    // Only auto-fill when the ICP is empty. If val has anything in there,
    // her curation wins — she can always click "Sharpen from intake" manually.
    const existing = await getClientIcp(clientId);
    if (existing.industries.length > 0 || existing.geographies.length > 0) {
      return;
    }

    const brandName = await loadClientName(clientId);
    const suggestion = await sharpenIcpFromBrief({ clientId, brandName });
    if (!suggestion) return; // no brief signal yet

    // Build the ICP we'll persist. Geographies + industries from the LLM,
    // size range too. Excluded industries are emitted only on explicit signal.
    const next: ClientIcp = {
      industries: suggestion.industries,
      geographies: suggestion.geographies,
      excludeGeographies: [],
      excludedIndustries: suggestion.excludedIndustries,
      description: existing.description,
      companySizeMin: suggestion.companySizeMin,
      companySizeMax: suggestion.companySizeMax
    };

    // Provenance: every newly-written item is tagged 'ai_intake' so val sees
    // the violet chip in the IcpEditor and can distinguish autopilot's work
    // from her own.
    const provenance: IcpProvenance = {
      industries:        mapAll(suggestion.industries,        'ai_intake'),
      geographies:       mapAll(suggestion.geographies,       'ai_intake'),
      excludeGeographies: {},
      excludedIndustries: mapAll(suggestion.excludedIndustries, 'ai_intake'),
      description: null
    };

    await saveClientIcp(clientId, next, null, provenance);

    await logEvent({
      eventType: 'autopilot.icp_sharpened',
      source: 'autopilot',
      payload: {
        client_id: clientId,
        industries_count: suggestion.industries.length,
        geographies_count: suggestion.geographies.length,
        excluded_count: suggestion.excludedIndustries.length,
        tokens: suggestion.tokensUsed
      }
    });
  } catch (err) {
    // Autopilot must never break the parent call. Log the miss + move on.
    await logEvent({
      eventType: 'autopilot.icp_sharpen_failed',
      source: 'autopilot',
      status: 'failure',
      errorMessage: (err as Error).message
    });
  }
}

/**
 * After a discovery run drops leads into a specific client's hub, score them
 * against that client's ICP/brief. Fire-and-forget; the discovery response
 * returns immediately and the fit pills appear when val refreshes the page.
 *
 * Hard-deadlines at 45s to stay under Netlify's max-duration for the calling
 * route — fewer leads can mean a smaller / faster bulk run.
 */
export async function maybeScoreDiscoveryBatch(args: {
  clientId: number | null;
  /** Approx number of leads just inserted, used to size the bulk limit. */
  insertedCount: number;
}): Promise<void> {
  try {
    const { clientId, insertedCount } = args;
    if (!clientId || insertedCount <= 0) return;
    // Cap how many we attempt so a 200-lead pull doesn't blow the LLM budget
    // in one fire-and-forget. Val can always click "Score unscored" for the
    // rest.
    const limit = Math.min(Math.max(insertedCount, 5), 60);
    const softDeadline = Date.now() + 45_000;

    const result = await scoreClientLeadsBulk({
      clientId,
      mode: 'unscored',
      limit,
      softDeadline
    });

    await logEvent({
      eventType: 'autopilot.discovery_scored',
      source: 'autopilot',
      payload: {
        client_id: clientId,
        attempted: result.attempted,
        scored: result.scored,
        skipped: result.skipped,
        inserted_count: insertedCount
      }
    });
  } catch (err) {
    await logEvent({
      eventType: 'autopilot.discovery_score_failed',
      source: 'autopilot',
      status: 'failure',
      errorMessage: (err as Error).message
    });
  }
}

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

async function loadClientName(clientId: number): Promise<string> {
  try {
    const db = getAvDb();
    const [rows] = await db.execute<(RowDataPacket & { client_name: string | null })[]>(
      `SELECT client_name FROM clients WHERE client_id = ? LIMIT 1`,
      [clientId]
    );
    return rows[0]?.client_name?.trim() || `Client #${clientId}`;
  } catch {
    return `Client #${clientId}`;
  }
}

function mapAll(items: string[], source: 'ai_intake'): Record<string, 'ai_intake'> {
  const out: Record<string, 'ai_intake'> = {};
  for (const it of items) out[it] = source;
  return out;
}
