import type { Metadata } from 'next';
import { headers } from 'next/headers';
import ClientIntelTicker from './_components/ClientIntelTicker';
import BrandSwitcher from './_components/BrandSwitcher';
import BottomTabBar from './_components/BottomTabBar';
import { readClientActorFromHeaders } from '@/lib/auth/client-session';
import { findClientUserById } from '@/lib/auth/client-user';
import { listBrandsForUser } from '@/lib/client/membership';
import { activeBrandFor } from '@/lib/client/active-brand';
// (#393) V3 social skin — cream + emerald + gold + Fraunces/Inter palette
// pulled from live atlanticandvine.com. Scoped under [data-skin="social"]
// so operator pages stay dark-obsidian.
import './skin.social.css';
import './client-social.css';

export const metadata: Metadata = {
  title: 'Client Portal - Atlantic & Vine',
  description: 'Your audit, your dashboard, your account.',
  robots: 'noindex, nofollow'
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
    /* (#393, val 2026-06-03) data-skin="social" — newsroom palette (cream +
       emerald + gold) pulled from live atlanticandvine.com. Two-mood
       architecture: client wears this; operator (/admin/av/*) stays dark.
       Toggling data-skin off mid-demo falls back to default tokens. */
    <div data-tenant="av" data-skin="social" className="client-shell min-h-screen">
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
