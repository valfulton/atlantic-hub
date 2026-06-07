import type { MetadataRoute } from 'next';

/**
 * Web App Manifest — makes the client portal an INSTALLABLE app (val 2026-06-07:
 * "the special access is the app; desktop is the fallback"). Once installed
 * (Add to Home Screen on iOS, Install on Android/desktop Chrome) it opens
 * full-screen with its own icon and the cream/emerald brand chrome — the app
 * becomes the way in, and authentication centers on it.
 *
 * Scoped to /client so the installed app is the client experience, not the
 * operator hub. Next auto-injects <link rel="manifest"> from this route.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Atlantic & Vine',
    short_name: 'Atlantic & Vine',
    description: 'Your private growth dashboard — leads, press, and content in one place.',
    start_url: '/client/dashboard',
    scope: '/client',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#FAF8F4', // cream
    theme_color: '#0A4D3C',      // emerald-deep
    icons: [
      { src: '/brand/av-monogram.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/brand/av-monogram.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/brand/av-monogram.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
