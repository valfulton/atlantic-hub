/**
 * /admin/av/lead/[audit_id]  —  "leads that dont suck ass"  (#275)
 *
 * The new lead detail page val asked for. Designed around three rules she
 * spelled out, in order of importance:
 *
 *   1. LEGIBLE. Labels are text-sm (14px), values are text-base (16px),
 *      no dimming, full design-token contrast. The old page used text-[10px]
 *      labels and text-white/90 values; that's the disease, not the look.
 *   2. EDIT IN PLACE. Every identity field is click-to-edit on this page.
 *      No "go to a different page to fix the company name." Same for the
 *      notes field at the bottom.
 *   3. NO MAZE. One linear top-to-bottom page. No tabs. Identity, audit,
 *      campaigns, notes — visible at once. If a section gets too long it
 *      uses native <details> to collapse, never a tab.
 *
 * Wires to the existing API. Nothing new on the server. The PATCH endpoint
 * at /api/admin/av/leads/[audit_id] already accepts the identity field
 * whitelist + notes, so this page is purely a fresh UI on existing data.
 *
 * Coexists with the old page at /admin/av/[audit_id] — that one stays for
 * now so nothing breaks. When val confirms this one feels right, we point
 * the cockpit's lead-row links here and retire the old.
 */
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { serverFetch } from '@/lib/server-fetch';
import { EditableField } from './EditableField';
import { MakeClientButton } from '../../[audit_id]/MakeClientButton';
import { SmartEnrichButton } from '../../[audit_id]/SmartEnrichButton';
import { EnrichFromSourcesMenu } from '../../[audit_id]/EnrichFromSourcesMenu';
import ArchiveLeadButton from '../../[audit_id]/ArchiveLeadButton';

interface Lead {
  id: number;
  auditId: string;
  company: string | null;
  contactName: string | null;
  contactTitle: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  industry: string | null;
  addressStreet: string | null;
  addressCity: string | null;
  addressState: string | null;
  addressPostal: string | null;
  addressCountry: string | null;
  auditContent: string | null;
  auditGenerated: string | null;
  notes: string | null;
  leadStatus: string;
  aiScore: number | null;
  aiCombinedScore: number | null;
  aiScoreBand: string | null;
  aiScoreReason: string | null;
  clientId: number | null;
  archivedAt: string | null;
}

