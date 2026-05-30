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

  return (
    <div className="flex min-h-screen">
      <Sidebar showAv={showAv} showEbw={showEbw} />
      {/* (#270) max-w-7xl was clipping the long action button row on lead
          detail at typical zoom levels. Remove the hard width cap and let the
          flex container breathe — sidebar is 256px fixed, content fills the
          rest. Add a max-w of 1600px so on ultrawide monitors text doesn't
          stretch past readable line length, but on standard 1440-1920 screens
          it'll use the full width. */}
      <main className="flex-1 px-8 py-8 min-w-0" style={{ maxWidth: '1600px' }}>
        {isOperator && <IntelTicker />}
        {children}
      </main>
    </div>
  );
}
