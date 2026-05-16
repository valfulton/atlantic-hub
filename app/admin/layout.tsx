import { headers } from 'next/headers';
import { isFlagEnabled } from '@/lib/feature-flags';
import { Sidebar } from '@/components/Sidebar';

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
      <main className="flex-1 px-8 py-8 max-w-7xl">{children}</main>
    </div>
  );
}
