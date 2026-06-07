import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Atlantic Hub',
  description: 'Operator dashboard for Atlantic & Vine, Events by Water, and HunterHoney Research',
  robots: 'noindex, nofollow',
  // App-first access (val 2026-06-07): installable client app, iOS standalone.
  appleWebApp: { capable: true, title: 'Atlantic & Vine', statusBarStyle: 'default' },
  icons: { apple: '/brand/av-monogram.png' }
};

export const viewport: Viewport = { themeColor: '#0A4D3C' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* Fraunces (incl. ITALIC for the scrolly ampersand) + Inter. Previously
            not loaded at all → every "Fraunces" heading fell back to Georgia. */}
        <link
          href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,400;0,9..144,500;0,9..144,600;0,9..144,700;1,9..144,400;1,9..144,500&family=Inter:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
