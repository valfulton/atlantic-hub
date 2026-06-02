'use client';

/**
 * IntakeSocialChannelsBlock  (#45 Phase B, val 2026-06-02)
 *
 * Client-side block mounted INSIDE the public intake form. Mirrors the
 * operator-side SocialChannelsPanel but scoped to the client's perspective:
 *
 *   - Shows the social_targets val has pre-loaded for THIS brand.
 *   - Each target rendered as a preview card (avatar, name, URL, provider).
 *   - "Yes, this is me" -> POST confirm; "Not me" -> POST reject.
 *   - Client can ADD a target val missed (paste URL, server parses + previews).
 *   - For LinkedIn 'confirmed' rows, "Connect to post" opens OAuth in a POPUP
 *     (per val's UX rule: no losing your place in the form). Connect flow
 *     itself is Phase C; the button is present but gracefully disabled with
 *     "Coming soon" until the scope expansion ships.
 *
 * Auth: every request goes to /api/client/intake/social/... with the share
 * token in a header. The route verifies the token and scopes to the brand
 * the token authorizes (single OR an allowed brand for owner-scoped tokens).
 */
import { useEffect, useState } from 'react';
import { apiCall, ApiError } from '@/lib/http';

type Provider = 'linkedin' | 'x' | 'instagram' | 'facebook' | 'tiktok' | 'youtube' | 'threads';
type Status = 'suggested' | 'confirmed' | 'connected' | 'rejected' | 'error';

