import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  listLinesForCockpit, listCockpitCustomers, lineOwnerKey, MAX_ACTIVE_LINES, type NarrativeLane
} from '@/lib/campaigns/store';
import { outcomesForLines, type LineOutcomes } from '@/lib/campaigns/line_outcomes';
import { NarrativeCockpit } from './NarrativeCockpit';
import { LineBackfillButton } from './LineBackfillButton';
import { ClientFeedbackFeed } from './ClientFeedbackFeed';

export const dynamic = 'force-dynamic';

/**
 * /admin/av/narrative -- the Narrative Lines cockpit, scoped BY CUSTOMER.
 *
 * A narrative line is a strategic MARKET THESIS (not a content category) that
 * steers every channel. Lines are grouped under the customer that owns them —
 * your brands (Atlantic & Vine, Events by Water, Hunter Honey) and each client
 * account — so you can peek into any customer and steer their story. The 2-4
 * active cap is enforced PER customer. Owner + staff only.
 */
export default async function NarrativePage() {
  const role = headers().get('x-ah-user-role') as 'owner' | 'staff' | 'client_user' | null;
  if (role === 'client_user') redirect('/admin');

  let customers: Awaited<ReturnType<typeof listCockpitCustomers>> = [];
  let lines: NarrativeLane[] = [];
  try {
    [customers, lines] = await Promise.all([listCockpitCustomers(), listLinesForCockpit()]);
  } catch {
    /* render empty; the cockpit shows a graceful empty state */
  }

  // (#46 Inc 4) One outcomes query for every line on the cockpit, passed in
  // as initialOutcomes so each row renders its track record from page load —
  // no per-line fetch needed. Empty map on error so the cockpit still renders.
  let outcomes: Record<number, LineOutcomes> = {};
  try {
    outcomes = await outcomesForLines(lines.map((l) => l.id));
  } catch { /* empty map — strips hide */ }

  return (
    <div className="max-w-5xl">
      <h1 className="text-3xl font-semibold tracking-tight mb-1">
        Your{' '}
        <span
          className="font-bold italic"
          style={{
            background: 'linear-gradient(120deg, #FF5A6E 0%, #FF9C5B 50%, #FFC73D 100%)',
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            color: 'transparent'
          }}
        >
          Campaigns
        </span>
      </h1>
      <p className="text-sm text-muted mb-3 max-w-2xl">
        Every campaign is a believable <em>market thesis</em> (a &ldquo;narrative line&rdquo;) that
        steers a customer&apos;s PR, social, blog, and commercials. Grouped by customer — your brands
        and each client. Keep <strong>{MAX_ACTIVE_LINES} active at most per customer</strong>; park
        the rest as candidates.
      </p>
      {/* (#46 Inc 6) Backfill walks legacy un-threaded leads to their best-fit
          line so the spine catches up on everything created before Inc 2 wired
          auto-thread into discovery. Capped batch, fails soft. */}
      <div className="mb-6">
        <LineBackfillButton />
      </div>
      {/* (#61 Inc 4-polish-A) Client feedback on queued drafts — collapsed by
          default, hides when there's nothing to read. Sits above the cockpit
          so val sees comments without leaving the page. */}
      <ClientFeedbackFeed />
      <NarrativeCockpit
        customers={customers}
        initialLines={lines.map(toClient)}
        initialOutcomes={outcomes}
        maxActive={MAX_ACTIVE_LINES}
      />
    </div>
  );
}

function toClient(l: NarrativeLane) {
  return {
    id: l.id,
    ownerKey: lineOwnerKey(l.tenantId, l.clientId),
    tenantId: l.tenantId,
    clientId: l.clientId,
    name: l.name,
    state: l.state,
    accent: l.accent,
    thesis: l.thesis,
    audience: l.audience,
    emotionalDriver: l.emotionalDriver,
    authorityAngle: l.authorityAngle,
    seasonality: l.seasonality,
    conversionSignal: l.conversionSignal,
    proofPoints: l.proofPoints,
    doSay: l.doSay,
    dontSay: l.dontSay
  };
}
