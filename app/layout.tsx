import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Atlantic Hub',
  description: 'Operator dashboard for Atlantic & Vine, Events by Water, and HunterHoney Research',
  robots: 'noindex, nofollow'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
