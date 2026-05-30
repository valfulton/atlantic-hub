/**
 * lib/whois/enrich.ts  (#270)
 *
 * Per-lead enrich via WHOIS/RDAP. Reads the lead's website, normalizes to
 * a domain, fetches RDAP, fills blanks (email when registrant email is
 * public, address_country when registrant country is present), and stashes
 * the full RDAP payload in source_payload for the events tab to render
 * "Registered 2018-04-12, renewed 2025-04-13, registrar GoDaddy" etc.
 *
 * Never throws. Soft failures (no website, privacy redacted, unsupported TLD)
 * return {ok: true} with a note — the data we got IS useful even when there
 * was no contact info to fill (registration date alone is signal).
 */
import { getAvDb } from '@/lib/db/av';
import { enrichLeadFromSource } from '@/lib/enrichment/multi_source_enricher';
import { logEvent } from '@/lib/events/log';
import { rdapLookup, normalizeDomainForRdap } from '@/lib/whois/rdap';
import type { RdapResult } from '@/lib/whois/rdap';
import type { RowDataPacket } from 'mysql2';

export interface EnrichLeadFromWhoisResult {
  ok: boolean;
  filled?: number;
  fields?: string[];
  rdap?: RdapResult;
  reason?: string;
}

interface LeadRow extends RowDataPacket {
  id: number;
  website: string | null;
  email: string | null;
  address_country: string | null;
}

export async function enrichLeadFromWhois(args: {
  leadId: number;
  actorUserId?: number | null;
}): Promise<EnrichLeadFromWhoisResult> {
  if (!Number.isInteger(args.leadId) || args.leadId <= 0) {
    return { ok: false, reason: 'invalid lead id' };
  }
  const db = getAvDb();
  const [rows] = await db.execute<LeadRow[]>(
    `SELECT id, website, email, address_country FROM leads WHERE id = ? AND archived_at IS NULL LIMIT 1`,
    [args.leadId]
  );
  const lead = rows[0];
  if (!lead) return { ok: false, reason: 'lead not found or archived' };

  const domain = normalizeDomainForRdap(lead.website ?? '');
  if (!domain) {
    return { ok: false, reason: 'no website / domain on file — set Website on the Identity tab first.' };
  }

  const rdap = await rdapLookup(domain);
  if (!rdap.ok && !rdap.registeredAt) {
    // Hard miss — no domain found / RDAP server unreachable / unsupported TLD.
    await logEvent({
      eventType: 'whois.lead_enrich_failed',
      leadId: lead.id,
      userId: args.actorUserId ?? null,
      source: 'whois_rdap',
      status: 'failure',
      errorMessage: rdap.note ?? 'rdap lookup failed',
      payload: { domain }
    });
    return { ok: false, reason: rdap.note ?? 'WHOIS lookup failed.', rdap };
  }

  // Apply blanks-only fill via the shared enricher. We only set columns we
  // actually have AND that aren't already curated. The full RDAP blob goes
  // into source_payload via sourceMetadata for the events tab to render.
  const patch = {
    fields: {
      email: rdap.registrant.email ?? undefined,
      address_country: rdap.registrant.country ?? undefined
    },
    sourceMetadata: {
      whois_domain: rdap.domain,
      whois_registrar: rdap.registrar,
      whois_registered_at: rdap.registeredAt,
      whois_expires_at: rdap.expiresAt,
      whois_last_changed_at: rdap.lastChangedAt,
      whois_nameservers: rdap.nameservers,
      whois_statuses: rdap.statuses,
      whois_registrant_name: rdap.registrant.name,
      whois_registrant_organization: rdap.registrant.organization,
      whois_privacy_redacted: !!(rdap.note && rdap.note.toLowerCase().includes('privacy'))
    },
    note: 'whois/rdap enrichment'
  };

  const result = await enrichLeadFromSource({
    leadId: lead.id,
    source: 'whois_rdap',
    patch
  });

  await logEvent({
    eventType: 'whois.lead_enriched',
    leadId: lead.id,
    userId: args.actorUserId ?? null,
    source: 'whois_rdap',
    status: 'success',
    payload: {
      domain: rdap.domain,
      registrar: rdap.registrar,
      registered_at: rdap.registeredAt,
      privacy_redacted: !!(rdap.note && rdap.note.toLowerCase().includes('privacy')),
      filled: result.filled,
      filled_fields: result.fields
    }
  });

  return { ok: true, filled: result.filled, fields: result.fields, rdap };
}
