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
import { scoreAndAuditLead } from '@/lib/ai/score_and_audit';
import { extractPainProfileForLead } from '@/lib/ai/pain_extractor';
import { extractBrandKitFromUrl } from '@/lib/client/brand_kit_extractor';
import { getAvDb } from '@/lib/db/av';
import { logEvent } from '@/lib/events/log';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

/** Top-N stale audits to regen per autopilot trigger. Higher-fit leads first. */
const STALE_AUDIT_REGEN_TOP_N = 5;
/** Don't re-fire autopilot audit regen for the same client within this window. */
const AUDIT_REGEN_RATE_LIMIT_HOURS = 6;
/** Don't re-fire autopilot brand-kit extraction for the same client within this window. */
const BRAND_KIT_RATE_LIMIT_HOURS = 24;
/**
 * (#193) After a discovery batch, the top-N highest-fit just-discovered leads
 * get the FULL regrounded audit + call script inline so val opens the lead
 * immediately and sees coaching framed in THEIR client's offer — not "no
 * intel, check back tomorrow" while the daily cron catches up. Capped to keep
 * LLM spend bounded per discovery run; the rest still ride the daily cron.
 */
const DISCOVERY_AUDIT_TOP_N = 5;
/** Minimum ICP-fit score before autopilot bothers auditing — skip cold leads. */
const DISCOVERY_AUDIT_MIN_FIT = 60;

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
      // (#252) Title preferences are operator-curated, never sharpener-inferred.
      preferredContactTitles: existing.preferredContactTitles,
      excludedContactTitles: existing.excludedContactTitles,
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
      // (#252) Preserve existing title provenance (autopilot doesn't change titles).
      preferredContactTitles: {},
      excludedContactTitles: {},
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

    // (#193) Now that ICP-fit scores are populated for this batch, audit
    // (regrounded in the CLIENT's offer) + extract a call script for the
    // TOP-N hottest fits. Fixes the symptom "newly-discovered lead has no
    // call script for 24h until the cron sweep catches it" — by then val
    // has already opened the lead, seen blanks, and concluded that
    // regrounding doesn't work. With this hook, the top fits are
    // audit+script-ready within minutes of discovery.
    //
    // Fire-and-forget (no await) so the parent autopilot loop logs the
    // ICP-fit completion immediately. The downstream function logs its own
    // success/failure event.
    void maybeAuditAndScriptTopFits({ clientId }).catch(() => undefined);
  } catch (err) {
    await logEvent({
      eventType: 'autopilot.discovery_score_failed',
      source: 'autopilot',
      status: 'failure',
      errorMessage: (err as Error).message
    });
  }
}

/**
 * (#193) Audit + extract call script for the TOP-N highest-fit leads on a
 * client that don't yet have an audit. Closes the "no call script for 24h"
 * gap between discovery and the daily score-sweep / pain-sweep crons.
 *
 * Hard caps:
 *   - DISCOVERY_AUDIT_TOP_N leads per fire (cost ceiling)
 *   - DISCOVERY_AUDIT_MIN_FIT score floor (don't audit cold leads)
 *   - 50s hard deadline (one batch worth of LLM calls)
 *   - Sequential (one LLM call at a time)
 *
 * Both scoreAndAuditLead and extractPainProfileForLead go through the
 * lens-aware regrounded path (lensForClient(lead.client_id)), so the call
 * script lands in THIS client's selling voice — not the AV marketing audit.
 *
 * NEVER throws. Logs autopilot.discovery_audit_* events for auditability.
 */
