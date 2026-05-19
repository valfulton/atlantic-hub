/**
 * /admin/av/outreach/[campaign_id]
 *
 * Per-campaign drill-in: edit metadata, view this campaign's approval
 * queue, recent sends, and replies. Pause/resume/archive controls live
 * here too.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CampaignDetailPanel } from './CampaignDetailPanel';

export const runtime = 'nodejs';

export default function CampaignDetailPage({
  params
}: {
  params: { campaign_id: string };
}) {
  const id = parseInt(params.campaign_id, 10);
  if (!Number.isFinite(id) || id <= 0) {
    notFound();
  }
  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between gap-3">
        <Link
          href="/admin/av/outreach"
          className="text-sm text-muted hover:text-ink"
        >
          ← All outreach
        </Link>
      </header>
      <CampaignDetailPanel campaignId={id} />
    </div>
  );
}
