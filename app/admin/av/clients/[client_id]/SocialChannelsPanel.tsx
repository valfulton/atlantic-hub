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

// (#510, val 2026-06-08) Status labels rewritten in OPERATOR voice — the
// previous "Confirmed by client" was a lie since operator marks set this state.
// Real client-confirmation requires a separate intake action (future bundle).
const STATUS_LABEL: Record<Status, string> = {
  suggested: 'Found · needs verifying',
  confirmed: 'Operator-vetted · awaiting client',
  connected: 'Connected · ready to post',
  rejected: 'Marked "doesn\'t match"',
  error: 'Needs attention'
};

// (#510) Source labels so val can tell at a glance how each row got here.
const SOURCE_LABEL: Record<SocialTarget['source'], string> = {
  val_intake: 'Added by operator',
  client_intake: 'Confirmed by client',
  scraper: 'Found by scraper',
  manual_add: 'Added by hand'
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
            URLs the scraper found, you added, or the client confirmed. Operator-vetting saves
            your sanity check; final &ldquo;is this me&rdquo; comes from the client in their intake.
          </div>
        </div>
        <div className="text-[10px] uppercase tracking-[0.14em] text-muted">
          {targets ? `${targets.length} on file` : '—'}
        </div>
      </div>

      <div className="grid gap-2 mb-3">
        <div className="text-[10px] uppercase tracking-[0.12em] text-muted -mb-1">
          Add a URL by hand
        </div>
        <textarea
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          placeholder={'Paste any social URLs you have (one per line, commas OK) — LinkedIn / Facebook / Instagram / X / TikTok / YouTube. Personal and company pages both supported.'}
          rows={4}
          className="w-full rounded-lg border border-border bg-black/30 px-3 py-2 text-xs text-ink placeholder-muted/50 italic focus:outline-none focus:border-brand focus:placeholder-muted/30 focus:not-italic font-sans"
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
            {busy ? 'Saving…' : 'Add to brand'}
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
          Nothing saved yet for this brand. Paste URLs above, or click &ldquo;Pull from website&rdquo; to let the scraper find them.
        </div>
      )}

      {targets && targets.length > 0 && (() => {
        const operatorVetted = targets.filter((t) => t.status === 'confirmed' || t.status === 'connected').length;
        const awaiting = targets.filter((t) => t.status === 'suggested').length;
        const clientConfirmed = targets.filter((t) => t.source === 'client_intake').length;
        if (operatorVetted + awaiting + clientConfirmed === 0) return null;
        return (
          <div className="rounded-md border border-border bg-black/15 px-3 py-2 mb-3 text-[11px] text-muted flex items-center justify-between gap-3 flex-wrap">
            <span>
              <span className="text-ink">{operatorVetted}</span> operator-vetted
              {awaiting > 0 && <> · <span className="text-amber-300/85">{awaiting}</span> awaiting your verify</>}
              {clientConfirmed > 0 && <> · <span className="text-emerald-300">{clientConfirmed}</span> client-confirmed</>}
            </span>
            <span className="text-muted/80 italic">
              Client confirms in their intake — share the prefilled intake link above.
            </span>
          </div>
        );
      })()}

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
                        <span className="text-muted/80"> · {SOURCE_LABEL[t.source]}</span>
                        {t.lastError ? ` — ${t.lastError}` : ''}
                      </div>
                    </div>

                    {/* Actions — operator voice (#510). 'Confirm' was misleading
                        because operator can't confirm "this is me" on behalf of
                        the client; only the client can. So operator marks
                        operator-vetted (URL is real + correct), then the client
                        does the final claim in their intake. */}
                    <div className="shrink-0 flex flex-col gap-1">
                      {t.status !== 'confirmed' && t.status !== 'connected' && (
                        <button
                          type="button"
                          onClick={() => act(t.id, 'confirm')}
                          className="text-[11px] rounded border border-border bg-black/30 hover:bg-white/5 px-2 py-1 text-ink"
                          title="Operator-vetted: this URL goes with this brand. Client still confirms 'is this me' in their intake."
                        >
                          Looks right
                        </button>
                      )}
                      {t.status !== 'rejected' && (
                        <button
                          type="button"
                          onClick={() => act(t.id, 'reject')}
                          className="text-[11px] rounded border border-border bg-black/30 hover:bg-white/5 px-2 py-1 text-muted"
                          title="This URL doesn't belong to this brand."
                        >
                          Doesn&apos;t match
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
