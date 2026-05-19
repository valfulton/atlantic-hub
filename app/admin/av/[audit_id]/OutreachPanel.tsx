'use client';

/**
 * Per-lead Outreach panel. Lives on the lead detail page under the
 * "Outreach" tab. Three jobs:
 *   1. Pick a campaign + generate an AI draft for this lead
 *   2. Preview the draft inline before approval
 *   3. Show the full per-lead outreach history (drafts, sends, replies)
 *
 * Uses the sparkle pattern on the Generate button (mirrors RescoreButton
 * and the Commercial Generate button) so all AI actions look the same.
 *
 * Respects prefers-reduced-motion -- the keyframe animations are disabled
 * via the global CSS rule in app/globals.css.
 */

import { useCallback, useEffect, useState } from 'react';

interface Campaign {
  id: number;
  name: string;
  status: string;
  pending_count: number;
  sent_today: number;
}

interface LeadMessage {
  id: number;
  campaign_id: number;
  subject: string;
  body: string;
  status: string;
  created_at: string;
  sent_at: string | null;
  replied_at: string | null;
  ai_grounded_on_audit: number | boolean;
}

interface LeadReply {
  id: number;
  message_id: number | null;
  reply_from: string;
  reply_subject: string | null;
  classification: string;
  classification_confidence: number | null;
  received_at: string;
}

interface DraftPreview {
  subject: string;
  body: string;
  groundedExcerpt: string | null;
  groundedOnAudit: boolean;
}

