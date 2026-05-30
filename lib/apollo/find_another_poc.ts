/**
 * lib/apollo/find_another_poc.ts  (#252 Inc 3)
 *
 * Operator workflow: val is looking at a lead, the contact is the wrong
 * person (e.g. Skip got an HR Director when his ICP excludes HR), and she
 * wants to surface ANOTHER person at the same company without burning a
 * full discovery batch. Goal: cheapest single-credit Apollo re-call.
 *
 * The implementation:
 *   1. Reads the existing lead's apollo_organization_id from source_payload
 *      + its current contact's title.
 *   2. Loads the client's ICP title prefs (Inc 1 schema).
 *   3. Calls apolloOrganizationTopPeople(orgId, perPage=10) — ONE Apollo call.
 *   4. Applies the same `lib/leads/title_filter` used by the bulk discovery,
 *      with the CURRENT contact's title temporarily added to the excluded
 *      list so the same person doesn't come back. Also skips by apollo_person_id
 *      in case Apollo returns a duplicate.
 *   5. Picks the first survivor, synthesizes an ApolloOrganization shape from
 *      the existing lead row (no second Apollo enrich call), and inserts via
 *      `insertApolloPersonAsLead` — same writer as bulk discovery, so the
 *      new lead lands in the exact same shape as a discovery-inserted lead.
 *
 * Returns the new lead's audit_id when it inserted, or a "soft failure" with
 * `reason` when there was nothing usable to insert (all of Apollo's top
 * people at the org matched the excluded list, the org has nobody else
 * listed, etc.). Never throws — the UI surfaces the reason inline.
 */
import { getAvDb } from '@/lib/db/av';
import { apolloOrganizationTopPeople } from '@/lib/apollo/search';
import { insertApolloPersonAsLead } from '@/lib/apollo/discoverer';
import { getClientIcp } from '@/lib/client/icp';
import { buildTitlePrefs, filterAndRank } from '@/lib/leads/title_filter';
import { logEvent } from '@/lib/events/log';
import type { RowDataPacket } from 'mysql2';

export interface FindAnotherPocResult {
  ok: boolean;
  /** When success: the newly-inserted lead's audit_id, contact name, title. */
  newAuditId?: string;
  newContactName?: string;
  newContactTitle?: string | null;
  newLeadId?: number;
  /** Counts from the title filter — useful for the operator panel diagnostic. */
  candidatesReturned?: number;
  candidatesAfterFilter?: number;
  /** Soft failure reason when ok=false. */
  reason?: string;
}

interface LeadSnapshot extends RowDataPacket {
  id: number;
  company: string | null;
  website: string | null;
  normalized_domain: string | null;
  phone: string | null;
  industry: string | null;
  contact_title: string | null;
  client_id: number | null;
  source_payload: string | object | null;
}

