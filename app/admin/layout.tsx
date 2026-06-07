import { headers } from 'next/headers';
import { isFlagEnabled } from '@/lib/feature-flags';
import { Sidebar } from '@/components/Sidebar';
import { IntelTicker } from '@/components/IntelTicker';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const [avEnabled, ebwEnabled] = await Promise.all([
    isFlagEnabled('tab_av_enabled'),
    isFlagEnabled('tab_ebw_enabled')
  ]);
  const role = headers().get('x-ah-user-role') as 'owner' | 'staff' | 'client_user' | null;
  const isOperator = role === 'owner' || role === 'staff';
  const showAv = avEnabled && isOperator;
  const showEbw = ebwEnabled && isOperator;

  // (val 2026-06-07, #494) Mobile path: on phones the 256px fixed sidebar +
  // 32px main padding leaves the operator with ~60px of usable width. Hide
  // the sidebar under 768px (it's still reachable via the hamburger inside
  // the Sidebar component's mobile mode) and shrink main padding so the
  // form/buttons get the screen they need. Desktop layout unchanged.
  return (
    <div className="flex min-h-screen">
      <Sidebar showAv={showAv} showEbw={showEbw} />
      <main
        className="flex-1 px-4 sm:px-8 py-4 sm:py-8 min-w-0"
        style={{ maxWidth: '1600px' }}
      >
        {isOperator && <IntelTicker />}
        {children}
      </main>
    </div>
  );
}
