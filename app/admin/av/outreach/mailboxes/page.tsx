/**
 * /admin/av/outreach/mailboxes
 *
 * Connect + manage the mailboxes that outreach sends from. Three drivers:
 *   - HostGator SMTP (the simplest -- user/pass from cPanel)
 *   - Microsoft Graph (OAuth -- Outlook / Microsoft 365)
 *   - Gmail API (OAuth -- Google Workspace / personal Gmail)
 *
 * No subscription email vendor required -- the platform owns the send path.
 */

import Link from 'next/link';
import { MailboxesPanel } from './MailboxesPanel';

export const runtime = 'nodejs';

export default function MailboxesPage() {
  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-ink tracking-tight">Mailboxes</h1>
          <p className="text-sm text-muted mt-1 max-w-2xl">
            Connect the mailboxes outreach campaigns send from. You can connect more than one
            (e.g. a HostGator address for direct sends + your Outlook for replies that land in
            your normal inbox).
          </p>
        </div>
        <Link
          href="/admin/av/outreach"
          className="px-3 py-1.5 text-sm rounded-md bg-surface border border-border hover:border-brand text-ink transition-colors"
        >
          Back to outreach
        </Link>
      </header>

      <MailboxesPanel />
    </div>
  );
}
