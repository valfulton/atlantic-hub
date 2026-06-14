/**
 * /admin/av/clients/[client_id]/preview/social  (val 2026-06-14, UX/UI audit)
 *
 * Operator mirror for /client/social/review. That client route was retired
 * 2026-06-06 in favor of /client/content (Content Studio is THE one approval
 * queue). The client page just redirects there.
 *
 * For the operator preview, mirror that exact behavior — redirect into the
 * Content preview mirror — so val never sees a 404 on the legacy URL and the
 * mirror-every-client-page rule is satisfied with the same outcome the client
 * gets.
 */
import { redirect, notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function PreviewClientSocialPage({
  params
}: {
  params: { client_id: string };
}): Promise<never> {
  const clientId = Number.parseInt(params.client_id, 10);
  if (!Number.isFinite(clientId) || clientId <= 0) notFound();
  redirect(`/admin/av/clients/${clientId}/preview/content`);
}
