'use client';
import { useState } from 'react';
import { StatusBadge } from '@/components/StatusBadge';

const TABS = ['Identity', 'Audit', 'Challenge', 'AI Scoring', 'Notes', 'Events'] as const;
type Tab = (typeof TABS)[number];

interface Lead {
  id: number;
  auditId: string;
  company: string;
  contactName: string | null;
  email: string;
  phone: string | null;
  website: string | null;
  industry: string | null;
  challenge: string | null;
  auditContent: string | null;
  auditGenerated: string | null;
  isApproved: boolean;
  approvalDate: string | null;
  approvedBy: string | null;
  submissionDate: string;
  leadStatus: string;
  followUpDate: string | null;
  notes: string | null;
  aiScore: number | null;
  aiScoreBand: string | null;
  aiScoreReason: string | null;
  aiEmailSubject: string | null;
  aiEmailBody: string | null;
  aiLastScoredAt: string | null;
  aiModelVersion: string | null;
  sourceType: string;
}

export function LeadDetailTabs({ lead }: { lead: Lead }) {
  const [active, setActive] = useState<Tab>('Identity');
  const [legacyOpen, setLegacyOpen] = useState(false);

  return (
    <div>
      <div className="flex gap-0 border-b border-border mb-6 overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActive(tab)}
            className={[
              'px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap',
              active === tab
                ? 'border-brand text-ink'
                : 'border-transparent text-muted hover:text-ink'
            ].join(' ')}
          >
            {tab}
          </button>
        ))}
      </div>

      {active === 'Identity' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <Field label="Company" value={lead.company} />
          <Field label="Contact name" value={lead.contactName} />
          <Field label="Email" value={lead.email} />
          <Field label="Phone" value={lead.phone} />
          <Field label="Website" value={lead.website} />
          <Field label="Industry" value={lead.industry} />
          <div>
            <div className="field-label">Stage</div>
            <StatusBadge value={lead.leadStatus} />
          </div>
          <div>
            <div className="field-label">AI score band</div>
            {lead.aiScoreBand ? (
              <StatusBadge value={lead.aiScoreBand} />
            ) : (
              <span className="text-muted text-sm">pending</span>
            )}
          </div>
          <div className="col-span-full border-t border-border pt-4">
            <button
              onClick={() => setLegacyOpen((o) => !o)}
              className="text-xs text-muted hover:text-ink flex items-center gap-1.5 transition-colors"
            >
              <span>{legacyOpen ? '▾' : '▸'}</span>
              Legacy operator fields
            </button>
            {legacyOpen && (
              <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4 border border-border rounded-lg p-4">
                <Field label="Approved" value={lead.isApproved ? 'Yes' : 'No'} />
                <Field label="Approval date" value={lead.approvalDate ? new Date(lead.approvalDate).toLocaleString() : null} />
                <Field label="Approved by" value={lead.approvedBy} />
                <Field label="Follow-up date" value={lead.followUpDate ? new Date(lead.followUpDate).toLocaleString() : null} />
                <Field label="Source type" value={lead.sourceType} />
                <Field label="Internal id" value={String(lead.id)} />
                <div className="col-span-full">
                  <Field label="Legacy notes" value={lead.notes} />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {active === 'Audit' && (
        <div>
          {lead.auditContent ? (
            <>
              <pre className="whitespace-pre-wrap text-sm leading-relaxed font-mono bg-surface border border-border rounded-lg p-5 max-h-[65vh] overflow-y-auto">
                {lead.auditContent}
              </pre>
              {lead.auditGenerated && (
                <p className="text-xs text-muted mt-2">
                  Generated {new Date(lead.auditGenerated).toLocaleString()}
                </p>
              )}
            </>
          ) : (
            <Empty message="No audit content yet. The AI audit generates after the lead is scored in Phase 2." />
          )}
        </div>
      )}

      {active === 'Challenge' && (
        <div>
          {lead.challenge ? (
            <div className="bg-surface border border-border rounded-lg p-5 text-sm leading-relaxed">
              {lead.challenge}
            </div>
          ) : (
            <Empty message="No challenge statement recorded for this lead." />
          )}
        </div>
      )}

      {active === 'AI Scoring' && (
        <div>
          {lead.aiScore !== null ? (
            <div className="space-y-5">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <ScoreCard label="Score" value={String(lead.aiScore)} />
                <ScoreCard label="Band" value={lead.aiScoreBand ?? '—'} />
                <ScoreCard label="Model" value={lead.aiModelVersion ?? '—'} />
              </div>
              {lead.aiScoreReason && (
                <Section label="Score reason">
                  <p className="text-sm">{lead.aiScoreReason}</p>
                </Section>
              )}
              {lead.aiEmailSubject && (
                <Section label="Draft subject line">
                  <p className="text-sm font-medium">{lead.aiEmailSubject}</p>
                </Section>
              )}
              {lead.aiEmailBody && (
                <Section label="Draft email body">
                  <pre className="whitespace-pre-wrap text-sm bg-surface border border-border rounded-lg p-4 max-h-72 overflow-y-auto">
                    {lead.aiEmailBody}
                  </pre>
                </Section>
              )}
              {lead.aiLastScoredAt && (
                <p className="text-xs text-muted">
                  Scored {new Date(lead.aiLastScoredAt).toLocaleString()}
                </p>
              )}
            </div>
          ) : (
            <Empty message="AI scoring has not run yet. Phase 2 will wire the scoring pipeline against shhdbite_AV." />
          )}
        </div>
      )}

      {active === 'Notes' && (
        <Empty message="Notes — coming in Phase 2." />
      )}

      {active === 'Events' && (
        <Empty message="Event log — coming in Phase 2." />
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <div className="field-label">{label}</div>
      <div className="text-sm mt-0.5">{value ?? <span className="text-muted">—</span>}</div>
    </div>
  );
}

function ScoreCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface border border-border rounded-lg p-4">
      <div className="field-label">{label}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="field-label mb-2">{label}</div>
      {children}
    </div>
  );
}

function Empty({ message }: { message: string }) {
  return (
    <div className="px-6 py-12 text-center text-sm text-muted bg-surface border border-border rounded-lg">
      {message}
    </div>
  );
}
