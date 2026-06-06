/**
 * /client/social/review  — RETIRED 2026-06-06
 *
 * Content Studio (/client/content) is the ONE client approval queue. Two
 * divergent queues over the same data was a hazard, so this route now just
 * redirects there. Kept the file (vs deleting) so any external link / bookmark
 * still lands the client somewhere sensible instead of a 404.
 */
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function ClientSocialReviewPage(): Promise<never> {
  redirect('/client/content');
}
