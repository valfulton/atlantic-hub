/**
 * /admin/av/outreach
 *
 * Operator overview surface for outreach automation. Three sections:
 *   1. Active campaigns (card grid)
 *   2. Pending approval queue (the daily workflow -- crush these to move the funnel)
 *   3. Recent replies with AI classification
 *
 * Sits above the existing AV pipeline -- closes the loop on every lead.
 */

import Link from 'next/link';
import { OutreachOverview } from './OutreachOverview';

export const runtime = 'nodejs';

export default function OutreachPage() {
  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-ink tracking-tight">Outreach</h1>
          <p className="text-sm text-muted mt-1 max-w-2xl">
            AI drafts a personalized email for every high-scoring lead, grounded in their own
            audit. You approve in one click; the system sends from your mailbox, tracks the reply,
            and advances the funnel.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/admin/av/outreach/mailboxes"
            className="px-3 py-1.5 text-sm rounded-md bg-surface border border-border hover:border-brand text-ink transition-colors"
          >
            Mailboxes
          </Link>
          <Link
            href="/admin/av/outreach/new"
            className="px-3 py-1.5 text-sm rounded-md bg-brand text-ink font-medium transition-colors"
          >
            + New campaign
          </Link>
        </div>
      </header>

      <OutreachOverview />
    </div>
  );
}
