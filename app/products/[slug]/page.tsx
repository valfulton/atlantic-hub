/**
 * /products/[slug]  (val 2026-06-11)
 *
 * Public detail page for a single Atlantic & Vine product. Renders from the
 * static product registry at lib/av/products.ts. 404s if the slug is unknown.
 *
 * Static generation: every product in the registry pre-renders at build
 * time via generateStaticParams + force-static. Adding a new product means
 * adding to PRODUCTS — no manual route work needed.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import {
  PRODUCTS,
  getProductBySlug,
  VERTICAL_DISPLAY_NAMES
} from '@/lib/av/products';

export const runtime = 'nodejs';
export const dynamic = 'force-static';
export const revalidate = false;

export function generateStaticParams() {
  return PRODUCTS.map((p) => ({ slug: p.slug }));
}

export function generateMetadata({ params }: { params: { slug: string } }) {
  const product = getProductBySlug(params.slug);
  if (!product) return { title: 'Product · Atlantic & Vine' };
  return {
    title: `${product.name} · Atlantic & Vine`,
    description: product.oneLiner
  };
}

export default function ProductDetailPage({ params }: { params: { slug: string } }) {
  const product = getProductBySlug(params.slug);
  if (!product) notFound();
  const verticalName = VERTICAL_DISPLAY_NAMES[product.verticalPackId] ?? product.verticalPackId;
  const verticalSlug =
    product.verticalPackId === 'collections' ? '/products/collections-intelligence'
    : `/products/${product.verticalPackId.replace(/_/g, '-')}-intelligence`;
  const statusBadge =
    product.status === 'live' ? { bg: '#E1F5EE', fg: '#085041', label: 'Live' }
    : product.status === 'beta' ? { bg: '#FAEEDA', fg: '#633806', label: 'Beta' }
    : { bg: '#F1EFE8', fg: '#444441', label: 'Coming soon' };

  return (
    <main style={{ background: '#FFFDF5', color: '#0A0A0A', minHeight: '100vh', padding: '3rem 1.5rem 4rem' }}>
      <div style={{ maxWidth: 860, margin: '0 auto' }}>
        {/* Breadcrumb */}
        <div style={{ fontSize: 11, color: 'rgba(10,10,10,0.55)', marginBottom: 16 }}>
          <Link href="/products" style={{ color: '#7A5A18', textDecoration: 'underline' }}>Products</Link>
          {' · '}
          <Link href={verticalSlug} style={{ color: '#7A5A18', textDecoration: 'underline' }}>{verticalName}</Link>
        </div>

        {/* Header */}
        <div style={{ marginBottom: '2rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <span style={{ fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase', color: '#7A5A18' }}>
              Product
            </span>
            <span style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', padding: '3px 8px', borderRadius: 6, background: statusBadge.bg, color: statusBadge.fg }}>
              {statusBadge.label}
            </span>
          </div>
          <h1 style={{ fontFamily: 'Fraunces, Cormorant Garamond, Georgia, serif', fontWeight: 500, fontSize: 40, lineHeight: 1.1, marginBottom: 14 }}>
            {product.name}
          </h1>
          <p style={{ fontSize: 17, lineHeight: 1.55, color: 'rgba(10,10,10,0.78)' }}>
            {product.oneLiner}
          </p>
        </div>

        {/* Marketing tagline block */}
        <div style={{ background: '#F7F1E1', borderRadius: 12, padding: '18px 22px', marginBottom: '2rem', fontStyle: 'italic', fontSize: 18, lineHeight: 1.5, color: '#4A1B0C' }}>
          “{product.marketingTagline}”
        </div>

        {/* Who buys this */}
        <Section title="Who this is for">
          <p style={{ fontSize: 15, lineHeight: 1.6 }}>{product.customer}</p>
        </Section>

        {/* Pricing */}
        <Section title="Pricing">
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: product.pricing.length > 1 ? 'repeat(auto-fit, minmax(260px, 1fr))' : '1fr' }}>
            {product.pricing.map((tier, i) => (
              <div key={i} style={{ background: '#FFFFFF', border: '0.5px solid rgba(10,10,10,0.12)', borderRadius: 12, padding: '16px 18px' }}>
                <div style={{ fontFamily: 'Fraunces, Cormorant Garamond, Georgia, serif', fontSize: 22, fontWeight: 500, color: '#0A4D3C', marginBottom: 10 }}>
                  {tier.label}
                </div>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: 13, lineHeight: 1.6 }}>
                  {tier.includes.map((line, j) => (
                    <li key={j} style={{ paddingLeft: 18, position: 'relative', marginBottom: 4 }}>
                      <span style={{ position: 'absolute', left: 0, color: '#7A5A18' }}>✓</span>
                      {line}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Section>

        {/* Engine pieces */}
        <Section title="What powers it">
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: 13, lineHeight: 1.7 }}>
            {product.engineCapabilities.map((cap, i) => (
              <li key={i} style={{ paddingLeft: 18, position: 'relative', color: 'rgba(10,10,10,0.75)' }}>
                <span style={{ position: 'absolute', left: 0, color: '#0A4D3C' }}>•</span>
                {cap}
              </li>
            ))}
          </ul>
          {product.pendingDependencies.length > 0 && (
            <div style={{ marginTop: 16, padding: '12px 14px', background: '#FAEEDA', borderRadius: 8, fontSize: 12, lineHeight: 1.5 }}>
              <strong style={{ color: '#633806' }}>Still to ship for full delivery:</strong>
              <ul style={{ margin: '6px 0 0 0', paddingLeft: 18, color: 'rgba(10,10,10,0.75)' }}>
                {product.pendingDependencies.map((dep, i) => (
                  <li key={i}>{dep}</li>
                ))}
              </ul>
            </div>
          )}
        </Section>

        {/* Moat */}
        {product.moat && (
          <Section title="Why this is defensible">
            <p style={{ fontSize: 14, lineHeight: 1.65, color: 'rgba(10,10,10,0.75)' }}>{product.moat}</p>
          </Section>
        )}

        {/* CTA */}
        <div style={{ marginTop: '2rem', padding: '24px 28px', background: '#0A4D3C', color: '#FFFDF5', borderRadius: 14, textAlign: 'center' }}>
          <div style={{ fontFamily: 'Fraunces, Cormorant Garamond, Georgia, serif', fontSize: 24, fontWeight: 500, marginBottom: 10 }}>
            Want to see this running?
          </div>
          <div style={{ fontSize: 14, lineHeight: 1.5, marginBottom: 16, opacity: 0.85 }}>
            By invitation. A&V works with a small number of clients per vertical.
          </div>
          <Link href="/inquire" style={{ display: 'inline-block', background: '#FFFDF5', color: '#0A4D3C', padding: '10px 22px', borderRadius: 8, fontSize: 14, fontWeight: 500, textDecoration: 'none' }}>
            Request a demo
          </Link>
        </div>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: '2rem' }}>
      <h2 style={{ fontFamily: 'Fraunces, Cormorant Garamond, Georgia, serif', fontWeight: 500, fontSize: 22, marginBottom: 12, color: '#0A0A0A' }}>
        {title}
      </h2>
      {children}
    </div>
  );
}
