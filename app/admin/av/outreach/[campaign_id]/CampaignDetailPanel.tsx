'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

interface Campaign {
  id: number;
  mailbox_id: number;
  name: string;
  description: string | null;
  target_business: string;
  status: 'draft' | 'active' | 'paused' | 'archived';
  ai_offer_summary: string | null;
  ai_cta: string | null;
  ai_signature: string | null;
  daily_send_limit: number;
  require_approval: number;
  auto_advance_stage: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

interface PendingRow {
  id: number;
  lead_id: number;
  subject: string;
  body: string;
  created_at: string;
  ai_grounded_on_audit: number | boolean;
  company: string;
  email: string;
  contact_name: string | null;
  ai_score: number | null;
  ai_score_band: string | null;
}

interface RecentRow {
  id: number;
  lead_id: number;
  subject: string;
  status: string;
  sent_at: string | null;
  opened_at: string | null;
  replied_at: string | null;
  bounced_at: string | null;
  company: string;
  email: string;
}

interface ReplyRow {
  id: number;
  message_id: number | null;
  lead_id: number | null;
  reply_from: string;
  reply_subject: string | null;
  classification: string;
  classification_confidence: number | null;
  received_at: string;
}

export function CampaignDetailPanel({ campaignId }: { campaignId: number }) {
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [pending, setPending] = useState<PendingRow[]>([]);
  const [recent, setRecent] = useState<RecentRow[]>([]);
  const [replies, setReplies] = useState<ReplyRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/admin/av/outreach/campaigns/${campaignId}`);
    if (res.ok) {
      const data = await res.json();
      setCampaign(data.campaign);
      setPending(data.pending ?? []);
      setRecent(data.recent ?? []);
      setReplies(data.replies ?? []);
    }
    setLoaded(true);
  }, [campaignId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function changeStatus(next: Campaign['status']) {
    setBusy(true);
    try {
      await fetch(`/api/admin/av/outreach/campaigns/${campaignId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next })
      });
      setFlash(`Campaign ${next}.`);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function approve(id: number) {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/av/outreach/messages/${id}/approve`, { method: 'POST' });
      const data = await res.json();
      setFlash(data.message || (res.ok ? 'Sent.' : 'Send failed.'));
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function reject(id: number) {
    const reason = window.prompt('Reason for rejecting (optional)') ?? null;
    setBusy(true);
    try {
      await fetch(`/api/admin/av/outreach/messages/${id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason })
      });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) return <p className="text-xs text-muted">Loading...</p>;
  if (!campaign) return <p className="text-sm text-muted">Campaign not found.</p>;

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-border bg-[var(--surface)] p-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-xl font-semibold text-ink tracking-tight">{campaign.name}</h1>
            {campaign.description && (
              <p className="text-sm text-muted mt-1 max-w-2xl">{campaign.description}</p>
            )}
            <div className="text-xs text-muted mt-2 flex flex-wrap gap-x-4 gap-y-1">
              <span>Status: <strong className="text-ink">{campaign.status}</strong></span>
              <span>Daily cap: <strong className="text-ink">{campaign.daily_send_limit}</strong></span>
              <span>
                Approval required: <strong className="text-ink">{campaign.require_approval ? 'yes' : 'no'}</strong>
              </span>
              <span>
                Auto-advance lead stage: <strong className="text-ink">{campaign.auto_advance_stage ? 'yes' : 'no'}</strong>
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {campaign.status === 'paused' || campaign.status === 'draft' ? (
              <button
                onClick={() => changeStatus('active')}
                disabled={busy}
                className="px-3 py-1.5 text-sm rounded-md bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                Activate
              </button>
            ) : campaign.status === 'active' ? (
              <button
                onClick={() => changeStatus('paused')}
                disabled={busy}
                className="px-3 py-1.5 text-sm rounded-md bg-amber-500 text-ink hover:bg-amber-400 disabled:opacity-50"
              >
                Pause
              </button>
            ) : null}
            <button
              onClick={() => setEditing(v => !v)}
              className="px-3 py-1.5 text-sm rounded-md bg-surface border border-border hover:border-brand text-ink transition-colors"
            >
              {editing ? 'Cancel' : 'Edit'}
            </button>
          </div>
        </div>
        {editing && <CampaignEditForm campaign={campaign} onSaved={async () => { setEditing(false); await refresh(); }} />}
        {flash && (
          <div role="status" aria-live="polite" className="text-xs text-muted mt-3">
            {flash}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold text-ink uppercase tracking-wider mb-2">
          Pending approval — {pending.length}
        </h2>
        {pending.length === 0 ? (
          <p className="text-sm text-muted">All drafts approved. The queue is clear.</p>
        ) : (
          <ul className="space-y-2">
            {pending.map((p) => (
              <li key={p.id} className="rounded-lg border border-border bg-[var(--surface)] p-3">
                <div className="text-sm font-medium text-ink mb-1">{p.subject}</div>
                <div className="text-xs text-muted mb-2">
                  To {p.company} ({p.email})
                  {p.ai_score_band && <span className="ml-2">· {p.ai_score_band} {p.ai_score ?? ''}</span>}
                  {p.ai_grounded_on_audit ? <span className="ml-2 text-amber-300">· audit-grounded</span> : null}
                </div>
                <pre className="whitespace-pre-wrap text-sm text-ink/90 leading-relaxed font-sans mb-3">
                  {p.body}
                </pre>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => approve(p.id)}
                    disabled={busy}
                    className="px-3 py-1.5 text-sm rounded-md bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50"
                  >
                    Approve + send
                  </button>
                  <button
                    onClick={() => reject(p.id)}
                    disabled={busy}
                    className="px-3 py-1.5 text-sm rounded-md bg-surface border border-border hover:border-red-500 text-muted hover:text-red-300 disabled:opacity-50"
                  >
                    Reject
                  </button>
                  <Link href={`/admin/av/leads/${p.lead_id}`} className="text-xs text-muted hover:text-ink underline ml-auto">
                    Open lead
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold text-ink uppercase tracking-wider mb-2">
          Recent activity
        </h2>
        {recent.length === 0 ? (
          <p className="text-sm text-muted">No sends yet.</p>
        ) : (
          <ul className="space-y-1">
            {recent.map((r) => (
              <li key={r.id} className="rounded-md border border-border bg-[var(--surface)] px-3 py-2 text-sm">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="truncate">
                    {r.subject} <span className="text-muted">→ {r.company}</span>
                  </span>
                  <span className="text-xs text-muted whitespace-nowrap">
                    {r.replied_at ? `Replied ${new Date(r.replied_at).toLocaleString()}`
                      : r.sent_at ? `Sent ${new Date(r.sent_at).toLocaleString()}`
                      : r.status}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {replies.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-ink uppercase tracking-wider mb-2">
            Replies in this campaign
          </h2>
          <ul className="space-y-2">
            {replies.map((r) => (
              <li key={r.id} className="rounded-md border border-border bg-[var(--surface)] p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate">
                    <span className="font-medium">{r.reply_from}</span>
                    {r.reply_subject && ` — ${r.reply_subject}`}
                  </span>
                  <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border border-border text-muted">
                    {r.classification}
                  </span>
                </div>
                <time dateTime={r.received_at} className="text-xs text-muted">
                  {new Date(r.received_at).toLocaleString()}
                </time>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function CampaignEditForm({
  campaign,
  onSaved
}: {
  campaign: Campaign;
  onSaved: () => void | Promise<void>;
}) {
  const [name, setName] = useState(campaign.name);
  const [description, setDescription] = useState(campaign.description ?? '');
  const [aiOfferSummary, setAiOfferSummary] = useState(campaign.ai_offer_summary ?? '');
  const [aiCta, setAiCta] = useState(campaign.ai_cta ?? '');
  const [aiSignature, setAiSignature] = useState(campaign.ai_signature ?? '');
  const [dailyLimit, setDailyLimit] = useState(campaign.daily_send_limit);
  const [requireApproval, setRequireApproval] = useState(campaign.require_approval === 1);
  const [autoAdvance, setAutoAdvance] = useState(campaign.auto_advance_stage === 1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/av/outreach/campaigns/${campaign.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          description,
          aiOfferSummary,
          aiCta,
          aiSignature,
          dailySendLimit: dailyLimit,
          requireApproval,
          autoAdvanceStage: autoAdvance
        })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || `HTTP ${res.status}`);
        return;
      }
      await onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-4 grid sm:grid-cols-2 gap-3">
      <label className="block sm:col-span-2">
        <span className="text-[11px] uppercase tracking-wider text-muted">Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)}
          className="mt-1 w-full px-2 py-1.5 text-sm rounded-md border border-border bg-surface text-ink" />
      </label>
      <label className="block sm:col-span-2">
        <span className="text-[11px] uppercase tracking-wider text-muted">Description</span>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2}
          className="mt-1 w-full px-2 py-1.5 text-sm rounded-md border border-border bg-surface text-ink" />
      </label>
      <label className="block sm:col-span-2">
        <span className="text-[11px] uppercase tracking-wider text-muted">
          Offer summary (one paragraph the AI uses to ground every draft)
        </span>
        <textarea value={aiOfferSummary} onChange={(e) => setAiOfferSummary(e.target.value)} rows={3}
          placeholder="We help service-business owners replace their patchwork of marketing tools..."
          className="mt-1 w-full px-2 py-1.5 text-sm rounded-md border border-border bg-surface text-ink" />
      </label>
      <label className="block">
        <span className="text-[11px] uppercase tracking-wider text-muted">CTA</span>
        <input value={aiCta} onChange={(e) => setAiCta(e.target.value)}
          placeholder="Open to a 15-min call this week?"
          className="mt-1 w-full px-2 py-1.5 text-sm rounded-md border border-border bg-surface text-ink" />
      </label>
      <label className="block">
        <span className="text-[11px] uppercase tracking-wider text-muted">
          Signature (plural voice -- no founder name)
        </span>
        <input value={aiSignature} onChange={(e) => setAiSignature(e.target.value)}
          placeholder="— the Atlantic and Vine team"
          className="mt-1 w-full px-2 py-1.5 text-sm rounded-md border border-border bg-surface text-ink" />
      </label>
      <label className="block">
        <span className="text-[11px] uppercase tracking-wider text-muted">Daily send cap</span>
        <input type="number" min={0} max={500} value={dailyLimit}
          onChange={(e) => setDailyLimit(parseInt(e.target.value, 10) || 0)}
          className="mt-1 w-full px-2 py-1.5 text-sm rounded-md border border-border bg-surface text-ink" />
      </label>
      <label className="flex items-center gap-2 text-sm text-ink mt-5">
        <input type="checkbox" checked={requireApproval} onChange={(e) => setRequireApproval(e.target.checked)} />
        Require operator approval before send
      </label>
      <label className="flex items-center gap-2 text-sm text-ink mt-5">
        <input type="checkbox" checked={autoAdvance} onChange={(e) => setAutoAdvance(e.target.checked)} />
        Auto-advance lead_status on send / reply
      </label>
      {error && <div className="text-xs text-red-300 sm:col-span-2">{error}</div>}
      <div className="sm:col-span-2 flex items-center gap-2 mt-1">
        <button type="submit" disabled={busy}
          className="px-3 py-1.5 text-sm rounded-md bg-brand text-ink font-medium disabled:opacity-50">
          {busy ? 'Saving...' : 'Save'}
        </button>
      </div>
    </form>
  );
}
