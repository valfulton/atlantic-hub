/**
 * /products/collections-intelligence  (val 2026-06-11)
 *
 * Public landing page for the Collections Intelligence vertical — Atlantic &
 * Vine's five products sold to commercial collections agencies, B2B credit
 * firms, in-house AR teams, creditor law firms, and CA lien recovery
 * operators. Each product card links to its detail page.
 *
 * Renders server-side from the static product registry at lib/av/products.ts.
 * No database calls, no auth — public marketing surface.
 */
import Link from 'next/link';
import {
  listProductsByVertical,
  VERTICAL_DISPLAY_NAMES,
  VERTICAL_TAGLINES,
  type Product
} from '@/lib/av/products';

export const runtime = 'nodejs';
export const dynamic = 'force-static';

export const metadata = {
  title: 'Collections Intelligence · Atlantic & Vine',
  description:
    'Distress signals, vendor cascade alerts, recovery probability scoring, law-firm white-label intelligence, and CA lien priority — five products from one engine.'
};

export default function CollectionsIntelligencePage() {
  const products = listProductsByVertical('collections');
  const displayName = VERTICAL_DISPLAY_NAMES['collections'];
  const tagline = VERTICAL_TAGLINES['collections'];

  return (
    <main style={{ background: '#FFFDF5', color: '#0A0A0A', minHeight: '100vh', padding: '3rem 1.5rem 4rem' }}>
      <div style={{ maxWidth: 980, margin: '0 auto' }}>
        {/* Hero */}
        <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
          <div style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#7A5A18', marginBottom: 10 }}>
            Atlantic &amp; Vine · Vertical Pack
          </div>
          <h1 style={{ fontFamily: 'Fraunces, Cormorant Garamond, Georgia, serif', fontWeight: 500, fontSize: 44, lineHeight: 1.05, marginBottom: 16 }}>
            {displayName}
          </h1>
          <p style={{ fontSize: 16, lineHeight: 1.55, color: 'rgba(10,10,10,0.7)', maxWidth: 640, margin: '0 auto' }}>
            {tagline}
          </p>
        </div>

        {/* Product grid */}
        <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
          {products.map((p) => (
            <ProductCard key={p.slug} product={p} />
          ))}
        </div>

        {/* Footer note */}
        <div style={{ marginTop: '4rem', textAlign: 'center', fontSize: 12, color: 'rgba(10,10,10,0.5)' }}>
          Pricing reflects standard tiers · Custom pricing available per buyer ·
          {' '}
          <Link href="/inquire" style={{ color: '#7A5A18', textDecoration: 'underline' }}>By invitation only</Link>
        </div>
      </div>
    </main>
  );
}

function ProductCard({ product }: { product: Product }) {
  const statusBadge =
    product.status === 'live' ? { bg: '#E1F5EE', fg: '#085041', label: 'Live' }
    : product.status === 'beta' ? { bg: '#FAEEDA', fg: '#633806', label: 'Beta' }
    : { bg: '#F1EFE8', fg: '#444441', label: 'Coming soon' };
  const lowTier = product.pricing[0];
  return (
    <Link
      href={`/products/${product.slug}`}
      style={{
        display: 'block',
        background: '#FFFFFF',
        border: '0.5px solid rgba(10,10,10,0.12)',
        borderRadius: 14,
        padding: '20px 22px',
        textDecoration: 'none',
        color: 'inherit',
        transition: 'box-shadow 0.2s ease, transform 0.2s ease'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#7A5A18' }}>
          Product
        </span>
        <span
          style={{
            fontSize: 10,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            padding: '3px 8px',
            borderRadius: 6,
            background: statusBadge.bg,
            color: statusBadge.fg
          }}
        >
          {statusBadge.label}
        </span>
      </div>
      <h2 style={{ fontFamily: 'Fraunces, Cormorant Garamond, Georgia, serif', fontWeight: 500, fontSize: 22, lineHeight: 1.1, marginBottom: 10 }}>
        {product.name}
      </h2>
      <p style={{ fontSize: 13, lineHeight: 1.55, color: 'rgba(10,10,10,0.75)', marginBottom: 14 }}>
        {product.marketingTagline}
      </p>
      {lowTier && (
        <div style={{ fontSize: 13, fontWeight: 500, color: '#0A4D3C' }}>{lowTier.label}</div>
      )}
      <div style={{ fontSize: 11, color: '#7A5A18', marginTop: 10 }}>
        Learn more →
      </div>
    </Link>
  );
}
