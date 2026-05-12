import { headers } from 'next/headers';
import { isFlagEnabled } from '@/lib/feature-flags';
import { Sidebar } from '@/components/Sidebar';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const avEnabled = await isFlagEnabled('tab_av_enabled');
  const role = headers().get('x-ah-user-role') as 'owner' | 'staff' | 'client_user' | null;
  const showAv = avEnabled && (role === 'owner' || role === 'staff');

  return (
    <div className="flex min-h-screen">
      <Sidebar showAv={showAv} />
      <main className="flex-1 px-8 py-8 max-w-7xl">{children}</main>
    </div>
  );
}
