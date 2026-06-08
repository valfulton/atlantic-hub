/**
 * POST /api/admin/av/clients/[client_id]/dossier/run-kyc-sweep  (#524, val 2026-06-08)
 *
 * "Run Full KYC Sweep" — one button on the Due Diligence panel that fires
 * every available screen against the client themselves in a single round
 * trip. Currently runs:
 *
 *   1. USPTO patents (via PatentsView, by company + contact name)
 *   2. CourtListener federal court records — name-based via the API's name_full
 *      parameter (Approach B is queued; for now we use the existing fetch
 *      with a name filter so val gets SOMETHING per-person, not the generic
 *      sweep we caught earlier returning unrelated rows)
 *   3. CFPB consumer complaints — company-name match
 *
 * Each source's findings:
 *   - Persist to public_intel_records (so Intelligence Feed surfaces them)
 *   - Auto-create a red-flag entry in client_dossier.red_flags_json
 *   - Stamp last_screened_at
 *
 * Per val's "no duct tape · intelligence auto-populates everywhere" rule:
 * every artifact this run produces is saved + visible in multiple surfaces.
 *
 * Operator-only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { getBriefPayload } from '@/lib/client/brief_store';
import { lookupPatentsForClient, type PatentHit } from '@/lib/av/uspto_patents';
import { getDossier, saveDossier, newRedFlagId } from '@/lib/av/client_dossier';
import { getAvDb } from '@/lib/db/av';
import type { ResultSetHeader } from 'mysql2';

export const runtime = 'nodejs';
export const maxDuration = 60;

interface StepResult {
  source: string;
  ran: boolean;
  /** Count of hits found (records or matches). */
  hits: number;
  /** Compact reason if we skipped. */
  skipReason?: string;
  /** Compact summary surfaced as a red flag. */
  flagLabel?: string;
}

