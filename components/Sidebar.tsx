'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV = [
  { href: '/admin', label: 'Home' },
  { href: '/admin/hh', label: 'HunterHoney' },
  { href: '/admin/hh/subscribers', label: '  Subscribers' },
  { href: '/admin/hh/fap-applications', label: '  FAP Applications' },
  { href: '/admin/hh/cohort-waitlist', label: '  Cohort Waitlist' },
  { href: '/admin/hh/research-api', label: '  Research API' }
];

export function Sidebar() {
  const pathname = usePathname();
  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  }
  return (
    <aside className="w-60 bg-surface border-r border-border min-h-screen flex flex-col">
      <div className="px-6 py-5 border-b border-border">
        <div className="text-lg font-semibold">Atlantic Hub</div>
        <div className="text-xs text-muted">Operator dashboard</div>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-1 text-sm">
        {NAV.map((n) => {
          const active = pathname === n.href;
          return (
            <Link
              key={n.href}
              href={n.href}
              className={`block px-3 py-2 rounded-md whitespace-pre ${
                active ? 'bg-surface-2 font-medium' : 'hover:bg-surface-2 text-muted'
              }`}
            >
              {n.label}
            </Link>
          );
        })}
      </nav>
      <button
        onClick={logout}
        className="m-3 px-3 py-2 text-sm rounded-md border border-border hover:bg-surface-2"
      >
        Sign out
      </button>
    </aside>
  );
}
