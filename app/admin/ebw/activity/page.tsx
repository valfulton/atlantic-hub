import { serverFetch } from '@/lib/server-fetch';
import { AddActivityForm } from './AddActivityForm';

interface Activity {
  activityId: number;
  occurredOn: string;
  activityType: string;
  prospectAuditId: string | null;
  prospectLabel: string | null;
  outcome: string | null;
  notes: string | null;
}

const TYPE_LABEL: Record<string, string> = {
  cold_call: 'Cold call', cold_email: 'Cold email', dm: 'DM', meeting: 'Meeting',
  demo: 'Demo', follow_up: 'Follow-up', proposal_sent: 'Proposal sent',
  contract_sent: 'Contract sent', other: 'Other'
};
const OUTCOME_LABEL: Record<string, string> = {
  no_answer: 'No answer', left_voicemail: 'Left voicemail', interested: 'Interested',
  not_interested: 'Not interested', meeting_scheduled: 'Meeting scheduled', closed: 'Closed', other: 'Other'
};

export default async function EbwActivityPage() {
  const res = await serverFetch('/api/admin/ebw/activity');
  const { activity }: { activity: Activity[] } = res.ok ? await res.json() : { activity: [] };

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-1">Marketing activity</h1>
      <p className="text-sm text-muted mb-6">Cold calls, emails, meetings — track every outreach.</p>

      <AddActivityForm />

      <h2 className="text-sm font-medium text-muted mt-8 mb-3">Recent activity ({activity.length})</h2>
      {activity.length === 0 ? (
        <div className="px-6 py-12 text-center text-sm text-muted bg-surface border border-border rounded-lg">
          No activity logged yet.
        </div>
      ) : (
        <ul className="space-y-2">
          {activity.map((a) => (
            <li key={a.activityId} className="bg-surface border border-border rounded-lg px-4 py-3 text-sm">
              <div className="flex items-baseline justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <span className="font-medium">{TYPE_LABEL[a.activityType] || a.activityType}</span>
                  {a.prospectLabel && <span className="text-muted"> · {a.prospectLabel}</span>}
                  {a.outcome && <span className="ml-2 text-xs px-2 py-0.5 bg-white border border-border rounded-md">{OUTCOME_LABEL[a.outcome] || a.outcome}</span>}
                  {a.notes && <div className="text-xs text-muted mt-1">{a.notes}</div>}
                </div>
                <div className="text-xs text-muted whitespace-nowrap">{a.occurredOn}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
