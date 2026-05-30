import type { Metadata } from 'next';
import { headers } from 'next/headers';
import ClientIntelTicker from './_components/ClientIntelTicker';
import BrandSwitcher from './_components/BrandSwitcher';
import { readClientActorFromHeaders } from '@/lib/auth/client-session';
import { findClientUserById } from '@/lib/auth/client-user';
import { listBrandsForUser } from '@/lib/client/membership';
import { activeBrandFor } from '@/lib/client/active-brand';

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
    <div data-tenant="av" className="min-h-screen">
      <BrandSwitcher brands={brands} activeClientId={activeClientId} />
      <ClientIntelTicker />
      {/* (#273) Wrap children in <main> so the global page-width containment
          rules in globals.css apply here too. Previously client pages had no
          <main> wrapper, so wide rows could push the page past the viewport
          and force horizontal scroll on phones / zoomed-in vision. */}
      <main className="min-w-0" style={{ maxWidth: '100%' }}>
        {children}
      </main>
    </div>
  );
}
