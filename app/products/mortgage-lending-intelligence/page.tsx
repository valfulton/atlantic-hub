/**
 * /products/mortgage-lending-intelligence  (val 2026-06-11)
 *
 * Public landing page for the Mortgage Broker Intelligence vertical —
 * Atlantic & Vine's five products sold to mortgage brokers, MLOs, refi
 * specialists, commercial mortgage originators, and small mortgage shops
 * white-labeling intelligence. Each product card links to its detail page.
 *
 * Mirrors /products/collections-intelligence — server-rendered from the
 * static product registry at lib/av/products.ts. No database calls, no auth
 * — public marketing surface.
 *
 * Day-one moat: the MD Land Records adapter (#423) is the only state
 * recorder fully wired in mortgage intelligence. Marty Insley (MPG Loans)
 * is the anchor customer; the same engine extends to every state as
 * adapters ship.
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
  title: 'Mortgage Broker Intelligence · Atlantic & Vine',
  description:
    'Refi-trigger monitoring, refi cascade alerts, closing probability scoring, white-label intelligence for originator shops, and Maryland lien priority — five products from one engine for mortgage brokers and MLOs.'
};

export default function MortgageLendingIntelligencePage() {
  const products = listProductsByVertical('mortgage_lending');
  const displayName = VERTICAL_DISPLAY_NAMES['mortgage_lending'];
  const tagline = VERTICAL_TAGLINES['mortgage_lending'];

  return (
    <main style={{ background: '#FFFDF5', color: '#0A0A0A', minHeight: '100vh', padding: '3rem 1.5rem 4rem' }}>
      <div style={{ maxWidth: 980, margin: '0 auto' }}>
        {/* Breadcrumb */}
        <div style={{ fontSize: 11, color: 'rgba(10,10,10,0.55)', marginBottom: 16 }}>
          <Link href="/products" style={{ color: '#7A5A18', textDecoration: 'underline' }}>Products</Link>
          {' · '}
          <span>Mortgage Broker Intelligence</span>
        </div>

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

        {/* Day-one moat callout — MD recorder */}
        <div style={{ background: '#F7F1E1', borderRadius: 12, padding: '20px 24px', marginBottom: '2.5rem', textAlign: 'center' }}>
          <div style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#7A5A18', marginBottom: 8 }}>
            Maryland brokers — day-one advantage
          </div>
          <p style={{ fontSize: 14, lineHeight: 1.6, color: '#4A1B0C', margin: 0, fontStyle: 'italic' }}>
            Every Maryland property transfer, every refi-heavy zip, every denied-borrower opportunity flows into your watchlist the day the public record updates. The MD Land Records adapter covers every jurisdiction in one feed.
          </p>
        </div>

        {/* Product grid */}
        <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
          {products.map((p) => (
            <ProductCard key={p.slug} product={p} />
          ))}
        </div>

        {/* CTA */}
        <div style={{ marginTop: '3rem', padding: '24px 28px', background: '#0A4D3C', color: '#FFFDF5', borderRadius: 14, textAlign: 'center' }}>
          <div style={{ fontFamily: 'Fraunces, Cormorant Garamond, Georgia, serif', fontSize: 24, fontWeight: 500, marginBottom: 10 }}>
            Want to see this running on your book?
          </div>
          <div style={{ fontSize: 14, lineHeight: 1.5, marginBottom: 16, opacity: 0.85 }}>
            By invitation. A&amp;V works with a small number of mortgage shops per metro.
          </div>
          <Link href="/inquire" style={{ display: 'inline-block', background: '#FFFDF5', color: '#0A4D3C', padding: '10px 22px', borderRadius: 8, fontSize: 14, fontWeight: 500, textDecoration: 'none' }}>
            Request a demo
          </Link>
        </div>

        {/* Footer note */}
        <div style={{ marginTop: '3rem', textAlign: 'center', fontSize: 12, color: 'rgba(10,10,10,0.5)' }}>
          Pricing reflects standard tiers · Custom pricing available per shop ·
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