interface Target {
  id: number;
  provider: Provider;
  targetType: 'personal' | 'organization' | 'page';
  sourceUrl: string;
  displayName: string | null;
  avatarUrl: string | null;
  ogTitle: string | null;
  status: Status;
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

function headers(token: string): Record<string, string> {
  return { 'x-intake-share-token': token };
}

export default function IntakeSocialChannelsBlock({
  token,
  clientId,
  brandName
}: {
  token: string;
  clientId: number;
  brandName: string;
}) {
  const [targets, setTargets] = useState<Target[] | null>(null);
  const [addUrl, setAddUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  async function refresh() {
    try {
      const data = await apiCall<{ ok: boolean; targets: Target[] }>(
        `/api/client/intake/social?brand=${clientId}`,
        undefined,
        { headers: headers(token) }
      );
      setTargets(data.targets);
    } catch {
      setTargets([]);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  async function addOne() {
    const url = addUrl.trim();
    if (!url) return;
    setBusy(true);
    setFeedback(null);
    try {
      await apiCall(
        `/api/client/intake/social?brand=${clientId}`,
        { url },
        { headers: headers(token), method: 'POST' }
      );
      setAddUrl('');
      setFeedback({ kind: 'ok', text: 'Added.' });
      await refresh();
    } catch (e) {
      const msg = e instanceof ApiError ? `Couldn't add (HTTP ${e.status})` : 'Could not add.';
      setFeedback({ kind: 'err', text: msg });
    } finally {
      setBusy(false);
    }
  }

  async function act(targetId: number, action: 'confirm' | 'reject') {
    setTargets((cur) =>
      cur ? cur.map((t) => (t.id === targetId ? { ...t, status: action === 'confirm' ? 'confirmed' : 'rejected' } : t)) : cur
    );
    try {
      await apiCall(
        `/api/client/intake/social/${targetId}?brand=${clientId}`,
        { action },
        { headers: headers(token) }
      );
      await refresh();
    } catch {
      await refresh(); // re-sync on error
    }
  }

  function openConnect(targetId: number) {
    // Phase C wires this up. For now, alert so we don't leave a dead button.
    // (Keeping the button visible signals to the client "you'll be able to
    // connect from here" without us pretending it works today.)
    setFeedback({
      kind: 'ok',
      text: 'Posting access connect is coming soon — confirm now and val will reach out to finish the LinkedIn link.'
    });
    void targetId;
  }

  if (targets === null) {
    return (
      <section className="mt-10 rounded-2xl border border-border bg-surface p-5">
        <h2 className="text-lg font-semibold text-ink mb-1">Your social channels</h2>
        <p className="text-sm text-muted">Loading…</p>
      </section>
    );
  }

  const allowOAuth = false; // Phase C feature flag

  return (
    <section className="mt-10 rounded-2xl border border-border bg-surface p-5">
      <h2 className="text-lg font-semibold text-ink">Your social channels — {brandName}</h2>
      <p className="text-sm text-muted mt-1 mb-4">
        We&apos;ve pre-loaded the accounts we have on file for you. Tell us if each one is right.
        You can add anything we missed.
      </p>

      {targets.length === 0 ? (
        <p className="text-xs text-muted italic">
          Nothing pre-loaded. Paste your social URLs below — one at a time.
        </p>
      ) : (
        <ul className="grid gap-2 mb-4">
          {targets.map((t) => (
            <li
              key={t.id}
              className={
                'flex items-start gap-3 rounded-lg border p-3 ' +
                (t.status === 'rejected'
                  ? 'border-border/40 bg-black/10 opacity-60'
                  : 'border-border bg-black/20')
              }
            >
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
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm text-ink truncate" title={t.ogTitle ?? t.sourceUrl}>
                    {t.ogTitle || t.displayName || t.sourceUrl}
                  </span>
                  <span className="text-[10px] uppercase tracking-[0.12em] text-muted">
                    {PROVIDER_LABEL[t.provider]} · {t.targetType}
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
                <div className="text-[11px] mt-1">
                  {t.status === 'suggested' && (
                    <span className="text-muted">Is this you?</span>
                  )}
                  {t.status === 'confirmed' && (
                    <span className="text-emerald-300">Confirmed</span>
                  )}
                  {t.status === 'connected' && (
                    <span className="text-emerald-300">Connected · ready to post</span>
                  )}
                  {t.status === 'rejected' && (
                    <span className="text-muted">Marked not me</span>
                  )}
                </div>
              </div>
              <div className="shrink-0 flex flex-col gap-1">
                {(t.status === 'suggested' || t.status === 'rejected') && (
                  <button
                    type="button"
                    onClick={() => act(t.id, 'confirm')}
                    className="text-[11px] rounded border border-border bg-brand text-black font-medium px-3 py-1.5"
                  >
                    Yes, this is me
                  </button>
                )}
                {t.status !== 'rejected' && (
                  <button
                    type="button"
                    onClick={() => act(t.id, 'reject')}
                    className="text-[11px] rounded border border-border bg-black/30 hover:bg-white/5 px-3 py-1.5 text-muted"
                  >
                    Not me
                  </button>
                )}
                {t.provider === 'linkedin' && t.status === 'confirmed' && (
                  <button
                    type="button"
                    onClick={() => openConnect(t.id)}
                    disabled={!allowOAuth}
                    className="text-[11px] rounded border border-border bg-black/30 hover:bg-white/5 px-3 py-1.5 text-ink disabled:opacity-50"
                    title={allowOAuth ? 'Open LinkedIn in a popup to authorize posting' : 'Coming soon'}
                  >
                    Connect to post
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-2 pt-3 border-t border-border/50">
        <input
          type="url"
          value={addUrl}
          onChange={(e) => setAddUrl(e.target.value)}
          placeholder="https://www.instagram.com/your-handle/"
          className="flex-1 rounded-lg border border-border bg-black/30 px-3 py-2 text-sm text-ink placeholder-muted/60 focus:outline-none focus:border-brand"
          disabled={busy}
        />
        <button
          type="button"
          onClick={addOne}
          disabled={busy || !addUrl.trim()}
          className="shrink-0 rounded-lg border border-border bg-black/30 hover:bg-white/5 text-ink text-sm px-4 py-2 disabled:opacity-50"
        >
          {busy ? 'Adding…' : 'Add channel'}
        </button>
      </div>
      {feedback && (
        <div className={`text-xs mt-2 ${feedback.kind === 'ok' ? 'text-emerald-300' : 'text-danger'}`}>
          {feedback.text}
        </div>
      )}
    </section>
  );
}
