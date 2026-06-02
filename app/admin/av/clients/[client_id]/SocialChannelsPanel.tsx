'use client';

/**
 * SocialChannelsPanel  (#45, val 2026-06-02)
 *
 * Operator-side paste box + preview cards for a brand's social_targets.
 * Lives on /admin/av/clients/[id]. Val pastes URLs (one per line, commas OK).
 * Server parses, fetches og:image, lands them as 'suggested' rows. Val sees
 * preview cards. She can confirm (this is the right account), reject (wrong),
 * or delete (typo / mistake).
 *
 * Client-side state is the source of truth between server refreshes. After
 * any mutation we re-GET to stay in sync with what the server actually saved
 * (handles og:image fetches finishing after the row insert, dedupe note, etc).
 *
 * Per the brief: this is Phase A. OAuth connect lives in Phase C (intake-side
 * popup flow). For now the operator panel shows the target's current status;
 * 'connected' is a future state that lights up automatically once the OAuth
 * callback wires it.
 */
import { useEffect, useState, useTransition } from 'react';
import { apiCall, ApiError } from '@/lib/http';

type Provider = 'linkedin' | 'x' | 'instagram' | 'facebook' | 'tiktok' | 'youtube' | 'threads';
type TargetType = 'personal' | 'organization' | 'page';
type Status = 'suggested' | 'confirmed' | 'connected' | 'rejected' | 'error';

interface SocialTarget {
  id: number;
  clientId: number | null;
  provider: Provider;
  targetType: TargetType;
  sourceUrl: string;
  displayName: string | null;
  avatarUrl: string | null;
  ogTitle: string | null;
  status: Status;
  source: 'val_intake' | 'client_intake' | 'scraper' | 'manual_add';
  addedAt: string;
  lastError: string | null;
}

interface SuggestResult {
  url: string;
  ok: boolean;
  note: 'duplicate' | 'unrecognized' | 'parse_failed' | 'db_error' | null;
  target: SocialTarget | null;
}

const PROVIDER_LABEL: Record<Provider, string> = {
  linkedin: 'LinkedIn',
  x: 'X',
  instagram: 'Instagram',
  facebook: 'Facebook',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  threads: 'Threads'
};

const STATUS_TONE: Record<Status, string> = {
  suggested: 'text-muted',
  confirmed: 'text-ink',
  connected: 'text-emerald-300',
  rejected: 'text-muted line-through',
  error: 'text-danger'
};

const STATUS_LABEL: Record<Status, string> = {
  suggested: 'Awaiting confirmation',
  confirmed: 'Confirmed by client',
  connected: 'Connected · ready to post',
  rejected: 'Marked "not me"',
  error: 'Needs attention'
};

