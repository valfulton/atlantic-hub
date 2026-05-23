/**
 * Public newsroom layout.
 *
 * Unlike /client/* (noindex) and /admin/* (guarded), the newsroom is the
 * PUBLIC, indexable face of the platform -- the live proof that Atlantic & Vine
 * is an operating business. It is intentionally NOT in the middleware matcher,
 * so it is reachable without any session.
 *
 * Shares the dark-luxury design system (globals.css var(--brand)/--surface/etc.)
 * so it reads as the same world as the client hub it fronts.
 */
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Newsroom - Atlantic & Vine',
  description:
    'Insights, announcements, and field notes from Atlantic & Vine - the AI-native marketing intelligence platform.',
  openGraph: {
    title: 'Newsroom - Atlantic & Vine',
    description:
      'Insights, announcements, and field notes from Atlantic & Vine - the AI-native marketing intelligence platform.',
    type: 'website'
  }
};

export default function NewsroomLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-tenant="av" className="min-h-screen">
      <header className="border-b border-border">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
          <Link href="/newsroom" className="flex items-baseline gap-2 no-underline">
            <span className="text-ink font-semibold tracking-tight text-lg">Atlantic &amp; Vine</span>
            <span className="text-[10px] uppercase tracking-[0.22em] text-brand">Newsroom</span>
          </Link>
          <a
            href="https://atlanticandvine.netlify.app"
            target="_blank"
            rel="noopener"
            className="text-sm text-muted hover:text-ink transition-colors"
          >
            Visit the platform -&gt;
          </a>
        </div>
      </header>
      {children}
      <footer className="border-t border-border mt-16">
        <div className="max-w-5xl mx-auto px-4 py-8 text-xs text-muted flex flex-wrap items-center justify-between gap-3">
          <span>&copy; {new Date().getFullYear()} Atlantic And Vine LLC.</span>
          <a
            href="https://atlanticandvine.netlify.app/#client-intake"
            target="_blank"
            rel="noopener"
            className="text-brand hover:underline"
          >
            Work with us -&gt;
          </a>
        </div>
      </footer>
    </div>
  );
}
