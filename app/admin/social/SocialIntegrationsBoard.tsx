'use client';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

/**
 * Multi-tenant social integrations board. v0 stub.
 *
 * - Tenant chip selector across the top so Val can preview the
 *   "Posting as: Atlantic & Vine / Events by Water / HunterHoney / Client X"
 *   pattern that ships in the next session.
 * - Five provider cards (LinkedIn / X / Instagram / Facebook / TikTok) in
 *   the rollout-friendly order.
 * - Each card includes the FRICTION reality so Val can set client
 *   expectations: which providers can ship in days vs which sit behind
 *   Meta / TikTok app review queues.
 * - Connect buttons are present and clickable but show a "Coming next
 *   session" toast for now -- they will become real OAuth kickoffs once
 *   the social-posting session lands.
 *
 * No per-unit cost is shown here (per CLIENT_FACING_GUARDRAILS.md).
 */

type Tenant = {
  id: string;
  label: string;
  emoji: string;
};

type Friction = 'easy' | 'medium' | 'hard';

type Provider = {
  id: 'linkedin' | 'x' | 'instagram' | 'facebook' | 'tiktok';
  label: string;
  blurb: string;
  brandColor: string; // primary gradient color for accents
  friction: Friction;
  frictionNote: string;
  formats: string[];
};

const TENANTS: Tenant[] = [
  { id: 'av', label: 'Atlantic & Vine', emoji: '🍇' },
  { id: 'ebw', label: 'Events by Water', emoji: '⛵' },
  { id: 'hh', label: 'HunterHoney', emoji: '🍯' },
  { id: 'client', label: 'A client of mine', emoji: '🤝' }
];

const PROVIDERS: Provider[] = [
  {
    id: 'linkedin',
    label: 'LinkedIn',
    blurb: 'Personal profile + company pages. Best for B2B audit-driven warmups.',
    brandColor: '#0A66C2',
    friction: 'easy',
    frictionNote: 'OAuth + verification, ~1 day. Ships first.',
    formats: ['Text', 'Image', 'Video']
  },
  {
    id: 'x',
    label: 'X (Twitter)',
    blurb: 'Punchy, high-cadence outbound and brand presence.',
    brandColor: '#0F1419',
    friction: 'easy',
    frictionNote: 'Requires X API Basic plan ($100/mo). Ships first.',
    formats: ['Text', 'Image', 'Video']
  },
  {
    id: 'instagram',
    label: 'Instagram',
    blurb: 'Business / Creator accounts via Meta Graph. Feed, Reels, Stories.',
    brandColor: '#E1306C',
    friction: 'medium',
    frictionNote: 'Meta Business app + review (~3-10 days).',
    formats: ['Image', 'Carousel', 'Reel']
  },
  {
    id: 'facebook',
    label: 'Facebook Pages',
    blurb: 'Company pages via the same Meta Graph integration as Instagram.',
    brandColor: '#1877F2',
    friction: 'medium',
    frictionNote: 'Bundled with Meta app review.',
    formats: ['Text', 'Image', 'Video']
  },
  {
    id: 'tiktok',
    label: 'TikTok',
    blurb: 'Short-form vertical video. Aligns with 9:16 commercial output.',
    brandColor: '#FE2C55',
    friction: 'hard',
    frictionNote: 'TikTok for Developers approval (~1-2 weeks).',
    formats: ['Video', 'Carousel']
  }
];

const FRICTION_STYLE: Record<Friction, string> = {
  easy: 'text-emerald-300 bg-emerald-500/10 border-emerald-400/30',
  medium: 'text-amber-200 bg-amber-500/10 border-amber-400/30',
  hard: 'text-rose-200 bg-rose-500/10 border-rose-400/30'
};

const FRICTION_LABEL: Record<Friction, string> = {
  easy: 'Ships next session',
  medium: 'Pending Meta review',
  hard: 'Pending TikTok review'
};