export function OutreachPanel({
  auditId,
  leadCompany
}: {
  auditId: string;
  leadCompany: string;
}) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignId, setCampaignId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<DraftPreview | null>(null);
  const [lastMessageId, setLastMessageId] = useState<number | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [history, setHistory] = useState<LeadMessage[]>([]);
  const [replies, setReplies] = useState<LeadReply[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [campRes, histRes] = await Promise.all([
        fetch('/api/admin/av/outreach/campaigns'),
        fetch(`/api/admin/av/leads/${auditId}/outreach`)
      ]);
      if (campRes.ok) {
        const data = await campRes.json();
        const active = (data.campaigns as Campaign[]).filter(
          (c) => c.status === 'active' || c.status === 'draft'
        );
        setCampaigns(active);
        if (active.length > 0 && campaignId === null) setCampaignId(active[0].id);
      }
      if (histRes.ok) {
        const data = await histRes.json();
        setHistory(data.messages || []);
        setReplies(data.replies || []);
      }
      setHistoryLoaded(true);
    } catch {
      setHistoryLoaded(true);
    }
  }, [auditId, campaignId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function generateDraft() {
    if (!campaignId || busy) return;
    setBusy(true);
    setStatusMsg(null);
    setDraft(null);
    try {
      const res = await fetch(`/api/admin/av/outreach/draft/${auditId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaign_id: campaignId })
      });
      const data = await res.json();
      if (!res.ok) {
        setStatusMsg(data.error || `Draft failed (HTTP ${res.status})`);
        return;
      }
      setDraft(data.draft);
      setLastMessageId(data.messageId);
      setStatusMsg(
        data.draft?.groundedOnAudit
          ? 'Draft ready -- grounded in the lead\'s audit content.'
          : 'Draft ready (no audit content available -- grounded in company + industry).'
      );
      await refresh();
    } catch (err) {
      setStatusMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    if (!lastMessageId) return;
    setBusy(true);
    setStatusMsg(null);
    try {
      const res = await fetch(`/api/admin/av/outreach/messages/${lastMessageId}/approve`, {
        method: 'POST'
      });
      const data = await res.json();
      setStatusMsg(data.message || (res.ok ? 'Sent.' : 'Send failed.'));
      if (res.ok) {
        setDraft(null);
        setLastMessageId(null);
      }
      await refresh();
    } catch (err) {
      setStatusMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    if (!lastMessageId) return;
    const reason = window.prompt('Reason for rejecting (optional)') ?? null;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/av/outreach/messages/${lastMessageId}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason })
      });
      const data = await res.json();
      setStatusMsg(data.message || (res.ok ? 'Rejected.' : 'Reject failed.'));
      if (res.ok) {
        setDraft(null);
        setLastMessageId(null);
      }
      await refresh();
    } catch (err) {
      setStatusMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-border bg-[var(--surface)] p-4">
        <h3 className="text-sm font-semibold text-ink mb-3">
          Draft personalized outreach to {leadCompany}
        </h3>
        {campaigns.length === 0 ? (
          <p className="text-sm text-muted">
            No active campaigns. Create one from{' '}
            <a className="underline" href="/admin/av/outreach">/admin/av/outreach</a> first.
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-xs uppercase tracking-wider text-muted">
              Campaign
              <select
                value={campaignId ?? ''}
                onChange={(e) => setCampaignId(parseInt(e.target.value, 10) || null)}
                className="ml-2 px-2 py-1.5 text-sm rounded-md border border-border bg-surface text-ink"
              >
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={generateDraft}
              disabled={busy || !campaignId}
              className="ah-rescore group relative px-3 py-1.5 rounded-md text-sm bg-surface border border-border hover:border-brand text-ink transition-colors inline-flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed overflow-visible"
              aria-label="Generate AI outreach draft for this lead"
            >
              <span className="ah-rescore-icon" aria-hidden="true">
                <svg className={busy ? 'ah-rescore-spinner' : ''} width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <path d="M12 2l1.6 4.4L18 8l-4.4 1.6L12 14l-1.6-4.4L6 8l4.4-1.6L12 2z" fill="currentColor" />
                </svg>
              </span>
              <span>{busy ? 'Drafting' : draft ? 'Regenerate' : 'Generate draft'}</span>
              <span className="ah-sparkle ah-sparkle-1" aria-hidden="true">✦</span>
              <span className="ah-sparkle ah-sparkle-2" aria-hidden="true">✧</span>
            </button>
            {statusMsg && (
              <span className="text-xs text-muted" aria-live="polite">{statusMsg}</span>
            )}
          </div>
        )}
      </section>

      {draft && (
        <section className="rounded-lg border border-amber-500/40 bg-[var(--surface)] p-4">
          <div className="text-xs uppercase tracking-wider text-amber-300 mb-2">
            Pending approval
          </div>
          <div className="text-base font-semibold text-ink mb-2">
            {draft.subject}
          </div>
          <pre className="whitespace-pre-wrap text-sm text-ink/90 leading-relaxed font-sans">
            {draft.body}
          </pre>
          {draft.groundedExcerpt && (
            <div className="mt-3 pt-3 border-t border-border">
              <div className="text-[10px] uppercase tracking-wider text-muted mb-1">
                Hooked on audit excerpt
              </div>
              <p className="text-xs text-muted italic">"{draft.groundedExcerpt}"</p>
            </div>
          )}
          <div className="mt-4 flex gap-2">
            <button
              onClick={approve}
              disabled={busy}
              className="px-3 py-1.5 text-sm rounded-md bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50"
            >
              Approve + send
            </button>
            <button
              onClick={reject}
              disabled={busy}
              className="px-3 py-1.5 text-sm rounded-md bg-surface border border-border hover:border-red-500 text-muted hover:text-red-300 disabled:opacity-50"
            >
              Reject
            </button>
          </div>
        </section>
      )}

      <section>
        <h3 className="text-sm font-semibold text-ink mb-2">Message history</h3>
        {!historyLoaded ? (
          <p className="text-xs text-muted">Loading...</p>
        ) : history.length === 0 ? (
          <p className="text-xs text-muted">No messages sent or drafted yet.</p>
        ) : (
          <ul className="space-y-2">
            {history.map((m) => (
              <li
                key={m.id}
                className="rounded-md border border-border bg-[var(--surface)] p-3"
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-sm font-medium text-ink truncate">{m.subject}</span>
                  <StatusPill status={m.status} />
                </div>
                <div className="text-xs text-muted">
                  {m.sent_at
                    ? `Sent ${new Date(m.sent_at).toLocaleString()}`
                    : `Drafted ${new Date(m.created_at).toLocaleString()}`}
                  {m.replied_at && ` · Replied ${new Date(m.replied_at).toLocaleString()}`}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {replies.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-ink mb-2">Replies</h3>
          <ul className="space-y-2">
            {replies.map((r) => (
              <li
                key={r.id}
                className="rounded-md border border-border bg-[var(--surface)] p-3"
              >
                <article>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-sm text-ink truncate">
                      <span className="font-medium">{r.reply_from}</span>
                      {r.reply_subject ? ` — ${r.reply_subject}` : ''}
                    </span>
                    <ClassificationPill classification={r.classification} />
                  </div>
                  <time
                    dateTime={r.received_at}
                    className="text-xs text-muted"
                  >
                    {new Date(r.received_at).toLocaleString()}
                  </time>
                </article>
              </li>
            ))}
          </ul>
        </section>
      )}

      <style jsx>{`
        .ah-rescore { position: relative; }
        .ah-rescore-icon { display: inline-flex; color: var(--brand); opacity: 0.85; transition: opacity 200ms ease, transform 200ms ease; }
        .ah-rescore:hover .ah-rescore-icon { opacity: 1; transform: scale(1.1); }
        .ah-rescore-spinner { animation: ah-spin 1.1s linear infinite; color: var(--brand); }
        @keyframes ah-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .ah-sparkle { position: absolute; font-size: 9px; color: var(--brand); opacity: 0; pointer-events: none; transition: opacity 200ms ease; text-shadow: 0 0 6px var(--brand-glow, rgba(245,158,11,0.55)); }
        .ah-sparkle-1 { top: -4px; right: -2px; animation: ah-twinkle 1.8s ease-in-out infinite; }
        .ah-sparkle-2 { bottom: -2px; right: 14px; animation: ah-twinkle 1.8s ease-in-out infinite; animation-delay: 0.5s; }
        .ah-rescore:hover .ah-sparkle, .ah-rescore:focus-visible .ah-sparkle { opacity: 1; }
        @keyframes ah-twinkle {
          0%, 100% { transform: scale(0.6) rotate(0deg); opacity: 0.3; }
          50% { transform: scale(1.2) rotate(20deg); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending_approval: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
    approved: 'bg-blue-500/15 text-blue-300 border-blue-500/40',
    sent: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
    replied: 'bg-rose-500/15 text-rose-300 border-rose-500/40',
    bounced: 'bg-red-500/15 text-red-300 border-red-500/40',
    rejected: 'bg-gray-500/15 text-gray-300 border-gray-500/40',
    failed: 'bg-red-500/15 text-red-300 border-red-500/40',
    draft: 'bg-gray-500/15 text-gray-300 border-gray-500/40'
  };
  const cls = styles[status] || 'bg-gray-500/15 text-gray-300 border-gray-500/40';
  return (
    <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border ${cls}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

function ClassificationPill({ classification }: { classification: string }) {
  const styles: Record<string, string> = {
    positive: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
    interested: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
    neutral: 'bg-blue-500/15 text-blue-300 border-blue-500/40',
    negative: 'bg-rose-500/15 text-rose-300 border-rose-500/40',
    unsubscribe: 'bg-red-500/15 text-red-300 border-red-500/40',
    autoresponder: 'bg-gray-500/15 text-gray-300 border-gray-500/40',
    unknown: 'bg-gray-500/15 text-gray-300 border-gray-500/40'
  };
  const cls = styles[classification] || 'bg-gray-500/15 text-gray-300 border-gray-500/40';
  return (
    <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border ${cls}`}>
      {classification}
    </span>
  );
}
