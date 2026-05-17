import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Client Portal - Atlantic & Vine',
  description: 'Your audit, your dashboard, your account.',
  robots: 'noindex, nofollow'
};

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-tenant="av" className="min-h-screen">
      {children}
    </div>
  );
}
