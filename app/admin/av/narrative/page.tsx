import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { listLanes, countActiveLines, MAX_ACTIVE_LINES, type NarrativeLane } from '@/lib/campaigns/store';
import { NarrativeCockpit } from './NarrativeCockpit';

export const dynamic = 'force-dynamic';

/**
 * /admin/av/narrative -- the Narrative Lines cockpit.
 *
 * A narrative line is a strategic MARKET THESIS (not a content category) that
 * steers every channel. Here you write the thesis + intelligence, move a line
 * through its lifecycle (candidate -> active -> reinforcing -> retiring) under a
 * hard 2-4 active cap, and capture engagement so the line learns. Owner + staff.
 */
export default async function NarrativePage() {
  const role = headers().get('x-ah-user-role') as 'owner' | 'staff' | 'client_user' | null;
  if (role === 'client_user') redirect('/admin');

  let lines: NarrativeLane[] = [];
  let activeCount = 0;
  try {
    lines = await listLanes('av', { includeInactive: true });
    activeCount = await countActiveLines('av');
  } catch {
    /* render empty; the cockpit will show a load error path */
  }

  return (
    <div className="max-w-5xl">
      <h1 className="text-3xl font-semibold tracking-tight mb-1">
        Narrative{' '}
        <span
          className="font-bold italic"
          style={{
            background: 'linear-gradient(120deg, #FF5A6E 0%, #FF9C5B 50%, #FFC73D 100%)',
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            color: 'transparent'
          }}
        >
          Lines
        </span>
      </h1>
      <p className="text-sm text-muted mb-6 max-w-2xl">
        Each line is a believable <em>market thesis</em> that steers your PR, social, blog, and
        commercials — so everything advances one story instead of drifting. Keep{' '}
        <strong>{MAX_ACTIVE_LINES} active at most</strong>; park the rest as candidates. Change a line and
        every new piece pivots with it.
      </p>
      <NarrativeCockpit
        initialLines={lines.map(toClient)}
        activeCount={activeCount}
        maxActive={MAX_ACTIVE_LINES}
      />
    </div>
  );
}

function toClient(l: NarrativeLane) {
  return {
    id: l.id,
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
