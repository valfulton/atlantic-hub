/**
 * /products/[slug]  (val 2026-06-11)
 *
 * Moved to /admin/av/products/[slug] (operator-only). This route now
 * redirects. Safe to delete in the next cleanup pass.
 */
import { redirect } from 'next/navigation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default function ProductDetailRedirect({ params }: { params: { slug: string } }) {
  redirect(`/admin/av/products/${params.slug}`);
}