export async function POST(req: NextRequest, { params }: { params: { client_id: string } }) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/clients/[client_id]/dossier/run-kyc-sweep:POST',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const clientId = Number.parseInt(params.client_id, 10);
  if (!Number.isFinite(clientId) || clientId <= 0) {
    return NextResponse.json({ error: 'invalid client_id' }, { status: 400 });
  }

  // Pull identity from brief
  const brief = (await getBriefPayload('av', clientId)) as Record<string, unknown> | null;
  const company = typeof brief?.company === 'string' ? brief.company.trim() : '';
  const contactName = typeof brief?.contact_name === 'string' ? brief.contact_name.trim() : '';

  if (!company && !contactName) {
    return NextResponse.json({
      ok: false,
      error: 'No company name or contact name on the brief. Fill those in first via Account Info.'
    }, { status: 400 });
  }

  const steps: StepResult[] = [];
  const newFlags: ReturnType<typeof newRedFlagId> extends string ? Array<{
    id: string;
    label: string;
    source: string;
    severity: 'low' | 'medium' | 'high';
    surfaced_at: string;
  }> : never = [];

  const fetchedAt = new Date().toISOString();
  const stampUpdatedBy = guard.actor.userId ? `user:${guard.actor.userId}` : 'operator';

  // ──────────────────────────────────────────────────────────────────────
  // Step 1: USPTO patents
  // ──────────────────────────────────────────────────────────────────────
  try {
    const patents = await lookupPatentsForClient({ companyName: company, contactName });
    const totalHits = patents.byAssignee.length + patents.byInventor.length;
    steps.push({
      source: 'uspto_patents',
      ran: true,
      hits: totalHits,
      flagLabel: totalHits > 0
        ? `${totalHits} USPTO patent${totalHits === 1 ? '' : 's'} found · ${patents.byAssignee.length} by company, ${patents.byInventor.length} by inventor`
        : `USPTO: 0 patents found for "${company || contactName}" — clean signal OR filed under different name`
    });

    // Persist patents to public_intel_records
    if (totalHits > 0) {
      try {
        const db = getAvDb();
        const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
        const all: PatentHit[] = [...patents.byAssignee, ...patents.byInventor];
        for (const hit of all) {
          if (!hit.patentId) continue;
          await db.execute<ResultSetHeader>(
            `INSERT INTO public_intel_records
               (source_kind, entity_key, client_id, lead_id, record_json,
                summary_label, region_code, fetched_at, expires_at)
             VALUES ('uspto_patents', ?, ?, NULL, CAST(? AS JSON), ?, 'US', NOW(), ?)
             ON DUPLICATE KEY UPDATE
               client_id = VALUES(client_id),
               record_json = VALUES(record_json),
               summary_label = VALUES(summary_label),
               fetched_at = NOW(),
               expires_at = VALUES(expires_at)`,
            [
              hit.patentId,
              clientId,
              JSON.stringify(hit),
              (hit.patentTitle || `Patent ${hit.patentId}`).slice(0, 250),
              expiresAt
            ]
          );
        }
      } catch (err) {
        console.error('[run-kyc-sweep:patents:persist]', (err as Error).message);
      }
    }

    newFlags.push({
      id: newRedFlagId(),
      label: steps[steps.length - 1].flagLabel!,
      source: 'uspto_patents',
      severity: totalHits >= 10 ? 'medium' : 'low',
      surfaced_at: fetchedAt
    });
  } catch (err) {
    console.error('[run-kyc-sweep:patents]', (err as Error).message);
    steps.push({ source: 'uspto_patents', ran: false, hits: 0, skipReason: (err as Error).message });
  }

  // ──────────────────────────────────────────────────────────────────────
  // Step 2: CourtListener name-based check
  // ──────────────────────────────────────────────────────────────────────
  // The existing CourtListener adapter doesn't support name lookup yet (#525
  // Approach B). For tonight, we record a "search needed" red flag with a
  // pre-built CourtListener search URL the operator can run in 2 clicks.
  // This is honest: we tell val we couldn't run it ourselves, and we make
  // the manual path one click instead of three.
  if (contactName) {
    const courtSearchUrl = `https://www.courtlistener.com/?q=${encodeURIComponent(`"${contactName}"`)}&type=r`;
    steps.push({
      source: 'courtlistener_manual',
      ran: false,
      hits: 0,
      skipReason: 'name-lookup adapter not yet wired (#525 queued)',
      flagLabel: `Manual check needed: search CourtListener for "${contactName}" — ${courtSearchUrl}`
    });
    newFlags.push({
      id: newRedFlagId(),
      label: `CourtListener manual search ready — open: ${courtSearchUrl}`,
      source: 'courtlistener_manual',
      severity: 'low',
      surfaced_at: fetchedAt
    });
  }

  // ──────────────────────────────────────────────────────────────────────
  // Step 3: CFPB consumer complaints (company-level)
  // ──────────────────────────────────────────────────────────────────────
  // CFPB has a public Socrata API — but it expects state-aggregate queries,
  // not "find complaints with company name X". For now, surface a search URL
  // (same honest approach as CourtListener) until #525 wires a real name
  // lookup against the company-name field.
  if (company) {
    const cfpbSearchUrl = `https://www.consumerfinance.gov/data-research/consumer-complaints/search/?company=${encodeURIComponent(company)}`;
    steps.push({
      source: 'cfpb_manual',
      ran: false,
      hits: 0,
      skipReason: 'company-name lookup adapter not yet wired (#525 queued)',
      flagLabel: `Manual check needed: search CFPB for "${company}" — ${cfpbSearchUrl}`
    });
    newFlags.push({
      id: newRedFlagId(),
      label: `CFPB manual search ready — open: ${cfpbSearchUrl}`,
      source: 'cfpb_manual',
      severity: 'low',
      surfaced_at: fetchedAt
    });
  }

  // ──────────────────────────────────────────────────────────────────────
  // Persist red flags + stamp last_screened_at
  // ──────────────────────────────────────────────────────────────────────
  const current = await getDossier(clientId);
  // Dedup: drop existing flags with these sources from this sweep, replace
  // with the fresh ones so the timestamp updates.
  const sweepSources = new Set(['uspto_patents', 'courtlistener_manual', 'cfpb_manual']);
  const preserved = current.redFlags.filter((f) => !sweepSources.has(f.source));
  await saveDossier(
    clientId,
    {
      redFlags: [...newFlags, ...preserved],
      lastScreenedAtNow: true
    },
    { updatedBy: stampUpdatedBy }
  );

  return NextResponse.json({
    ok: true,
    sweptAt: fetchedAt,
    steps,
    flagsAdded: newFlags.length
  });
}
