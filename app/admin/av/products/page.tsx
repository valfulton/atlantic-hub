/**
 * /admin/av/products  (val 2026-06-11)
 *
 * OPERATOR-ONLY internal product catalog. Moved from public /products
 * per val 2026-06-11: not selling these publicly yet — this is the
 * planning surface for marketing rollout, narrative-line wiring, and
 * calendar packing. Behind the /admin/* JWT wall.
 *
 * Index of every Atlantic & Vine product, grouped by vertical pack.
 * Each vertical links to its grouped landing page; each product links
 * to its detail page.
 */
import Link from 'next/link';
import {
  groupProductsByVertical,
  VERTICAL_DISPLAY_NAMES,
  VERTICAL_TAGLINES
} from '@/lib/av/products';

export const runtime = 'nodejs';
export const dynamic = 'force-static';

export const metadata = {
  title: 'Products (internal) · Atlantic & Vine'
};

const VERTICAL_LANDING_SLUG: Record<string, string | null> = {
  collections: '/admin/av/products/collections-intelligence',
  mortgage_lending: '/admin/av/products/mortgage-lending-intelligence',
  // Add more as the landing pages are built.
};

export default function ProductsIndexPage() {
  const groups = groupProductsByVertical();
  const verticalIds = Object.keys(groups);

  return (
    <main style={{ background: '#FFFDF5', color: '#0A0A0A', minHeight: '100vh', padding: '3rem 1.5rem 4rem' }}>
      <div style={{ maxWidth: 980, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
          <div style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#7A5A18', marginBottom: 10 }}>
            Atlantic &amp; Vine · Operator catalog
          </div>
          <h1 style={{ fontFamily: 'Fraunces, Cormorant Garamond, Georgia, serif', fontWeight: 500, fontSize: 48, lineHeight: 1.05, marginBottom: 16 }}>
            Products
          </h1>
          <p style={{ fontSize: 16, lineHeight: 1.55, color: 'rgba(10,10,10,0.7)', maxWidth: 580, margin: '0 auto' }}>
            Internal planning surface — one engine, many verticals. Use these pages to brainstorm narrative lines, seed calendar content, and plan the marketing rollout.
          </p>
        </div>

        {verticalIds.map((vid) => {
          const products = groups[vid];
          const displayName = VERTICAL_DISPLAY_NAMES[vid] ?? vid;
          const tagline = VERTICAL_TAGLINES[vid] ?? '';
          const landing = VERTICAL_LANDING_SLUG[vid];
          return (
            <section key={vid} style={{ marginBottom: '3rem' }}>
              <div style={{ marginBottom: 16 }}>
                <h2 style={{ fontFamily: 'Fraunces, Cormorant Garamond, Georgia, serif', fontWeight: 500, fontSize: 30, marginBottom: 8 }}>
                  {landing ? (
                    <Link href={landing} style={{ color: '#0A0A0A', textDecoration: 'none' }}>
                      {displayName}
                    </Link>
                  ) : (
                    displayName
                  )}
                </h2>
                {tagline && (
                  <p style={{ fontSize: 14, color: 'rgba(10,10,10,0.65)', fontStyle: 'italic' }}>{tagline}</p>
                )}
              </div>
              <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
                {products.map((p) => {
                  const statusBadge =
                    p.status === 'live' ? { bg: '#E1F5EE', fg: '#085041', label: 'Live' }
                    : p.status === 'beta' ? { bg: '#FAEEDA', fg: '#633806', label: 'Beta' }
                    : { bg: '#F1EFE8', fg: '#444441', label: 'Coming soon' };
                  return (
                    <Link
                      key={p.slug}
                      href={`/admin/av/products/${p.slug}`}
                      style={{ display: 'block', background: '#FFFFFF', border: '0.5px solid rgba(10,10,10,0.12)', borderRadius: 12, padding: '16px 18px', textDecoration: 'none', color: 'inherit' }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                        <span style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#7A5A18' }}>{p.name}</span>
                        <span style={{ fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '2px 6px', borderRadius: 4, background: statusBadge.bg, color: statusBadge.fg }}>
                          {statusBadge.label}
                        </span>
                      </div>
                      <p style={{ fontSize: 13, lineHeight: 1.55, color: 'rgba(10,10,10,0.75)' }}>{p.marketingTagline}</p>
                      <div style={{ fontSize: 11, color: '#7A5A18', marginTop: 10 }}>Open →</div>
                    </Link>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </main>
  );
}