export default async function NewLeadPage({
  params
}: {
  params: { audit_id: string };
}) {
  const res = await serverFetch(`/api/admin/av/leads/${params.audit_id}`);
  if (!res.ok) notFound();
  const { lead } = (await res.json()) as { lead: Lead };

  const score = lead.aiCombinedScore ?? lead.aiScore;
  const addressBits = [
    lead.addressStreet,
    lead.addressCity,
    lead.addressState,
    lead.addressPostal,
    lead.addressCountry
  ].filter(Boolean);

  return (
    <div className="max-w-4xl">
      {/* Breadcrumb — readable, not a tiny squint-line. */}
      <nav className="text-sm text-muted mb-6">
        <Link href="/admin/av" className="hover:text-ink transition-colors">
          Atlantic &amp; Vine
        </Link>
        <span className="mx-2">/</span>
        <span className="text-ink">{lead.company || 'Untitled lead'}</span>
      </nav>

      {/* Title block — large, readable. Score and status on their own line
          so they wrap independently and never push the title off-screen. */}
      <header className="mb-6">
        <h1 className="text-3xl font-semibold text-ink break-words leading-tight">
          {lead.company || 'Untitled lead'}
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-base text-muted">
          {score != null && (
            <span>
              <span className="text-ink font-semibold">{score}</span>
              {lead.aiScoreBand && <span className="ml-1.5 uppercase tracking-wide text-sm">{lead.aiScoreBand}</span>}
            </span>
          )}
          {lead.leadStatus && (
            <span className="capitalize">{lead.leadStatus.replace(/_/g, ' ')}</span>
          )}
          {lead.archivedAt && (
            <span className="text-[var(--gold-bright)]">Archived</span>
          )}
        </div>
      </header>

      {/* Action row — wraps cleanly. No shrink-0 forcing the row wide. */}
      <div className="mb-8 flex flex-wrap items-center gap-2">
        <MakeClientButton
          auditId={lead.auditId}
          email={lead.email ?? null}
          company={lead.company ?? null}
          contactName={lead.contactName ?? null}
          industry={lead.industry ?? null}
          clientId={lead.clientId ?? null}
        />
        <SmartEnrichButton auditId={lead.auditId} hasWebsite={!!lead.website} />
        <EnrichFromSourcesMenu
          auditId={lead.auditId}
          hasWebsite={!!(lead.website && lead.website.trim())}
          hasCompany={!!(lead.company && lead.company.trim())}
        />
        <ArchiveLeadButton auditId={lead.auditId} />
      </div>

      {/* Identity — editable in place. Two-column grid on desktop, single
          column on phones. Each field gets generous height so click targets
          are real, not 12px slivers. */}
      <section className="mb-6 bg-surface border border-border rounded-xl p-6">
        <h2 className="text-base font-semibold text-ink mb-5">Identity</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-5">
          <EditableField auditId={lead.auditId} fieldKey="company"      label="Company"      value={lead.company} />
          <EditableField auditId={lead.auditId} fieldKey="industry"     label="Industry"     value={lead.industry} />
          <EditableField auditId={lead.auditId} fieldKey="contactName"  label="Contact"      value={lead.contactName} />
          <EditableField auditId={lead.auditId} fieldKey="contactTitle" label="Title"        value={lead.contactTitle} />
          <EditableField auditId={lead.auditId} fieldKey="email"        label="Email"        value={lead.email} />
          <EditableField auditId={lead.auditId} fieldKey="phone"        label="Phone"        value={lead.phone} />
          <EditableField auditId={lead.auditId} fieldKey="website"      label="Website"      value={lead.website} />
        </div>
        {/* Address shown as a single line — readable, not split across five
            tiny columns. Editing address is a separate sweep; for now this
            just SHOWS what was filled (Apollo / Places usually). */}
        {addressBits.length > 0 && (
          <div className="mt-6 pt-5 border-t border-border">
            <div className="text-sm font-medium text-muted mb-1.5">Address</div>
            <div className="text-base text-ink">{addressBits.join(', ')}</div>
          </div>
        )}
      </section>

      {/* What to say on the call — the audit, inline. No tab, no click-through.
          When it's missing the section just doesn't render. */}
      {lead.auditContent && lead.auditContent.trim() && (
        <section className="mb-6 bg-surface border border-border rounded-xl p-6">
          <h2 className="text-base font-semibold text-ink mb-2">What to say on the call</h2>
          {lead.auditGenerated && (
            <div className="text-sm text-muted mb-3">
              Refreshed {new Date(lead.auditGenerated).toLocaleString()}
            </div>
          )}
          <p className="text-base text-ink whitespace-pre-wrap leading-relaxed">
            {lead.auditContent}
          </p>
        </section>
      )}

      {/* AI score reasoning — when present, shown plainly. */}
      {lead.aiScoreReason && (
        <section className="mb-6 bg-surface border border-border rounded-xl p-6">
          <h2 className="text-base font-semibold text-ink mb-2">Why this score</h2>
          <p className="text-base text-ink leading-relaxed">{lead.aiScoreReason}</p>
        </section>
      )}

      {/* Notes — editable in place, just like identity fields. */}
      <section className="mb-6 bg-surface border border-border rounded-xl p-6">
        <h2 className="text-base font-semibold text-ink mb-3">Your notes</h2>
        <EditableField
          auditId={lead.auditId}
          fieldKey="notes"
          label="Notes"
          value={lead.notes}
          multiline
          placeholder="No notes yet — click to add"
        />
      </section>

      {/* Footer breadcrumb back — small, polite. */}
      <div className="mt-10 text-sm text-muted">
        <Link href="/admin/av" className="hover:text-ink transition-colors">
          ← Back to leads
        </Link>
      </div>
    </div>
  );
}
