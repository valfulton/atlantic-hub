/**
 * POST /api/admin/av/clients/[client_id]/dossier/run-kyc-sweep  (#524, val 2026-06-08)
 *
 * "Run Full KYC Sweep" — one button on the Due Diligence panel that fires
 * every available screen against the client themselves in a single round
 * trip. Currently runs:
 *
 *   1. USPTO patents (via PatentsView, by company + contact name)
 *   2. CourtListener federal court records — STILL manual-URL until the
 *      semantic search adapter is wired (#525 follow-up)
 *   3. CFPB consumer complaints — REAL company-name lookup (#526) via
 *      cfpbFetchByCompany. Each complaint persists to public_intel_records
 *      so it shows up in the Intelligence Feed by name, not state aggregate.
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
import { fetchByCompany as cfpbFetchByCompany } from '@/lib/public_intel/adapters/cfpb';
import { fetchByName as courtListenerFetchByName } from '@/lib/public_intel/adapters/courtlistener';
import { addCompanyName, sanitizeCompanyName, sanitizePersonName, lastNameOnly } from '@/lib/public_intel/name_sanitize';

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
  /** (#535) What did we query? Surfaced in UI so val can confirm the wiring. */
  query?: {
    names?: string[];
    company?: string;
    states?: string[];
    sinceDays?: number;
    /** Raw API hit count before strict-name filtering. */
    rawHits?: number;
    /** Hit count after strict-name filtering. */
    filteredHits?: number;
  };
  /** (#536) Top matched records — shown inline so val can drill in without
   *  navigating. Capped at 5 to keep the payload small. */
  topHits?: Array<{
    label: string;
    sublabel?: string;
    url?: string;
    matchedQuery?: string;
  }>;
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
  // (#537) owner_name is the LEGAL OWNER — separate from contact_name (who val
  // talks to day-to-day). For KYC we screen the owner, not the marketing
  // contact. If owner_name is empty, fall back to contact_name.
  const ownerName = typeof brief?.owner_name === 'string' ? brief.owner_name.trim() : '';
  // The primary person to screen (preferred order: owner > contact).
  const personToScreen = ownerName || contactName;

  // (#530) Derive a state hint for CourtListener name lookup. We try several
  // brief fields in order of specificity. If nothing yields a 2-letter state,
  // we fall back to nationwide (states = undefined) so the search still runs.
  function deriveStateHint(): string[] | undefined {
    const candidates: Array<unknown> = [
      brief?.business_state,
      brief?.address_state,
      brief?.state,
      brief?.state_code,
      brief?.billing_state
    ];
    for (const c of candidates) {
      if (typeof c === 'string') {
        const trimmed = c.trim().toUpperCase();
        if (/^[A-Z]{2}$/.test(trimmed)) return [trimmed];
      }
    }
    // Try to pluck a 2-letter state out of an address string ("..., GA, 30040")
    const addrCandidates: Array<unknown> = [brief?.business_address, brief?.address];
    for (const c of addrCandidates) {
      if (typeof c === 'string') {
        const m = c.match(/,\s*([A-Z]{2})\s*,?\s*\d{5}/);
        if (m) return [m[1]];
      }
    }
    return undefined;
  }
  const stateHint = deriveStateHint();

  if (!company && !contactName && !ownerName) {
    return NextResponse.json({
      ok: false,
      error: 'No company name or contact name on the brief. Fill those in first via Account Info.'
    }, { status: 400 });
  }

  // (#535b) Brief snapshot: what we actually pulled from the brief to drive
  // the sweep. Surfaced in the UI so val can spot empty fields immediately.
  // (#537) owner_name added — the legal owner KYC actually screens.
  const briefSnapshot = {
    company: company || null,
    contact_name: contactName || null,
    owner_name: ownerName || null,
    business_state: typeof brief?.business_state === 'string' ? brief.business_state : null,
    address_state: typeof brief?.address_state === 'string' ? brief.address_state : null,
    state: typeof brief?.state === 'string' ? brief.state : null
  };

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
        : `USPTO: 0 patents found for "${company || contactName}" — clean signal OR filed under different name`,
      query: {
        names: [company, contactName].filter((n) => n && n.length > 0),
        rawHits: totalHits
      },
      // (#536) Top 5 patents inline.
      topHits: [...patents.byAssignee, ...patents.byInventor].slice(0, 5).map((p) => ({
        label: p.patentTitle || `Patent ${p.patentId}`,
        sublabel: p.patentId,
        url: p.publicUrl ?? undefined
      }))
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
  // Step 2: CourtListener — REAL name-targeted lookup (#526)
  // ──────────────────────────────────────────────────────────────────────
  // Query CourtListener's full-text search for the contact AND the company.
  // We run both queries (people sue people; people also sue companies) and
  // dedup by docketUrl. Filter is name-strict — fetchByName drops rows where
  // the queried name doesn't appear in caseName or party list.
  // (val 2026-06-10) Sanitize EVERY name before it hits CourtListener.
  // "Dr. Ron Elfenbein — Defense Press" returns 0 hits; "Ron Elfenbein"
  // returns the real cases. Shared helpers in lib/public_intel/name_sanitize.ts.
  //
  // (val 2026-06-10 v2) Last-name fallback is NOW LAZY:
  //   - Primary names = full sanitized person names + company. Always run.
  //   - Fallback names = last-name-only. ONLY run if the primary loop returned
  //     ZERO hits. Otherwise short common surnames (Zenke, Smith) flood the
  //     results with 60 unrelated cases of every person with that surname.
  //
  // (#537) Owner first (KYC target), then contact (could be marketing POC),
  // then company. Dedup case-insensitive.
  const primaryNames: string[] = [];
  const fallbackNames: string[] = [];
  const seenLcKyc = new Set<string>();

  const addPrimaryPerson = (raw: string | null | undefined) => {
    const clean = sanitizePersonName(raw ?? '');
    if (!clean) return;
    const lc = clean.toLowerCase();
    if (!seenLcKyc.has(lc)) { seenLcKyc.add(lc); primaryNames.push(clean); }
    // Stage the last name as a fallback — only used if primary returns 0 hits.
    const ln = lastNameOnly(clean);
    if (ln && ln.length > 2) {
      const lcLn = ln.toLowerCase();
      if (lcLn !== lc && !seenLcKyc.has(lcLn) && !fallbackNames.some((n) => n.toLowerCase() === lcLn)) {
        fallbackNames.push(ln);
      }
    }
  };
  addPrimaryPerson(ownerName);
  addPrimaryPerson(contactName);
  addCompanyName(primaryNames, seenLcKyc, company);
  // Also include a clean company variant in case the company is a brand label.
  const cleanCompany = sanitizeCompanyName(company);
  if (cleanCompany && !seenLcKyc.has(cleanCompany.toLowerCase())) {
    seenLcKyc.add(cleanCompany.toLowerCase());
    primaryNames.push(cleanCompany);
  }
  if (primaryNames.length > 0) {
    try {
      const seenDocket = new Set<string>();
      const allHits: Array<{ name: string; hit: Awaited<ReturnType<typeof courtListenerFetchByName>>[number] }> = [];

      // Primary loop — always runs.
      for (const queryName of primaryNames) {
        // (#530) Scope to the brief's state when known — drops the cross-country
        // false positives (Mark Francis Dumas in RI, Zmuda in AZ, etc.)
        const hits = await courtListenerFetchByName(queryName, 15, undefined, stateHint);
        for (const h of hits) {
          const key = h.docketUrl ?? `${h.court ?? ''}/${h.caseName ?? ''}/${h.docketNumber ?? ''}`;
          if (seenDocket.has(key)) continue;
          seenDocket.add(key);
          allHits.push({ name: queryName, hit: h });
        }
      }

      // Fallback loop — ONLY if primary found nothing. Last-name alone is
      // too noisy when used as a default broadener (Zenke returns Julie,
      // Mark, Roshanna in Illinois etc.); only fire when primary is empty.
      const usedFallback = allHits.length === 0 && fallbackNames.length > 0;
      if (usedFallback) {
        for (const queryName of fallbackNames) {
          const hits = await courtListenerFetchByName(queryName, 15, undefined, stateHint);
          for (const h of hits) {
            const key = h.docketUrl ?? `${h.court ?? ''}/${h.caseName ?? ''}/${h.docketNumber ?? ''}`;
            if (seenDocket.has(key)) continue;
            seenDocket.add(key);
            allHits.push({ name: queryName, hit: h });
          }
        }
      }

      const namesQueried = usedFallback ? [...primaryNames, ...fallbackNames] : primaryNames;
      const hitCount = allHits.length;
      // Severity ladder: any litigation involving the principal = medium; 5+ = high
      const severity: 'low' | 'medium' | 'high' =
        hitCount >= 5 ? 'high' : hitCount >= 1 ? 'medium' : 'low';
      const flagLabel = hitCount > 0
        ? `${hitCount} federal court filing${hitCount === 1 ? '' : 's'} mentioning ${namesQueried.join(' / ')}`
        : `CourtListener: 0 federal filings naming ${namesQueried.join(' / ')} — clean signal`;

      steps.push({
        source: 'courtlistener',
        ran: true,
        hits: hitCount,
        flagLabel,
        query: {
          names: namesQueried,
          states: stateHint,
          sinceDays: 0,
          filteredHits: hitCount
        },
        // (#536) Top 5 cases inline so val sees what matched without navigating.
        // (#537) Fall back to a CourtListener search URL when docketUrl is null,
        // so every hit is clickable.
        topHits: allHits.slice(0, 5).map(({ name: matchedQuery, hit }) => ({
          label: hit.caseName ?? 'Unknown case',
          sublabel: [hit.court, hit.filedAt, hit.docketNumber].filter(Boolean).join(' · '),
          url: hit.docketUrl ?? `https://www.courtlistener.com/?q=${encodeURIComponent(`"${matchedQuery}"`)}&type=r`,
          matchedQuery
        }))
      });

      // Persist each filing as its own record so the Intelligence Feed
      // shows real case names, not state aggregates.
      if (hitCount > 0) {
        try {
          const db = getAvDb();
          const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
          for (const { name: queryName, hit } of allHits) {
            const docketSlug = (hit.docketUrl ?? `${hit.court ?? ''}/${hit.caseName ?? ''}/${hit.docketNumber ?? ''}`)
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '-')
              .slice(0, 180);
            await db.execute<ResultSetHeader>(
              `INSERT INTO public_intel_records
                 (source_kind, entity_key, client_id, lead_id, record_json,
                  summary_label, region_code, fetched_at, expires_at)
               VALUES ('courtlistener', ?, ?, NULL, CAST(? AS JSON), ?, ?, NOW(), ?)
               ON DUPLICATE KEY UPDATE
                 client_id = VALUES(client_id),
                 record_json = VALUES(record_json),
                 summary_label = VALUES(summary_label),
                 fetched_at = NOW(),
                 expires_at = VALUES(expires_at)`,
              [
                `courtlistener:name:${docketSlug}`,
                clientId,
                JSON.stringify({ ...hit, matched_query: queryName }),
                `${hit.caseName ?? 'Unknown case'} · ${hit.court ?? ''} · ${hit.filedAt ?? ''}`.slice(0, 250),
                hit.state,
                expiresAt
              ]
            );
          }
        } catch (err) {
          console.error('[run-kyc-sweep:courtlistener:persist]', (err as Error).message);
        }
      }

      newFlags.push({
        id: newRedFlagId(),
        label: flagLabel,
        source: 'courtlistener',
        severity,
        surfaced_at: fetchedAt
      });
    } catch (err) {
      console.error('[run-kyc-sweep:courtlistener]', (err as Error).message);
      steps.push({ source: 'courtlistener', ran: false, hits: 0, skipReason: (err as Error).message });
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // Step 3: CFPB consumer complaints — REAL company-name lookup (#526)
  // ──────────────────────────────────────────────────────────────────────
  // No more manual-URL duct tape. fetchByCompany hits the CFPB search API
  // with company=<name>, returns up to 25 individual complaints, and we
  // persist each one as its own public_intel_records row so the Intelligence
  // Feed shows per-complaint detail (not just a state aggregate).
  if (company) {
    try {
      const complaints = await cfpbFetchByCompany(company, [], 1825, 25);
      const hits = complaints.length;
      // Severity ladder: 0 = clean (low/positive), 1-5 = low, 6-20 = medium, 21+ = high
      const severity: 'low' | 'medium' | 'high' =
        hits >= 21 ? 'high' : hits >= 6 ? 'medium' : 'low';
      const flagLabel = hits > 0
        ? `${hits} CFPB consumer complaint${hits === 1 ? '' : 's'} on file for "${company}" (last 5y)`
        : `CFPB: 0 consumer complaints on file for "${company}" (last 5y) — clean signal`;

      steps.push({
        source: 'cfpb',
        ran: true,
        hits,
        flagLabel,
        query: {
          company,
          states: stateHint,
          sinceDays: 1825,
          rawHits: hits,
          filteredHits: hits
        },
        // (#536) Top 5 complaints inline. CFPB complaint detail URL has no
        // public deep link — link to the CFPB search filtered to this co.
        topHits: complaints.slice(0, 5).map((c) => ({
          label: `${c.product}${c.sub_product ? ' / ' + c.sub_product : ''} — ${c.issue}`,
          sublabel: [c.state, c.date_received, c.company_response].filter(Boolean).join(' · '),
          url: `https://www.consumerfinance.gov/data-research/consumer-complaints/search/?company=${encodeURIComponent(company)}`,
          matchedQuery: company
        }))
      });

      // Persist each complaint to public_intel_records
      if (hits > 0) {
        try {
          const db = getAvDb();
          const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
          for (const c of complaints) {
            if (!c.complaint_id) continue;
            await db.execute<ResultSetHeader>(
              `INSERT INTO public_intel_records
                 (source_kind, entity_key, client_id, lead_id, record_json,
                  summary_label, region_code, fetched_at, expires_at)
               VALUES ('cfpb', ?, ?, NULL, CAST(? AS JSON), ?, ?, NOW(), ?)
               ON DUPLICATE KEY UPDATE
                 client_id = VALUES(client_id),
                 record_json = VALUES(record_json),
                 summary_label = VALUES(summary_label),
                 fetched_at = NOW(),
                 expires_at = VALUES(expires_at)`,
              [
                `cfpb:complaint:${c.complaint_id}`,
                clientId,
                JSON.stringify(c),
                `${c.product}${c.sub_product ? ' / ' + c.sub_product : ''} — ${c.issue}${c.state ? ' (' + c.state + ')' : ''}`.slice(0, 250),
                c.state ?? null,
                expiresAt
              ]
            );
          }
        } catch (err) {
          console.error('[run-kyc-sweep:cfpb:persist]', (err as Error).message);
        }
      }

      newFlags.push({
        id: newRedFlagId(),
        label: flagLabel,
        source: 'cfpb',
        severity,
        surfaced_at: fetchedAt
      });
    } catch (err) {
      console.error('[run-kyc-sweep:cfpb]', (err as Error).message);
      steps.push({ source: 'cfpb', ran: false, hits: 0, skipReason: (err as Error).message });
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // Persist red flags + stamp last_screened_at
  // ──────────────────────────────────────────────────────────────────────
  const current = await getDossier(clientId);
  // Dedup: drop existing flags with these sources from this sweep, replace
  // with the fresh ones so the timestamp updates.
  // Include legacy '*_manual' so old duct-tape flags from previous sweeps
  // get cleaned out and replaced with the real flags from #526.
  const sweepSources = new Set([
    'uspto_patents', 'courtlistener_manual', 'cfpb_manual',
    'cfpb', 'courtlistener'
  ]);
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
    flagsAdded: newFlags.length,
    briefSnapshot
  });
}
