import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import ClientIntelTicker from './_components/ClientIntelTicker';
import BrandSwitcher from './_components/BrandSwitcher';
import BottomTabBar from './_components/BottomTabBar';
import { readClientActorFromHeaders } from '@/lib/auth/client-session';
import { findClientUserById } from '@/lib/auth/client-user';
import { listBrandsForUser } from '@/lib/client/membership';
import { activeBrandFor } from '@/lib/client/active-brand';
// Canonical client-app design system — ONE file controls every /client/*
// surface. Tokens, top bar, greeting, brand switcher, hero, section heads,
// signal cards, ghost-gold CTAs, empty states. Edit `_styles/app.css` to
// retune the entire app.
import './_styles/app.css';
// Legacy skin files (kept temporarily so v3-* / amber utility refs don't
// break mid-migration). Remove once every page uses the canonical .app-*.
import './skin.social.css';
import './client-social.css';

export const metadata: Metadata = {
  title: 'Client Portal - Atlantic & Vine',
  description: 'Your audit, your dashboard, your account.',
  robots: 'noindex, nofollow'
};

// viewport-fit=cover exposes env(safe-area-inset-*) so the fixed bottom tab bar
// clears the iPhone home indicator. Without this, every safe-area calc returns 0.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover'
};

/** Resolve the logged-in person's brands + active brand for the switcher.
 *  Returns empty for public/unauthenticated client routes (login, magic-link). */
async function loadSwitcher(): Promise<{ brands: { clientId: number; clientName: string | null; role: 'owner' | 'rep' | 'viewer' }[]; activeClientId: number | null }> {
  try {
    const actor = readClientActorFromHeaders(headers() as unknown as Headers);
    if (!actor) return { brands: [], activeClientId: null };
    const brands = await listBrandsForUser(actor.clientUserId);
    if (brands.length < 2) return { brands, activeClientId: null };
    const user = await findClientUserById(actor.clientUserId);
    const active = await activeBrandFor(actor.clientUserId, user?.client_id ?? null);
    return { brands, activeClientId: active };
  } catch {
    return { brands: [], activeClientId: null };
  }
}

export default async function ClientLayout({ children }: { children: React.ReactNode }) {
  const { brands, activeClientId } = await loadSwitcher();
  return (
    /* `.app` is the canonical client-app shell — cream + emerald + gold,
       Fraunces serif, Inter sans. Every /client/* page inherits the design
       system from `_styles/app.css`. `data-skin="social"` kept for legacy
       components that still scope under it; new code uses .app-* classes. */
    <div data-tenant="av" data-skin="social" className="app client-shell min-h-screen">
      <BrandSwitcher brands={brands} activeClientId={activeClientId} />
      <ClientIntelTicker />
      <main className="min-w-0" style={{ maxWidth: '100%' }}>
        {children}
      </main>
      {/* Mobile tab bar — CSS hides it at >=761px so desktop stays clean. */}
      <BottomTabBar />
    </div>
  );
}
