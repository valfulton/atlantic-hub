/**
 * /admin/av/outreach/new
 *
 * Create-a-campaign form. Lets the operator pick a connected mailbox,
 * set the AI prompt overrides, and decide caps + auto-advance behavior.
 */

import Link from 'next/link';
import { NewCampaignForm } from './NewCampaignForm';

export const runtime = 'nodejs';

export default function NewCampaignPage() {
  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink tracking-tight">New campaign</h1>
          <p className="text-sm text-muted mt-1 max-w-2xl">
            A campaign defines the offer, CTA, and signature that the AI uses to ground every
            draft. You can run several side-by-side — one per ICP, one per offer, etc.
          </p>
        </div>
        <Link
          href="/admin/av/outreach"
          className="text-sm text-muted hover:text-ink"
        >
          ← All outreach
        </Link>
      </header>
      <NewCampaignForm />
    </div>
  );
}