export function SocialIntegrationsBoard() {
  const [tenant, setTenant] = useState<Tenant>(TENANTS[0]);
  const [toast, setToast] = useState<string | null>(null);
  const searchParams = useSearchParams();
  const queuedAssetId = searchParams?.get('asset_id') ?? null;
  const intent = searchParams?.get('intent') ?? null;

  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3500);
  }

  useEffect(() => {
    if (queuedAssetId && intent === 'publish') {
      showToast(
        `Commercial #${queuedAssetId} queued for publish. Connect a platform below; the OAuth + publish flow lands in the next session.`
      );
    }
  }, [queuedAssetId, intent]);

  return (
    <div className="space-y-6">
      {/* Asset handoff banner */}
      {queuedAssetId && intent === 'publish' && (
        <div
          className="rounded-2xl p-4 border flex items-start gap-3"
          style={{
            background: 'linear-gradient(120deg, rgba(255,90,110,0.14), rgba(255,199,61,0.08))',
            borderColor: 'rgba(255,156,91,0.4)'
          }}
        >
          <span className="text-2xl" aria-hidden>📣</span>
          <div className="flex-1">
            <div className="text-sm font-semibold text-ink">
              Commercial #{queuedAssetId} is waiting to publish
            </div>
            <p className="text-xs text-muted mt-1 max-w-xl leading-relaxed">
              Once the OAuth flow lands (next session), this banner becomes a composer where you pick which connected accounts post this asset, edit the caption per platform, schedule with smart timing, and ship. For now the asset is staged -- connect at least one platform below to be ready.
            </p>
          </div>
        </div>
      )}

      {/* Tenant selector */}
      <div className="bg-surface border border-border rounded-2xl p-4">
        <div className="text-[11px] uppercase tracking-[0.12em] text-muted mb-2">
          Posting as
        </div>
        <div className="flex flex-wrap gap-2">
          {TENANTS.map((t) => {
            const active = t.id === tenant.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTenant(t)}
                className={`px-3.5 py-1.5 rounded-full text-sm transition-all border ${
                  active
                    ? 'border-transparent text-white shadow-lg shadow-pink-500/20'
                    : 'border-border text-muted hover:text-ink hover:border-pink-400/60'
                }`}
                style={
                  active
                    ? { background: 'linear-gradient(120deg, #FF5A6E, #FF9C5B)' }
                    : undefined
                }
              >
                <span className="mr-1.5" aria-hidden>{t.emoji}</span>
                {t.label}
              </button>
            );
          })}
        </div>
        <p className="text-[12px] text-muted mt-3 leading-relaxed">
          Each tenant has its own social connections. When the OAuth flow ships, clicking <strong>Connect</strong> below
          will open the chosen platform&apos;s sign-in and link that account to <strong>{tenant.label}</strong> only.
          You will never need to type a handle -- the platform tells us who it is.
        </p>
      </div>

      {/* Connected accounts */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-medium text-ink flex items-center gap-2">
            <span className="text-lg" aria-hidden>🔗</span>
            Connected accounts for {tenant.label}{' '}
            <span className="text-muted font-normal">(0)</span>
          </h2>
        </div>
        <div className="bg-surface border border-border rounded-2xl px-6 py-10 text-center">
          <div className="text-4xl mb-2 animate-pulse" aria-hidden>✨</div>
          <p className="text-sm text-ink font-medium">No accounts connected yet.</p>
          <p className="text-xs text-muted mt-1 max-w-md mx-auto">
            Once the OAuth connectors land (next session), every account you connect from the cards
            below will appear here with a status pill and a Disconnect button.
          </p>
        </div>
      </section>

      {/* Provider cards */}
      <section>
        <h2 className="text-sm font-medium text-ink flex items-center gap-2 mb-3">
          <span className="text-lg" aria-hidden>🎛️</span>
          Available platforms
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {PROVIDERS.map((p) => (
            <ProviderCard
              key={p.id}
              provider={p}
              tenant={tenant}
              onConnect={() =>
                showToast(
                  `${p.label} OAuth ships in the social-posting session. The Connect button is wired to the kickoff doc.`
                )
              }
            />
          ))}
        </div>
      </section>

      {/* Cadence preview */}
      <section className="bg-surface border border-border rounded-2xl p-5">
        <h2 className="text-sm font-medium text-ink flex items-center gap-2 mb-1">
          <span className="text-lg" aria-hidden>⏱️</span>
          Smart cadence
        </h2>
        <p className="text-xs text-muted mb-4 max-w-2xl">
          Once accounts are connected, scheduling is driven by lead heat + audience timezone +
          platform best-times. Hot leads get posted to sooner and in platform prime windows. Cool
          leads get queued for slower drips. You can override per-tenant.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
          <CadenceCard
            label="🔥 Hot leads"
            description="Same-day post in the lead's local prime window. Defaults to platform-best (e.g. LinkedIn Tue-Thu 7-9am)."
          />
          <CadenceCard
            label="☀️ Warm leads"
            description="Within 48h. Smart-spaced across platforms so a single brand doesn't double-post in 2 hours."
          />
          <CadenceCard
            label="❄️ Cool leads"
            description="Slow drip across the week. Background presence, no overcommit."
          />
        </div>
      </section>

      {/* Roadmap link */}
      <div className="bg-surface border border-border rounded-2xl p-5 text-xs text-muted">
        <div className="text-ink font-medium text-sm mb-1">📋 Roadmap</div>
        Full spec for the OAuth + scheduled-push session lives at{' '}
        <code className="bg-bg px-1.5 py-0.5 rounded text-ink">docs/CLAUDE_KICKOFF_SOCIAL_POSTING.md</code>.
        Hand it to the conductor in the next session to dispatch this build.
      </div>

      {/* Toast */}
      {toast && (
        <div
          className="fixed bottom-6 right-6 z-50 max-w-sm rounded-xl border border-border bg-surface text-sm text-ink shadow-2xl"
          style={{ borderColor: 'rgba(255,156,91,0.35)' }}
        >
          <div className="p-4 flex items-start gap-3">
            <span className="text-amber-300" aria-hidden>✨</span>
            <div className="flex-1">{toast}</div>
            <button
              type="button"
              onClick={() => setToast(null)}
              className="text-muted hover:text-ink text-lg leading-none"
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ProviderCard({
  provider,
  tenant,
  onConnect
}: {
  provider: Provider;
  tenant: Tenant;
  onConnect: () => void;
}) {
  return (
    <div className="relative bg-surface border border-border rounded-2xl p-5 overflow-hidden transition-all hover:border-pink-400/40 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-pink-500/5">
      {/* Brand color flourish */}
      <div
        className="pointer-events-none absolute -top-12 -right-12 w-32 h-32 rounded-full opacity-20 blur-2xl"
        style={{ background: provider.brandColor }}
      />

      <div className="relative flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2.5">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center text-white font-bold text-sm"
            style={{ background: provider.brandColor }}
            aria-hidden
          >
            {provider.label[0]}
          </div>
          <div>
            <div className="font-semibold text-ink leading-tight">{provider.label}</div>
            <div className="text-[10px] uppercase tracking-[0.1em] text-muted mt-0.5">
              for {tenant.label}
            </div>
          </div>
        </div>
        <span
          className={`text-[10px] uppercase tracking-[0.08em] px-2 py-0.5 rounded-full border whitespace-nowrap ${FRICTION_STYLE[provider.friction]}`}
        >
          {FRICTION_LABEL[provider.friction]}
        </span>
      </div>

      <p className="relative text-xs text-muted leading-relaxed mb-3">{provider.blurb}</p>

      <div className="relative flex flex-wrap gap-1 mb-4">
        {provider.formats.map((f) => (
          <span
            key={f}
            className="text-[10px] uppercase tracking-[0.08em] px-2 py-0.5 rounded-full border border-border text-muted"
          >
            {f}
          </span>
        ))}
      </div>

      <div className="relative text-[11px] text-muted mb-3 leading-snug">
        <strong className="text-ink/80">Status:</strong> {provider.frictionNote}
      </div>

      <button
        type="button"
        onClick={onConnect}
        className="relative w-full px-4 py-2 rounded-full text-white text-sm font-medium transition-all"
        style={{
          background: 'linear-gradient(120deg, #FF5A6E, #FF9C5B)',
          boxShadow: '0 8px 20px -8px rgba(255,90,110,0.5)'
        }}
      >
        Connect {provider.label}
      </button>
    </div>
  );
}

function CadenceCard({ label, description }: { label: string; description: string }) {
  return (
    <div className="rounded-xl border border-border bg-bg/40 p-3">
      <div className="font-medium text-ink mb-1">{label}</div>
      <div className="text-[11.5px] text-muted leading-relaxed">{description}</div>
    </div>
  );
}
