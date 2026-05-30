import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import Link from 'next/link';
import { serverFetch } from '@/lib/server-fetch';
import { StatusBadge } from '@/components/StatusBadge';
import { LeadDetailTabs } from './LeadDetailTabs';
import { LeadCampaigns } from './LeadCampaigns';
import { SocialContentButton } from './SocialContentButton';
import { SmartEnrichButton } from './SmartEnrichButton';
import { FindAnotherPocButton } from './FindAnotherPocButton';
import { RescoreButton } from './RescoreButton';
import { ProspectIntelPanel } from '@/app/_components/ProspectIntelPanel';
import { IntakeDraftEditor } from './IntakeDraftEditor';
import { LeadNarrativeLines } from './LeadNarrativeLines';
import { EnrichFromPlacesButton } from './EnrichFromPlacesButton';
import { AssignmentControl } from './AssignmentControl';
import { MakeClientButton } from './MakeClientButton';
import { AssignToClientControl } from './AssignToClientControl';
import ArchiveLeadButton from './ArchiveLeadButton';
import { listClientAccounts } from '@/lib/av/clients_overview';
import { AnimatedScoreReveal } from '@/components/AnimatedScoreReveal';

export default async function AvLeadDetailPage({
  params
}: {
  params: { audit_id: string };
}) {
  const res = await serverFetch(`/api/admin/av/leads/${params.audit_id}`);

  if (!res.ok) notFound();

  const { lead } = await res.json();

  // Current admin user (from middleware headers) -- used by AssignmentControl
  // to show "Assign to me" and "Hand to <owner>" correctly.
  const currentUserId = parseInt(headers().get('x-ah-user-id') ?? '0', 10) || 0;

  // Clients for the lead-handoff picker (assign this lead to a client's pipeline).
  let clientOptions: { clientId: number; name: string }[] = [];
  try {
    clientOptions = (await listClientAccounts()).map((c) => ({ clientId: c.clientId, name: c.name }));
  } catch {
    /* non-fatal: handoff picker simply shows no clients */
  }

  return (
    <div>
      <div className="text-sm text-muted mb-4">
        <Link href="/admin/av" className="hover:text-ink transition-colors">
          Atlantic &amp; Vine
        </Link>
        <span className="mx-1.5">/</span>
        <span className="text-ink">{lead.company}</span>
      </div>

      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold">{lead.company}</h1>
          <p className="text-sm text-muted mt-1">
            {lead.email}
            {lead.industry ? ` · ${lead.industry}` : ''}
            {' · Submitted '}
            {new Date(lead.submissionDate).toLocaleDateString('en-US', {
              month: 'long',
              day: 'numeric',
              year: 'numeric'
            })}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
          <AssignmentControl
            auditId={lead.auditId}
            currentAssignedTo={lead.assignedToUserId ?? null}
            currentHandedToOwnerAt={lead.handedToOwnerAt ?? null}
            currentUserId={currentUserId}
          />
          <RescoreButton auditId={lead.auditId} />
          <MakeClientButton
            auditId={lead.auditId}
            email={lead.email ?? null}
            company={lead.company ?? null}
            contactName={lead.contactName ?? null}
            industry={lead.industry ?? null}
            clientId={lead.clientId ?? null}
          />
          <AssignToClientControl
            auditId={lead.auditId}
            clients={clientOptions}
            currentClientId={lead.clientId ?? null}
          />
          <SocialContentButton auditId={lead.auditId} />
          {/* (#251 Inc 1c-prime) Operator-side trigger for the smart LLM
              scraper. One click reads the lead's website and fills any blank
              column (industry, contact, phone) + stashes the full intake-shape
              draft on source_payload for the #253 lead→client carryover. */}
          <SmartEnrichButton auditId={lead.auditId} hasWebsite={!!lead.website} />
          {/* (#268) Per-lead Google Places enrich — one click, real endpoint,
              blanks-only fill. Refuses cleanly on no/ambiguous match. Replaces
              the earlier deep-link approach. */}
          <EnrichFromPlacesButton auditId={lead.auditId} hasCompany={!!(lead.company && lead.company.trim())} />
          {/* (#267) Instagram still uses a deep-link until the matching
              per-lead endpoint lands — same pattern, follow-up ticket. */}
          {lead.company && (
            <Link
              href={`/admin/av/discover?source=instagram&q=${encodeURIComponent(lead.company)}`}
              title="Search Instagram for this company — if found, fills any blank fields (handle, bio, contact email)."
              className="text-sm px-3 py-1.5 rounded-md inline-flex items-center gap-1.5 border border-border text-ink hover:border-amber-400/40 bg-black/20 transition"
            >
              📷 Try IG
            </Link>
          )}
          {/* (#252 Inc 3) One-Apollo-credit re-call: skip the current contact's
              title + any ICP-excluded titles, insert the first survivor as a
              new sibling lead at the same company. Disabled with a tooltip
              when the lead isn't Apollo-sourced. */}
          <FindAnotherPocButton auditId={lead.auditId} hasApolloOrg={!!lead.hasApolloOrg} />
          <ArchiveLeadButton auditId={lead.auditId} />
          <StatusBadge value={lead.leadStatus} />
          <AnimatedScoreReveal
            score={lead.aiCombinedScore ?? lead.aiScore}
            band={lead.aiScoreBand as 'hot' | 'warm' | 'cool' | null}
            breakdown={lead.aiScoreBreakdown as
              | { fit: number; intent: number; reachability: number; icp_match: number }
              | null
              | undefined}
          />
        </div>
      </div>

      <LeadCampaigns leadId={lead.id} />

      {/* (#46 spine Inc 1) The narrative spine, seen FROM the lead — which of
          this owner's active lines does this lead support, with one-click
          link/role/unlink. Hides entirely when the owner has no active lines,
          so it adds zero visual weight on day one and lights up the moment
          val starts steering on a thesis. */}
      <LeadNarrativeLines auditId={lead.auditId} />

      {/* (#253) Same prospect-intel card the client sees on their lead view —
          shared component so the two surfaces can't drift. Renders nothing
          when the smart scraper hasn't run yet, in which case there's no
          new visual weight on the page. */}
      {lead.prospectIntel && (
        <div className="mb-4">
          <ProspectIntelPanel intel={lead.prospectIntel} />
        </div>
      )}

      {/* (#253 step 5) Operator-only editor for the lead's intake draft. Sits
          BELOW the read-only ProspectIntelPanel so val sees the rendered
          version first, then can click "Edit" to refine. Survives across
          re-runs of Smart enrich (the smart scraper writes blanks-only so it
          won't clobber val's edits). The full draft carries forward to the
          new client's intake when she clicks Make Client. */}
      <div className="mb-4">
        <IntakeDraftEditor auditId={lead.auditId} />
      </div>

      <div className="bg-surface border border-border rounded-xl p-6">
        <LeadDetailTabs lead={lead} />
      </div>
    </div>
  );
}
