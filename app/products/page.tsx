/**
 * /products  (val 2026-06-11)
 *
 * Moved to /admin/av/products (operator-only). This route now redirects.
 * Safe to delete in the next cleanup pass.
 */
import { redirect } from 'next/navigation';

export const runtime = 'nodejs';
export const dynamic = 'force-static';

export default function ProductsIndexRedirect() {
  redirect('/admin/av/products');
}
