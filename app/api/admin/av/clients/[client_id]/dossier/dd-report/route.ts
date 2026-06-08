/**
 * POST /api/admin/av/clients/[client_id]/dossier/dd-report  (#525, val 2026-06-08)
 *
 * Generate a Pre-Engagement Intelligence Report — markdown formatted, ready
 * to copy into an email or print-to-PDF for a polished deliverable.
 *
 * Combines:
 *   - Brief: identity (company, contact, industry, website, description)
 *   - Dossier: addresses (history), prior entities, spouse, DOB year, notes,
 *     red flags by severity, last screened_at
 *   - Website audit: latest snapshot's 9-axis scores
 *   - Public records: most recent 30 records grouped by source_kind
 *
 * Per val's #524 directive: every artifact the engine produces must surface in
 * a polished, defensible form. This report is the "investor handoff" version
 * of the dossier — same data, formatted for an external audience.
 *
 * Operator-only. Returns { ok, markdown, meta }.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { getBriefPayload } from '@/lib/client/brief_store';
import { getDossier } from '@/lib/av/client_dossier';
import { getLatestSnapshot, AUDIT_AXES, AXIS_LABEL } from '@/lib/client/audit_snapshots';
import { getAvDb } from '@/lib/db/av';
import type { RowDataPacket } from 'mysql2';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RecordRow extends RowDataPacket {
  record_id: number;
  source_kind: string;
  entity_key: string;
  summary_label: string | null;
  region_code: string | null;
  fetched_at: Date;
}

const SOURCE_LABEL: Record<string, string> = {
  courtlistener: 'Court Records (federal courts + bankruptcy via CourtListener)',
  pacer_docket: 'PACER federal docket',
  ca_sos: 'California Secretary of State (corporate filings)',
  ucc_ca: 'UCC Filings (California)',
  cfpb: 'Consumer Financial Protection Bureau complaints',
  hmda: 'HMDA mortgage data',
  census_acs: 'Census ACS demographic data',
  gbp: 'Google Business Profile',
  uspto_patents: 'USPTO Patent Registrations',
  md_land_rec: 'Maryland Land Records',
  datasf: 'DataSF (San Francisco code violations)'
};

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return 'unknown';
  const date = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return 'unknown';
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function escapeMd(s: string | null | undefined): string {
  if (!s) return '';
  return String(s).replace(/[*_`[\]]/g, '\\$&');
}

export async function POST(req: NextRequest, { params }: { params: { client_id: string } }) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/clients/[client_id]/dossier/dd-report:POST',
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

  // ──────────────────────────────────────────────────────────────────────
  // Pull every source in parallel
  // ──────────────────────────────────────────────────────────────────────
  const [brief, dossier, audit] = await Promise.all([
    getBriefPayload('av', clientId) as Promise<Record<string, unknown> | null>,
    getDossier(clientId),
    getLatestSnapshot(clientId)
  ]);

  // Recent public_intel_records — last 30 grouped by source
  let records: RecordRow[] = [];
  try {
    const db = getAvDb();
    const [rows] = await db.execute<RecordRow[]>(
      `SELECT record_id, source_kind, entity_key, summary_label, region_code, fetched_at
         FROM public_intel_records
        WHERE client_id = ?
        ORDER BY fetched_at DESC
        LIMIT 30`,
      [clientId]
    );
    records = rows;
  } catch (err) {
    console.error('[dd-report:records]', (err as Error).message);
  }

  // ──────────────────────────────────────────────────────────────────────
  // Assemble fields
  // ──────────────────────────────────────────────────────────────────────
  const company = typeof brief?.company === 'string' ? brief.company : '(unspecified)';
  const contactName = typeof brief?.contact_name === 'string' ? brief.contact_name : '(unspecified)';
  const industry = typeof brief?.industry === 'string' ? brief.industry : null;
  const websiteUrl = typeof brief?.website_url === 'string' ? brief.website_url : null;
  const businessDesc = typeof brief?.business_description === 'string' ? brief.business_description : null;
  const generatedAt = new Date();

  // Group records by source
  const recordsBySource = new Map<string, RecordRow[]>();
  for (const r of records) {
    const arr = recordsBySource.get(r.source_kind) ?? [];
    arr.push(r);
    recordsBySource.set(r.source_kind, arr);
  }

  // Group flags by severity
  const flagsBySev = {
    high: dossier.redFlags.filter((f) => f.severity === 'high'),
    medium: dossier.redFlags.filter((f) => f.severity === 'medium'),
    low: dossier.redFlags.filter((f) => f.severity === 'low')
  };

  // ──────────────────────────────────────────────────────────────────────
  // Build markdown
  // ──────────────────────────────────────────────────────────────────────
  const md: string[] = [];

  md.push(`# Pre-Engagement Intelligence Report`);
  md.push(``);
  md.push(`**Subject:** ${escapeMd(company)}${contactName !== '(unspecified)' ? ` (${escapeMd(contactName)})` : ''}`);
  md.push(`**Prepared:** ${fmtDate(generatedAt)}`);
  md.push(`**Prepared by:** Atlantic & Vine`);
  md.push(`**Confidential — for recipient use only**`);
  md.push(``);
  md.push(`---`);
  md.push(``);

  // Executive summary — the punchy lede
  md.push(`## Executive Summary`);
  md.push(``);
  const flagCount = dossier.redFlags.length;
  if (flagCount === 0) {
    md.push(`No risk indicators surfaced during this screen. All available public records returned clean results. Recommend standard engagement terms.`);
  } else {
    const sevSummary: string[] = [];
    if (flagsBySev.high.length > 0) sevSummary.push(`${flagsBySev.high.length} high-severity`);
    if (flagsBySev.medium.length > 0) sevSummary.push(`${flagsBySev.medium.length} medium-severity`);
    if (flagsBySev.low.length > 0) sevSummary.push(`${flagsBySev.low.length} low-severity`);
    md.push(`Screening surfaced **${flagCount} risk indicator${flagCount === 1 ? '' : 's'}** (${sevSummary.join(', ')}) across public records. The most material finding${flagsBySev.high.length === 1 ? ' is' : flagsBySev.high.length > 1 ? 's are' : flagsBySev.medium.length === 1 ? ' is' : ' are'}:`);
    md.push(``);
    const topFlags = [...flagsBySev.high, ...flagsBySev.medium].slice(0, 3);
    for (const f of topFlags) {
      md.push(`- **${escapeMd(f.label)}**`);
    }
    if (flagsBySev.high.length === 0 && flagsBySev.medium.length === 0) {
      for (const f of flagsBySev.low.slice(0, 3)) {
        md.push(`- ${escapeMd(f.label)}`);
      }
    }
    md.push(``);
    md.push(`Review the full risk register and supporting records below before proceeding.`);
  }
  md.push(``);

  // Identity
  md.push(`## Identity`);
  md.push(``);
  md.push(`| Field | Value |`);
  md.push(`|---|---|`);
  md.push(`| Legal entity | ${escapeMd(company)} |`);
  md.push(`| Primary contact | ${escapeMd(contactName)} |`);
  if (industry) md.push(`| Industry | ${escapeMd(industry)} |`);
  if (websiteUrl) md.push(`| Website | ${escapeMd(websiteUrl)} |`);
  if (dossier.dobYear) md.push(`| Contact birth year | ${dossier.dobYear} |`);
  if (dossier.spouseOrCosignerName) md.push(`| Spouse / co-signer | ${escapeMd(dossier.spouseOrCosignerName)} |`);
  if (dossier.lastScreenedAt) md.push(`| Last automated screen | ${fmtDate(dossier.lastScreenedAt)} |`);
  md.push(``);

  if (businessDesc) {
    md.push(`### Business description (per subject)`);
    md.push(``);
    md.push(`> ${escapeMd(businessDesc)}`);
    md.push(``);
  }

  // Addresses
  md.push(`## Address History`);
  md.push(``);
  if (dossier.addressHistory.length === 0) {
    md.push(`No addresses on file at time of report generation.`);
  } else {
    md.push(`The following addresses are associated with the subject across public records and operator-curated sources:`);
    md.push(``);
    md.push(`| Address | Source | Label | Captured |`);
    md.push(`|---|---|---|---|`);
    for (const a of dossier.addressHistory) {
      md.push(`| ${escapeMd(a.address)} | \`${a.source}\` | ${escapeMd(a.label || '—')} | ${fmtDate(a.captured_at)} |`);
    }
  }
  md.push(``);

  // Prior entities
  if (dossier.priorEntities) {
    md.push(`## Prior Business Entities`);
    md.push(``);
    md.push(`Operator has flagged the following prior / parallel entities associated with this subject:`);
    md.push(``);
    md.push(`> ${escapeMd(dossier.priorEntities)}`);
    md.push(``);
    md.push(`Verification of corporate status for each of the above is recommended via the relevant state Secretary of State.`);
    md.push(``);
  }

  // Risk indicators (the meat)
  md.push(`## Risk Indicators`);
  md.push(``);
  if (flagCount === 0) {
    md.push(`No risk indicators recorded.`);
  } else {
    if (flagsBySev.high.length > 0) {
      md.push(`### High Severity (${flagsBySev.high.length})`);
      md.push(``);
      for (const f of flagsBySev.high) {
        md.push(`- **${escapeMd(f.label)}**`);
        md.push(`  - Source: \`${f.source}\` · Surfaced: ${fmtDate(f.surfaced_at)}`);
      }
      md.push(``);
    }
    if (flagsBySev.medium.length > 0) {
      md.push(`### Medium Severity (${flagsBySev.medium.length})`);
      md.push(``);
      for (const f of flagsBySev.medium) {
        md.push(`- ${escapeMd(f.label)}`);
        md.push(`  - Source: \`${f.source}\` · Surfaced: ${fmtDate(f.surfaced_at)}`);
      }
      md.push(``);
    }
    if (flagsBySev.low.length > 0) {
      md.push(`### Low Severity (${flagsBySev.low.length})`);
      md.push(``);
      for (const f of flagsBySev.low) {
        md.push(`- ${escapeMd(f.label)}`);
      }
      md.push(``);
    }
  }

  // Website audit
  if (audit && audit.scores.overall_avg !== null) {
    md.push(`## Website Health Audit`);
    md.push(``);
    md.push(`**Overall score: ${audit.scores.overall_avg.toFixed(1)} / 10**`);
    md.push(`Audit run ${fmtDate(audit.created_at)} against \`${audit.homepage_url}\` (${audit.pages_reached ?? '?'} pages reached).`);
    md.push(``);
    md.push(`| Axis | Score |`);
    md.push(`|---|---|`);
    for (const axis of AUDIT_AXES) {
      const v = audit.scores[axis];
      if (v !== null) {
        md.push(`| ${AXIS_LABEL[axis]} | ${v} / 10 |`);
      }
    }
    md.push(``);
    const weak = AUDIT_AXES.filter((a) => {
      const v = audit.scores[a];
      return typeof v === 'number' && v < 5;
    });
    if (weak.length > 0) {
      md.push(`**Weak axes (< 5/10):** ${weak.map((a) => AXIS_LABEL[a]).join(', ')}.`);
      md.push(``);
    }
  }

  // Public records
  if (records.length > 0) {
    md.push(`## Public Records Findings`);
    md.push(``);
    md.push(`The following public-data sources have returned records for this subject in the last 90 days:`);
    md.push(``);
    for (const [sourceKind, list] of recordsBySource.entries()) {
      md.push(`### ${SOURCE_LABEL[sourceKind] ?? sourceKind} (${list.length})`);
      md.push(``);
      for (const r of list.slice(0, 10)) {
        md.push(`- ${escapeMd(r.summary_label || r.entity_key)} ${r.region_code ? `(${r.region_code})` : ''} — ${fmtDate(r.fetched_at)}`);
      }
      if (list.length > 10) {
        md.push(`- … and ${list.length - 10} more`);
      }
      md.push(``);
    }
  }

  // Operator notes (free-form)
  if (dossier.notesMd && dossier.notesMd.trim()) {
    md.push(`## Operator Notes`);
    md.push(``);
    md.push(dossier.notesMd);
    md.push(``);
  }

  // Methodology + disclaimer
  md.push(`---`);
  md.push(``);
  md.push(`## Methodology`);
  md.push(``);
  md.push(`This report aggregates data from public-data adapters operated by Atlantic & Vine, including United States Patent and Trademark Office records (USPTO PatentsView), federal court filings (CourtListener / free.law), consumer financial complaints (CFPB), state corporate registries (CA SOS, GA SOS, MD Land Records), and operator-curated observations.`);
  md.push(``);
  md.push(`Findings are point-in-time as of the report generation date shown above. Public records may be incomplete or out of date. Recipients should verify material findings with primary sources before making binding decisions.`);
  md.push(``);
  md.push(`This report does not constitute legal, financial, or investment advice.`);
  md.push(``);
  md.push(`---`);
  md.push(``);
  md.push(`*Prepared by Atlantic & Vine · atlanticandvine.com · ${fmtDate(generatedAt)}*`);

  const markdown = md.join('\n');

  return NextResponse.json({
    ok: true,
    markdown,
    meta: {
      generatedAt: generatedAt.toISOString(),
      subject: company,
      flagCount,
      recordCount: records.length,
      auditScore: audit?.scores.overall_avg ?? null
    }
  });
}
