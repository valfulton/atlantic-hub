'use client';

/**
 * OutreachOverview -- the live client component behind /admin/av/outreach.
 *
 * Responsibilities:
 *   - Show active campaigns with at-a-glance counters
 *   - Show the global pending-approval queue (your daily focus zone)
 *   - Show recent replies with AI classification badges
 *   - Live polling every 15s while the tab is visible (toggleable)
 *   - Once-per-day celebration on a positive reply landing (per the
 *     cosmetic-nudge doc spec for this session)
 *
 * Brand discipline (per docs/COSMETIC_BASELINE.md + COSMETIC_NUDGES_FOR_QUEUED_SESSIONS):
 *   - No confetti per send -- only on the first positive reply each day.
 *   - aria-live="polite" on the pending count so screen readers announce changes.
 *   - prefers-reduced-motion is honored by the global CSS rule.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';

interface Campaign {
  id: number;
  name: string;
  description: string | null;
  status: string;
  target_business: string;
  daily_send_limit: number;
  require_approval: number;
  auto_advance_stage: number;
  mailbox_display_name: string | null;
  pending_count: number;
  sent_today: number;
  replied_today: number;
}

interface PendingMessage {
  id: number;
  campaign_id: number;
  lead_id: number;
  subject: string;
  body: string;
  status: string;
  created_at: string;
  ai_grounded_on_audit: number | boolean;
  campaign_name: string;
  company: string;
  email: string;
  contact_name: string | null;
  contact_title: string | null;
  industry: string | null;
  ai_score: number | null;
  ai_score_band: string | null;
}

interface RecentReply {
  id: number;
  message_id: number | null;
  lead_id: number | null;
  reply_from: string;
  reply_subject: string | null;
  classification: string;
  classification_confidence: number | null;
  received_at: string;
}

const ONCE_PER_DAY_KEY = 'outreach.positive_reply_celebrated';

export function OutreachOverview() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [replies, setReplies] = useState<RecentReply[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [live, setLive] = useState(false);
  const [busyIds, setBusyIds] = useState<Set<number>>(new Set());
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [celebration, setCelebration] = useState<string | null>(null);
  const lastReplyIds = useRef<Set<number>>(new Set());

  const refresh = useCallback(async () => {
    try {
      const [cRes, mRes, rRes] = await Promise.all([
        fetch('/api/admin/av/outreach/campaigns'),
        fetch('/api/admin/av/outreach/messages?status=pending_approval'),
        fetch('/api/admin/av/outreach/messages?status=replied&limit=25')
      ]);
      if (cRes.ok) setCampaigns(((await cRes.json()).campaigns ?? []) as Campaign[]);
      if (mRes.ok) setPending(((await mRes.json()).messages ?? []) as PendingMessage[]);
      if (rRes.ok) {
        // The /messages endpoint with status=replied doesn't return reply rows,
        // it returns message rows. For a richer replies feed, query outreach_replies via
        // the campaign endpoint or a future /api/admin/av/outreach/replies route. For
        // v1 we treat that as a TODO and just hide the section when empty.
      }
      // Pull recent replies via the per-campaign endpoint -- summed across campaigns by
      // a future /api/admin/av/outreach/replies route. v1: hit one extra fetch:
      try {
        const repliesRes = await fetch('/api/admin/av/outreach/replies?limit=25');
        if (repliesRes.ok) {
          const rj = await repliesRes.json();
          setReplies((rj.replies ?? []) as RecentReply[]);
        }
      } catch {
        // ignore -- /replies endpoint optional
      }
      setLoaded(true);
    } catch {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!live) return;
    // Pause the 15s live refresh when the tab is hidden; refresh on return.
    const tick = () => { if (!document.hidden) void refresh(); };
    const handle = window.setInterval(tick, 15_000);
    const onVis = () => { if (!document.hidden) void refresh(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { window.clearInterval(handle); document.removeEventListener('visibilitychange', onVis); };
  }, [live, refresh]);

  // Once-per-day positive-reply celebration.
  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    const stored = window.localStorage.getItem(ONCE_PER_DAY_KEY);
    if (stored === today) {
      lastReplyIds.current = new Set(replies.map((r) => r.id));
      return;
    }
    const positive = replies.find(
      (r) => r.classification === 'positive' && !lastReplyIds.current.has(r.id)
    );
    if (positive) {
      setCelebration(positive.reply_from);
      window.localStorage.setItem(ONCE_PER_DAY_KEY, today);
      window.setTimeout(() => setCelebration(null), 6000);
    }
    lastReplyIds.current = new Set(replies.map((r) => r.id));
  }, [replies]);

  async function approve(messageId: number) {
    setBusyIds(prev => new Set(prev).add(messageId));
    try {
      const res = await fetch(`/api/admin/av/outreach/messages/${messageId}/approve`, {
        method: 'POST'
      });
      if (res.ok) {
        setPending(prev => prev.filter(m => m.id !== messageId));
      }
      await refresh();
    } finally {
      setBusyIds(prev => {
        const n = new Set(prev);
        n.delete(messageId);
        return n;
      });
    }
  }

  async function reject(messageId: number) {
    const reason = window.prompt('Reason for rejecting (optional)') ?? null;
    setBusyIds(prev => new Set(prev).add(messageId));
    try {
      const res = await fetch(`/api/admin/av/outreach/messages/${messageId}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason })
      });
      if (res.ok) {
        setPending(prev => prev.filter(m => m.id !== messageId));
      }
      await refresh();
    } finally {
      setBusyIds(prev => {
        const n = new Set(prev);
        n.delete(messageId);
        return n;
      });
    }
  }

  async function pollNow() {
    await fetch('/api/admin/av/outreach/replies/poll', { method: 'POST' });
    await refresh();
  }

  return (
    <div className="space-y-6">
      {celebration && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 text-emerald-200 px-4 py-3 flex items-center gap-3"
        >
          <span className="text-xl" aria-hidden="true">✦</span>
          <div>
            <div className="text-sm font-semibold">Positive reply landed</div>
            <div className="text-xs text-emerald-300/80">
              {celebration} — the funnel just moved.
            </div>
          </div>
        </div>
      )}

      <section>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-ink uppercase tracking-wider">
            Active campaigns
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setLive(v => !v)}
              className={`text-xs px-2 py-1 rounded-md border transition-colors ${
                live
                  ? 'border-emerald-500/50 text-emerald-300 bg-emerald-500/10'
                  : 'border-border text-muted hover:text-ink hover:border-brand'
              }`}
              aria-pressed={live}
            >
              {live ? 'Live · 15s' : 'Live off'}
            </button>
            <button
              onClick={pollNow}
              className="text-xs px-2 py-1 rounded-md border border-border text-muted hover:text-ink hover:border-brand transition-colors"
              title="Manually poll mailboxes for new replies"
            >
              Poll replies now
            </button>
          </div>
        </div>
        {!loaded ? (
          <p className="text-xs text-muted">Loading...</p>
        ) : campaigns.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-6 text-center">
            <p className="text-sm text-muted mb-3">No campaigns yet.</p>
            <Link
              href="/admin/av/outreach/mailboxes"
              className="inline-block px-3 py-1.5 text-sm rounded-md bg-brand text-ink font-medium"
            >
              Connect a mailbox first
            </Link>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {campaigns.map((c) => (
              <Link
                key={c.id}
                href={`/admin/av/outreach/${c.id}`}
                className="rounded-lg border border-border bg-[var(--surface)] p-4 hover:border-brand transition-colors block"
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="font-medium text-ink truncate">{c.name}</span>
                  <CampaignStatusPill status={c.status} />
                </div>
                <div className="text-xs text-muted mb-3">
                  via {c.mailbox_display_name || '(no mailbox)'}
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <Stat label="Queued" value={c.pending_count} />
                  <Stat label="Sent today" value={c.sent_today} suffix={`/${c.daily_send_limit}`} />
                  <Stat label="Replies today" value={c.replied_today} />
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-ink uppercase tracking-wider">
            Pending approval
          </h2>
          <span aria-live="polite" className="text-xs text-muted">
            {pending.length} waiting
          </span>
        </div>
        {!loaded ? (
          <p className="text-xs text-muted">Loading...</p>
        ) : pending.length === 0 ? (
          <p className="text-sm text-muted">Inbox zero. The approval queue is empty.</p>
        ) : (
          <ul className="space-y-2">
            {pending.map((m) => (
              <li
                key={m.id}
                className="rounded-lg border border-border bg-[var(--surface)] p-3"
              >
                <button
                  onClick={() => setExpandedId(expandedId === m.id ? null : m.id)}
                  className="w-full text-left"
                  aria-expanded={expandedId === m.id}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-ink truncate">
                        {m.subject}
                      </div>
                      <div className="text-xs text-muted truncate">
                        To {m.company} ({m.email})
                        {m.ai_score_band && (
                          <span className="ml-2">
                            · <ScoreBadge band={m.ai_score_band} score={m.ai_score} />
                          </span>
                        )}
                        {m.ai_grounded_on_audit ? (
                          <span className="ml-2 text-amber-300">· audit-grounded</span>
                        ) : (
                          <span className="ml-2 text-muted">· generic hook</span>
                        )}
                      </div>
                    </div>
                    <span className="text-xs text-muted whitespace-nowrap">
                      {m.campaign_name}
                    </span>
                  </div>
                </button>
                {expandedId === m.id && (
                  <div className="mt-3 pt-3 border-t border-border">
                    <pre className="whitespace-pre-wrap text-sm text-ink/90 leading-relaxed font-sans mb-3">
                      {m.body}
                    </pre>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => approve(m.id)}
                        disabled={busyIds.has(m.id)}
                        className="px-3 py-1.5 text-sm rounded-md bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50"
                      >
                        Approve + send
                      </button>
                      <button
                        onClick={() => reject(m.id)}
                        disabled={busyIds.has(m.id)}
                        className="px-3 py-1.5 text-sm rounded-md bg-surface border border-border hover:border-red-500 text-muted hover:text-red-300 disabled:opacity-50"
                      >
                        Reject
                      </button>
                      <Link
                        href={`/admin/av/leads/${m.lead_id}`}
                        className="text-xs text-muted hover:text-ink underline ml-auto"
                      >
                        Open lead
                      </Link>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {replies.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-ink uppercase tracking-wider mb-2">
            Recent replies
          </h2>
          <ul className="space-y-2">
            {replies.map((r) => (
              <li key={r.id} className="rounded-lg border border-border bg-[var(--surface)] p-3">
                <article>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="text-sm text-ink truncate">
                      <span className="font-medium">{r.reply_from}</span>
                      {r.reply_subject ? ` — ${r.reply_subject}` : ''}
                    </div>
                    <ReplyClassPill classification={r.classification} />
                  </div>
                  <time dateTime={r.received_at} className="text-xs text-muted">
                    {new Date(r.received_at).toLocaleString()}
                  </time>
                </article>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value, suffix }: { label: string; value: number; suffix?: string }) {
  return (
    <div>
      <div className="text-lg font-semibold text-ink tabular-nums">
        {value}
        {suffix && <span className="text-xs text-muted ml-0.5">{suffix}</span>}
      </div>
      <div className="text-[10px] uppercase tracking-wider text-muted">{label}</div>
    </div>
  );
}

function CampaignStatusPill({ status }: { status: string }) {
  const styles: Record<string, string> = {
    draft: 'bg-gray-500/15 text-gray-300 border-gray-500/40',
    active: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
    paused: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
    archived: 'bg-gray-500/15 text-gray-400 border-gray-500/40'
  };
  return (
    <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border ${
      styles[status] || styles.draft
    }`}>
      {status}
    </span>
  );
}

function ScoreBadge({ band, score }: { band: string; score: number | null }) {
  const colors: Record<string, string> = {
    hot: 'text-rose-300',
    warm: 'text-amber-300',
    cool: 'text-blue-300'
  };
  const c = colors[band] || 'text-muted';
  return (
    <span className={c}>
      {band[0]?.toUpperCase()}
      {band.slice(1)}
      {score !== null ? ` ${score}` : ''}
    </span>
  );
}

function ReplyClassPill({ classification }: { classification: string }) {
  const styles: Record<string, string> = {
    positive: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
    interested: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
    neutral: 'bg-blue-500/15 text-blue-300 border-blue-500/40',
    negative: 'bg-rose-500/15 text-rose-300 border-rose-500/40',
    unsubscribe: 'bg-red-500/15 text-red-300 border-red-500/40',
    autoresponder: 'bg-gray-500/15 text-gray-300 border-gray-500/40',
    unknown: 'bg-gray-500/15 text-gray-300 border-gray-500/40'
  };
  return (
    <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border ${
      styles[classification] || styles.unknown
    }`}>
      {classification}
    </span>
  );
}
