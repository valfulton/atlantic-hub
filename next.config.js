/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  productionBrowserSourceMaps: false,
  poweredByHeader: false,
  // pdfjs-dist must NOT be bundled by webpack. The legacy build spins up a
  // worker that webpack can't trace into the serverless bundle, which yields
  // 'Cannot find module ".next/server/chunks/pdf.worker.mjs"' at runtime.
  // Marking it external means Netlify keeps node_modules/pdfjs-dist intact
  // and our runtime createRequire().resolve() can find the worker file.
  experimental: {
    serverComponentsExternalPackages: ['pdfjs-dist']
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload'
          }
        ]
      }
    ];
  }
};

module.exports = nextConfig;