export async function maybeAuditAndScriptTopFits(args: {
  clientId: number | null;
}): Promise<void> {
  try {
    const { clientId } = args;
    if (!clientId) return;

    const db = getAvDb();
    const [topRows] = await db.execute<(RowDataPacket & { id: number; fit: number | null })[]>(
      `SELECT id, client_icp_fit_score AS fit
         FROM leads
        WHERE client_id = ?
          AND archived_at IS NULL
          AND audit_content IS NULL
          AND client_icp_fit_score IS NOT NULL
          AND client_icp_fit_score >= ?
        ORDER BY client_icp_fit_score DESC, id DESC
        LIMIT ?`,
      [clientId, DISCOVERY_AUDIT_MIN_FIT, DISCOVERY_AUDIT_TOP_N]
    );
    if (topRows.length === 0) return;

    await logEvent({
      eventType: 'autopilot.discovery_audit_started',
      organizationId: clientId,
      source: 'autopilot',
      payload: { lead_count: topRows.length, min_fit: DISCOVERY_AUDIT_MIN_FIT }
    });

    const hardDeadline = Date.now() + 50_000;
    let audited = 0;
    let scripted = 0;
    let failed = 0;

    for (const r of topRows) {
      if (Date.now() > hardDeadline) break;
      try {
        // Step 1: regrounded audit (writes leads.audit_content + lens row).
        const auditRes = await scoreAndAuditLead(r.id);
        if (!auditRes || auditRes.skipped) {
          continue;
        }
        audited += 1;

        // Step 2: regrounded pain extraction (reads the just-written audit_content
        // through extractPainProfileForLead, which queries the lead fresh).
        if (Date.now() > hardDeadline) break;
        const painRes = await extractPainProfileForLead(r.id);
        if (painRes) scripted += 1;
      } catch (err) {
        failed += 1;
        console.error('[autopilot:discovery_audit]', r.id, (err as Error).message);
      }
    }

    await logEvent({
      eventType: 'autopilot.discovery_audited',
      organizationId: clientId,
      source: 'autopilot',
      payload: {
        attempted: topRows.length,
        audited,
        scripted,
        failed,
        top_fit: topRows[0]?.fit ?? null
      }
    });
  } catch (err) {
    await logEvent({
      eventType: 'autopilot.discovery_audit_failed',
      source: 'autopilot',
      status: 'failure',
      errorMessage: (err as Error).message
    });
  }
}

/**
 * (#90 inc 2) After a brief save, if this client has stale audits (audit was
 * generated before the latest brief edit), regen the TOP-N highest-fit ones
 * in the background so the audit/call-script stays aligned with the current
 * positioning. Bounded:
 *   - max STALE_AUDIT_REGEN_TOP_N leads per fire
 *   - rate-limited per client (AUDIT_REGEN_RATE_LIMIT_HOURS)
 *   - sequential (one LLM call at a time, so a 5-lead refresh costs ~5 calls)
 *
 * Operator can ALSO click "Refresh AI intel" any time for the full set.
 * This is the "keep up automatically" layer for the highest-leverage leads.
 */
export async function maybeRegenerateStaleAudits(args: { clientId: number | null }): Promise<void> {
  try {
    const { clientId } = args;
    if (!clientId) return;

    // Rate-limit: have we run this for this client in the last N hours?
    const db = getAvDb();
    const [recent] = await db.execute<(RowDataPacket & { id: number })[]>(
      `SELECT id FROM system_events
        WHERE event_type = 'autopilot.audit_regen_started'
          AND organization_id = ?
          AND created_at > DATE_SUB(NOW(), INTERVAL ? HOUR)
        ORDER BY created_at DESC LIMIT 1`,
      [clientId, AUDIT_REGEN_RATE_LIMIT_HOURS]
    );
    if (recent[0]) {
      // We already fired recently. Stay quiet -- val can hit the manual
      // refresh button if she needs the full set right now.
      return;
    }

    // Find the top-N stale audits, prioritized by ICP fit (the leads val
    // most likely cares about regenerating first).
    const [staleRows] = await db.execute<(RowDataPacket & { id: number })[]>(
      `SELECT l.id
         FROM leads l
         JOIN creative_briefs cb
           ON cb.client_id = l.client_id AND cb.tenant_id = 'av'
        WHERE l.client_id = ?
          AND l.archived_at IS NULL
          AND (l.audit_generated IS NULL OR l.audit_generated < cb.updated_at)
        ORDER BY (l.client_icp_fit_score IS NULL) ASC,
                 l.client_icp_fit_score DESC,
                 l.id DESC
        LIMIT ?`,
      [clientId, STALE_AUDIT_REGEN_TOP_N]
    );

    if (staleRows.length === 0) return;

    await logEvent({
      eventType: 'autopilot.audit_regen_started',
      organizationId: clientId,
      source: 'autopilot',
      payload: { lead_count: staleRows.length, rate_limit_hours: AUDIT_REGEN_RATE_LIMIT_HOURS }
    });

    let regenerated = 0;
    let failed = 0;
    for (const r of staleRows) {
      try {
        const res = await scoreAndAuditLead(r.id);
        if (res && !res.skipped) regenerated += 1;
      } catch {
        failed += 1;
      }
    }

    await logEvent({
      eventType: 'autopilot.audit_regen_completed',
      organizationId: clientId,
      source: 'autopilot',
      payload: { attempted: staleRows.length, regenerated, failed }
    });
  } catch (err) {
    await logEvent({
      eventType: 'autopilot.audit_regen_failed',
      source: 'autopilot',
      status: 'failure',
      errorMessage: (err as Error).message
    });
  }
}