export default function SocialChannelsPanel({
  clientId,
  defaultWebsiteUrl
}: {
  clientId: number;
  defaultWebsiteUrl?: string | null;
}) {
  const [targets, setTargets] = useState<SocialTarget[] | null>(null);
  const [paste, setPaste] = useState('');
  const [busy, setBusy] = useState(false);
  const [scraping, setScraping] = useState(false);
  const [websiteUrl, setWebsiteUrl] = useState(defaultWebsiteUrl ?? '');
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [, startTransition] = useTransition();

  async function refresh() {
    try {
      const data = await apiCall<{ ok: boolean; targets: SocialTarget[] }>(
        `/api/admin/av/clients/${clientId}/social`
      );
      setTargets(data.targets);
    } catch (e) {
      const msg = e instanceof ApiError ? `Couldn't load (HTTP ${e.status})` : 'Could not load social channels.';
      setFeedback({ kind: 'err', text: msg });
      setTargets([]);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  async function suggest() {
    const text = paste.trim();
    if (!text) return;
    setBusy(true);
    setFeedback(null);
    try {
      const data = await apiCall<{ ok: boolean; results: SuggestResult[] }>(
        `/api/admin/av/clients/${clientId}/social/suggest`,
        { paste: text }
      );
      const saved = data.results.filter((r) => r.ok && r.note !== 'duplicate').length;
      const dups = data.results.filter((r) => r.note === 'duplicate').length;
      const unrec = data.results.filter((r) => r.note === 'unrecognized' || r.note === 'parse_failed').length;
      const bits: string[] = [];
      if (saved) bits.push(`${saved} added`);
      if (dups) bits.push(`${dups} already saved`);
      if (unrec) bits.push(`${unrec} unrecognized`);
      setFeedback({ kind: 'ok', text: bits.join(' · ') || 'Saved.' });
      setPaste('');
      await refresh();
    } catch (e) {
      const msg = e instanceof ApiError ? `Couldn't save (HTTP ${e.status})` : 'Could not save.';
      setFeedback({ kind: 'err', text: msg });
    } finally {
      setBusy(false);
    }
  }

  async function scrapeWebsite() {
    const url = websiteUrl.trim();
    if (!url) return;
    setScraping(true);
    setFeedback(null);
    try {
      const data = await apiCall<{ ok: boolean; found: number; saved: number; skipped: number }>(
        `/api/admin/av/clients/${clientId}/social/scrape-website`,
        { websiteUrl: url }
      );
      const bits: string[] = [];
      bits.push(`Found ${data.found}`);
      if (data.saved) bits.push(`${data.saved} added`);
      if (data.skipped) bits.push(`${data.skipped} already on file`);
      setFeedback({ kind: 'ok', text: bits.join(' · ') });
      await refresh();
    } catch (e) {
      const msg = e instanceof ApiError ? `Scrape failed (HTTP ${e.status})` : 'Scrape failed.';
      setFeedback({ kind: 'err', text: msg });
    } finally {
      setScraping(false);
    }
  }

  async function act(targetId: number, action: 'confirm' | 'reject' | 'delete') {
    setFeedback(null);
    // Optimistic UI: hide rejected/deleted rows immediately; mark confirmed inline.
    startTransition(() => {
      setTargets((cur) => {
        if (!cur) return cur;
        if (action === 'delete') return cur.filter((t) => t.id !== targetId);
        return cur.map((t) =>
          t.id === targetId ? { ...t, status: action === 'confirm' ? 'confirmed' : 'rejected' } : t
        );
      });
    });
    try {
      if (action === 'delete') {
        await apiCall(
          `/api/admin/av/clients/${clientId}/social/${targetId}`,
          undefined,
          { method: 'DELETE' }
        );
      } else {
        await apiCall(
          `/api/admin/av/clients/${clientId}/social/${targetId}`,
          { action }
        );
      }
      await refresh();
    } catch (e) {
      const msg = e instanceof ApiError ? `Couldn't update (HTTP ${e.status})` : 'Could not update.';
      setFeedback({ kind: 'err', text: msg });
      await refresh(); // re-sync from server on error
    }
  }

  const groupedByProvider = (targets ?? []).reduce<Record<string, SocialTarget[]>>((acc, t) => {
    const key = t.provider;
    (acc[key] ||= []).push(t);
    return acc;
  }, {});

  return (
    <div className="rounded-2xl border border-border bg-surface p-4 mb-6">
      <div className="flex items-center justify-between gap-3 mb-2">
        <div>
          <div className="text-[11px] uppercase tracking-[0.12em] text-muted">Social channels</div>
          <div className="text-sm text-ink mt-0.5">
            Drop the URLs you have for this brand. The client confirms in their intake.
          </div>
        </div>
        <div className="text-[10px] uppercase tracking-[0.14em] text-muted">
          {targets ? `${targets.length} on file` : '—'}
        </div>
      </div>

      <div className="grid gap-2 mb-3">
        <textarea
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          placeholder={
            'Paste profile URLs, one per line:\n' +
            'https://www.linkedin.com/in/adriana-candelaria-9108a839b/\n' +
            'https://www.linkedin.com/company/central-business-bureau/\n' +
            'https://www.facebook.com/profile.php?id=100057834751532'
          }
          rows={4}
          className="w-full rounded-lg border border-border bg-black/30 px-3 py-2 text-xs text-ink placeholder-muted/60 focus:outline-none focus:border-brand font-mono"
          disabled={busy}
        />
        <div className="flex items-center justify-between gap-3">
          <div className="text-[11px] text-muted">
            Supports LinkedIn (personal + company), Facebook, Instagram, X, TikTok, YouTube, Threads.
          </div>
          <button
            type="button"
            onClick={suggest}
            disabled={busy || !paste.trim()}
            className="shrink-0 rounded-lg border border-border bg-brand text-black font-medium text-sm px-4 py-2 disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Save URLs'}
          </button>
        </div>

        {/* Auto-pull from the brand's website (uses the same scraper as
            discovery; findSocials() finds IG/FB/LinkedIn/X automatically). */}
        <div className="flex items-center gap-2 pt-2 border-t border-border/50">
          <input
            type="url"
            value={websiteUrl}
            onChange={(e) => setWebsiteUrl(e.target.value)}
            placeholder="https://their-website.com"
            className="flex-1 rounded-lg border border-border bg-black/30 px-3 py-1.5 text-xs text-ink placeholder-muted/60 focus:outline-none focus:border-brand"
            disabled={scraping}
          />
          <button
            type="button"
            onClick={scrapeWebsite}
            disabled={scraping || !websiteUrl.trim()}
            className="shrink-0 rounded-lg border border-border bg-black/30 hover:bg-white/5 text-ink text-xs px-3 py-1.5 disabled:opacity-50"
            title="Fetch the page and pull any social links it lists"
          >
            {scraping ? 'Scraping…' : 'Pull from website'}
          </button>
        </div>

        {feedback && (
          <div className={`text-xs ${feedback.kind === 'ok' ? 'text-emerald-300' : 'text-danger'}`}>
            {feedback.text}
          </div>
        )}
      </div>

      {targets === null && <div className="text-xs text-muted">Loading…</div>}

      {targets && targets.length === 0 && (
        <div className="text-xs text-muted italic border-t border-border pt-3">
          No social channels saved yet. Paste URLs above to get started.
        </div>
      )}

      {targets && targets.length > 0 && (
        <div className="grid gap-4 border-t border-border pt-3">
          {Object.entries(groupedByProvider).map(([provider, list]) => (
            <div key={provider}>
              <div className="text-[10px] uppercase tracking-[0.14em] text-muted mb-2">
                {PROVIDER_LABEL[provider as Provider] ?? provider}
              </div>
              <ul className="grid gap-2">
                {list.map((t) => (
                  <li
                    key={t.id}
                    className="flex items-start gap-3 rounded-lg border border-border bg-black/20 p-3"
                  >
                    {/* Avatar */}
                    <div className="shrink-0 w-12 h-12 rounded-full overflow-hidden bg-black/40 border border-border flex items-center justify-center">
                      {t.avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={t.avatarUrl} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-[10px] text-muted uppercase tracking-wider">
                          {t.provider.slice(0, 2)}
                        </span>
                      )}
                    </div>

                    {/* Body */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm text-ink truncate" title={t.ogTitle ?? t.displayName ?? t.sourceUrl}>
                          {t.ogTitle || t.displayName || t.sourceUrl}
                        </span>
                        <span className="text-[10px] uppercase tracking-[0.12em] text-muted">
                          {t.targetType}
                        </span>
                      </div>
                      <a
                        href={t.sourceUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="block text-[11px] text-muted hover:text-ink truncate"
                      >
                        {t.sourceUrl}
                      </a>
                      <div className={`text-[11px] mt-1 ${STATUS_TONE[t.status]}`}>
                        {STATUS_LABEL[t.status]}
                        {t.lastError ? ` — ${t.lastError}` : ''}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="shrink-0 flex flex-col gap-1">
                      {t.status !== 'confirmed' && t.status !== 'connected' && (
                        <button
                          type="button"
                          onClick={() => act(t.id, 'confirm')}
                          className="text-[11px] rounded border border-border bg-black/30 hover:bg-white/5 px-2 py-1 text-ink"
                          title="Mark confirmed (operator override; client will still see it in their intake)"
                        >
                          Confirm
                        </button>
                      )}
                      {t.status !== 'rejected' && (
                        <button
                          type="button"
                          onClick={() => act(t.id, 'reject')}
                          className="text-[11px] rounded border border-border bg-black/30 hover:bg-white/5 px-2 py-1 text-muted"
                        >
                          Not me
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => act(t.id, 'delete')}
                        className="text-[11px] rounded border border-border bg-black/30 hover:bg-white/5 px-2 py-1 text-muted"
                        title="Remove from this brand entirely"
                      >
                        Remove
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
