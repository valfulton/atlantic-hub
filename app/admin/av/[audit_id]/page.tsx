import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import Link from 'next/link';
import { serverFetch } from '@/lib/server-fetch';
import { StatusBadge } from '@/components/StatusBadge';
import { LeadDetailTabs } from './LeadDetailTabs';
import { LeadCampaigns } from './LeadCampaigns';
import { SocialContentButton } from './SocialContentButton';
import { RescoreButton } from './RescoreButton';
import { AssignmentControl } from './AssignmentControl';
import { MakeClientButton } from './MakeClientButton';
import { AssignToClientControl } from './AssignToClientControl';
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

      <div className="bg-surface border border-border rounded-xl p-6">
        <LeadDetailTabs lead={lead} />
      </div>
    </div>
  );
}
