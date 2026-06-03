'use client';

/**
 * SocialDashboardBody  (#394, val 2026-06-03)
 *
 * The V3 social-skin top section of /client/dashboard. Renders ABOVE the
 * existing ClientDashboardBody so the brief/team/plan still flow below.
 *
 * Adriana opens to:
 *   1. Greeting (voice-dressed, brand-aware)
 *   2. StoryRow — brand switcher styled as IG stories
 *   3. FeaturedSignalHero — top distress watchlist entity, tap → /client/watchlist
 *   4. SectionHead "Your watchlist this week"
 *   5. SignalCard grid for the remaining rows
 *
 * Server-fed data only (no fetches inside) so the page is render-fast.
 */
import { useRouter } from 'next/navigation';
import StoryRow, { type BrandStory } from '@/app/client/_components/StoryRow';
import FeaturedSignalHero from '@/app/client/_components/FeaturedSignalHero';
import SignalCard, { type SignalTrailNode } from '@/app/client/_components/SignalCard';
import SectionHead from '@/components/SectionHead';

export interface SocialCardSeed {
  entityKey: string;
  entity: string;
  monogram?: string;
  chip?: string;
  chipKind?: 'signal' | 'fit';
  headline: string;
  trail: SignalTrailNode[];
}

interface Props {
  firstName: string;
  brands: BrandStory[];
  activeBrandId: string;
  /** Voice-dressed featured signal. Null when watchlist is empty. */
  featured: {
    entity: string;
    headline: string;
    trail: SignalTrailNode[];
  } | null;
  /** Remaining cards after the featured row. */
  cards: SocialCardSeed[];
}

export default function SocialDashboardBody({ firstName, brands, activeBrandId, featured, cards }: Props) {
  const router = useRouter();

  async function switchBrand(clientId: string) {
    if (clientId === activeBrandId) return;
    try {
      const r = await fetch('/api/client/active-brand', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clientId: Number.parseInt(clientId, 10) })
      });
      if (r.ok) router.refresh();
    } catch {
      /* non-fatal */
    }
  }

  function openWatchlist() {
    router.push('/client/watchlist');
  }

  // Hide entirely when there's nothing to feature AND no brand switcher.
  if (!featured && brands.length < 2 && cards.length === 0) {
    return null;
  }

  return (
    <section className="w-full max-w-6xl mx-auto px-3 sm:px-4 pt-6 sm:pt-10 pb-2">
      {/* Greeting — Cormorant Garamond via skin.social.css (navy palette). */}
      <header className="mb-2">
        <div className="text-[10px] uppercase tracking-[0.22em]" style={{ color: 'var(--amber-deep)' }}>
          Your channel · live
        </div>
        <h1
          className="text-2xl sm:text-4xl font-medium tracking-tight mt-2"
          style={{ fontFamily: 'var(--serif)', color: 'var(--cream)', lineHeight: 1.05 }}
        >
          Good morning, {firstName}.
        </h1>
      </header>

      {/* StoryRow — brand switcher. Hidden when single-brand. */}
      <StoryRow
        brands={brands}
        activeId={activeBrandId}
        onSwitch={switchBrand}
      />

      {/* Featured signal hero — top distress entity. */}
      {featured && (
        <div className="mb-6">
          <FeaturedSignalHero
            headline={featured.headline}
            entity={featured.entity}
            trail={featured.trail}
            onOpen={openWatchlist}
          />
        </div>
      )}

      {/* Watchlist cards */}
      {cards.length > 0 && (
        <>
          <SectionHead
            kicker="Your watchlist"
            title="This week, sorted by who needs you most"
            dek={`${cards.length + (featured ? 1 : 0)} entities · scored from public records`}
            tone="sea"
          >
            <button
              type="button"
              onClick={openWatchlist}
              className="hover:underline"
              style={{ color: 'var(--amber)', fontWeight: 500, letterSpacing: '0.08em' }}
            >
              Open watchlist →
            </button>
          </SectionHead>
          <div className="cards mb-8">
            {cards.map((c) => (
              <SignalCard
                key={c.entityKey}
                entity={c.entity}
                monogram={c.monogram}
                chip={c.chip}
                chipKind={c.chipKind}
                headline={c.headline}
                trail={c.trail}
                primary={{
                  label: 'Open the signal →',
                  onClick: openWatchlist
                }}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
