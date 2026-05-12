import { notFound } from 'next/navigation';
import Link from 'next/link';
import { serverFetch } from '@/lib/server-fetch';
import { StatusBadge } from '@/components/StatusBadge';
import { LeadDetailTabs } from './LeadDetailTabs';

export default async function AvLeadDetailPage({
  params
}: {
  params: { audit_id: string };
}) {
  const res = await serverFetch(`/api/admin/av/leads/${params.audit_id}`);

  if (!res.ok) notFound();

  const { lead } = await res.json();

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
        <div className="flex items-center gap-2 shrink-0">
          <StatusBadge value={lead.leadStatus} />
          {lead.aiScoreBand && <StatusBadge value={lead.aiScoreBand} />}
        </div>
      </div>

      <div className="bg-surface border border-border rounded-xl p-6">
        <LeadDetailTabs lead={lead} />
      </div>
    </div>
  );
}