function asObj(raw: string | object | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function findAnotherPocForLead(args: { auditId: string }): Promise<FindAnotherPocResult> {
  const db = getAvDb();
  const [rows] = await db.execute<LeadSnapshot[]>(
    `SELECT id, company, website, normalized_domain, phone, industry, contact_title,
            client_id, source_payload
       FROM leads
      WHERE audit_id = ? AND archived_at IS NULL
      LIMIT 1`,
    [args.auditId]
  );
  const lead = rows[0];
  if (!lead) return { ok: false, reason: 'lead not found or archived' };

  // Extract the apollo_organization_id from source_payload. Without it we
  // can't re-call Apollo for this org — the path only works for leads that
  // originally came from Apollo (organization_top_people path).
  const sp = asObj(lead.source_payload);
  const apolloOrgId = typeof sp['apollo_organization_id'] === 'string'
    ? (sp['apollo_organization_id'] as string).trim()
    : '';
  if (!apolloOrgId) {
    return { ok: false, reason: 'This lead did not come from Apollo — Find another POC only works for Apollo-sourced leads.' };
  }

  // Pull the client's title prefs (Inc 1) + add the current contact's title
  // to the excluded list so the same person doesn't get re-suggested by a
  // permissive substring match. Operator runs (client_id null) use just the
  // current-title exclusion — no client ICP to lean on.
  let preferred: string[] = [];
  let excluded: string[] = [];
  if (lead.client_id) {
    try {
      const icp = await getClientIcp(lead.client_id);
      preferred = icp.preferredContactTitles ?? [];
      excluded = icp.excludedContactTitles ?? [];
    } catch {
      /* non-fatal: fall through with no ICP filters */
    }
  }
  if (lead.contact_title && lead.contact_title.trim()) {
    excluded = [...excluded, lead.contact_title.trim()];
  }
  const prefs = buildTitlePrefs({ preferredContactTitles: preferred, excludedContactTitles: excluded });

  // The cheapest single-credit re-call. Per-page = 10 so we have headroom
  // to filter the current contact + any HR/Recruiter peers without coming
  // back empty in 80% of cases.
  let topPeople;
  try {
    topPeople = await apolloOrganizationTopPeople(apolloOrgId, { perPage: 10 });
  } catch (err) {
    await logEvent({
      eventType: 'apollo.find_another_poc_failed',
      leadId: lead.id,
      source: 'apollo',
      status: 'failure',
      errorMessage: (err as Error).message.slice(0, 400),
      payload: { apollo_org_id: apolloOrgId, stage: 'fetch' }
    });
    return { ok: false, reason: 'Could not reach Apollo. Try again in a minute.' };
  }

  const totalReturned = topPeople.people.length;
  if (totalReturned === 0) {
    return { ok: false, reason: 'Apollo has no other people listed at this company.', candidatesReturned: 0, candidatesAfterFilter: 0 };
  }

  // Apply the title filter (drops excluded, ranks preferred first), then
  // additionally skip Apollo's id for the current lead's person — defense
  // in depth against the title filter being too loose.
  const currentApolloPersonIdRaw = typeof sp['apollo_person_id'] === 'string' ? (sp['apollo_person_id'] as string).trim() : '';
  const currentPersonId = currentApolloPersonIdRaw.replace(/^c\d+:/, ''); // unscope the client prefix

  const { kept, counts } = filterAndRank(
    topPeople.people,
    (p) => p.title || p.headline || null,
    prefs
  );
  const survivors = kept.filter((p) => p.id !== currentPersonId);

  if (survivors.length === 0) {
    await logEvent({
      eventType: 'apollo.find_another_poc_no_survivor',
      leadId: lead.id,
      source: 'apollo',
      status: 'partial',
      payload: {
        apollo_org_id: apolloOrgId,
        client_id: lead.client_id,
        candidates_returned: totalReturned,
        excluded_by_title: counts.excluded
      }
    });
    return {
      ok: false,
      reason: counts.excluded > 0
        ? `All ${totalReturned} people Apollo listed at this company were filtered out by the ICP exclusion rules.`
        : `Apollo only had the current contact at this company.`,
      candidatesReturned: totalReturned,
      candidatesAfterFilter: survivors.length
    };
  }

  // Synthesize an ApolloOrganization shape from the existing lead row so
  // insertApolloPersonAsLead doesn't need a second Apollo enrich call. We
  // have everything it actually USES (name, website, phone, industry, id);
  // the rest of the ApolloOrganization type goes undefined and the inserter
  // tolerates that on the existing org-path.
  const orgShim = {
    id: apolloOrgId,
    name: lead.company || 'Unknown company',
    website_url: lead.website,
    primary_domain: lead.normalized_domain,
    primary_phone: lead.phone ? { number: lead.phone } : null,
    industry: lead.industry
  } as Parameters<typeof insertApolloPersonAsLead>[1];

  const pick = survivors[0];
  const result = await insertApolloPersonAsLead(pick, orgShim, lead.client_id);

  if (result.outcome === 'inserted_person' && result.leadId) {
    // Resolve the new audit_id so the UI can deep-link to it.
    let newAuditId: string | undefined;
    try {
      const [r] = await db.execute<(RowDataPacket & { audit_id: string })[]>(
        `SELECT audit_id FROM leads WHERE id = ? LIMIT 1`,
        [result.leadId]
      );
      newAuditId = r[0]?.audit_id;
    } catch { /* non-fatal */ }

    await logEvent({
      eventType: 'apollo.find_another_poc_succeeded',
      leadId: lead.id,
      source: 'apollo',
      status: 'success',
      payload: {
        apollo_org_id: apolloOrgId,
        client_id: lead.client_id,
        candidates_returned: totalReturned,
        excluded_by_title: counts.excluded,
        new_lead_id: result.leadId,
        new_contact_name: result.details?.contactName,
        new_contact_title: result.details?.contactTitle
      }
    });

    return {
      ok: true,
      newAuditId,
      newLeadId: result.leadId,
      newContactName: result.details?.contactName,
      newContactTitle: result.details?.contactTitle ?? null,
      candidatesReturned: totalReturned,
      candidatesAfterFilter: survivors.length
    };
  }

  if (result.outcome === 'duplicate') {
    return {
      ok: false,
      reason: `That person is already in your pipeline (${result.details?.contactName ?? 'duplicate lead'}).`,
      candidatesReturned: totalReturned,
      candidatesAfterFilter: survivors.length
    };
  }

  return {
    ok: false,
    reason: result.details?.error || 'Insert failed.',
    candidatesReturned: totalReturned,
    candidatesAfterFilter: survivors.length
  };
}