/**
 * (#243) After a brief save, if the brief has a website_url AND brand_colors
 * is empty, fire the brand-kit extractor in the background. Writes colors /
 * logo / aesthetic / typography back into the brief so the next commercial /
 * social card / blog header ships in their real visual identity — no manual
 * paste of the BrandKitPanel.
 *
 * Rate-limited per client (BRAND_KIT_RATE_LIMIT_HOURS) so a flurry of brief
 * edits doesn't burn the same LLM call repeatedly. Operator can still hit
 * the manual BrandKitPanel any time.
 */
export async function maybeExtractBrandKitAfterBriefSave(args: { clientId: number | null }): Promise<void> {
  try {
    const { clientId } = args;
    if (!clientId) return;
    const db = getAvDb();

    // Rate-limit
    const [recent] = await db.execute<(RowDataPacket & { id: number })[]>(
      `SELECT id FROM system_events
        WHERE event_type = 'autopilot.brand_kit_extracted'
          AND organization_id = ?
          AND created_at > DATE_SUB(NOW(), INTERVAL ? HOUR)
        ORDER BY created_at DESC LIMIT 1`,
      [clientId, BRAND_KIT_RATE_LIMIT_HOURS]
    );
    if (recent[0]) return;

    // Pull the brief — we need website_url + check brand_colors
    const [briefRows] = await db.execute<(RowDataPacket & { brief_payload: string | object | null })[]>(
      `SELECT brief_payload FROM creative_briefs
        WHERE tenant_id = 'av' AND client_id = ? LIMIT 1`,
      [clientId]
    );
    const raw = briefRows[0]?.brief_payload;
    if (!raw) return;
    let payload: Record<string, unknown>;
    try {
      payload = typeof raw === 'string' ? JSON.parse(raw) : (raw as Record<string, unknown>);
    } catch { return; }

    const websiteUrl = typeof payload.website_url === 'string' ? payload.website_url.trim() : '';
    if (!websiteUrl || !/^https?:\/\//.test(websiteUrl)) return;

    const brandColorsExisting = typeof payload.brand_colors === 'string' ? payload.brand_colors.trim() : '';
    if (brandColorsExisting.length > 0) {
      // Operator already curated — don't touch.
      return;
    }

    // Pull client name for the LLM brand hint
    const [clientRows] = await db.execute<(RowDataPacket & { client_name: string | null })[]>(
      `SELECT client_name FROM clients WHERE client_id = ? LIMIT 1`,
      [clientId]
    );
    const brandHint = clientRows[0]?.client_name?.trim() || null;

    // Run the extraction. Throws on fetch / LLM failures — caught below.
    const result = await extractBrandKitFromUrl({ url: websiteUrl, brandHint });

    // Build the patch (canonical intake keys + logo_url).
    const patch: Record<string, string> = {};
    if (result.colors.length > 0) patch.brand_colors = result.colors.join(', ').slice(0, 1000);
    if (result.logoUrl && /^https?:\/\//.test(result.logoUrl)) {
      patch.logo_url = result.logoUrl.slice(0, 2000);
      patch.has_logo = 'yes';
    }
    if (result.aesthetic) patch.brand_aesthetic = result.aesthetic.slice(0, 400);
    if (result.typography) patch.brand_typography = result.typography.slice(0, 400);

    const writtenKeys = Object.keys(patch);
    if (writtenKeys.length === 0) return;

    // Use JSON_MERGE_PATCH directly on the brief payload — bypasses
    // saveBriefPayload to avoid re-triggering ourselves recursively.
    await db.execute<ResultSetHeader>(
      `UPDATE creative_briefs
          SET brief_payload = JSON_MERGE_PATCH(brief_payload, CAST(? AS JSON)),
              updated_at = NOW()
        WHERE tenant_id = 'av' AND client_id = ?`,
      [JSON.stringify(patch), clientId]
    );

    // Mirror to client_users.intake_payload so the preview at /preview/intake
    // and the client portal stay in sync.
    try {
      await db.execute<ResultSetHeader>(
        `UPDATE client_users
            SET intake_payload = JSON_MERGE_PATCH(COALESCE(intake_payload, JSON_OBJECT()), CAST(? AS JSON))
          WHERE client_id = ?`,
        [JSON.stringify(patch), clientId]
      );
    } catch { /* non-fatal */ }

    await logEvent({
      eventType: 'autopilot.brand_kit_extracted',
      organizationId: clientId,
      source: 'autopilot',
      payload: {
        client_id: clientId,
        colors_count: result.colors.length,
        logo_found: !!result.logoUrl,
        tokens: result.tokensUsed,
        written_keys: writtenKeys
      }
    });
  } catch (err) {
    await logEvent({
      eventType: 'autopilot.brand_kit_extract_failed',
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
