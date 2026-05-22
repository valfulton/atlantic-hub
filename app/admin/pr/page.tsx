import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { PrDesk } from './PrDesk';

export const dynamic = 'force-dynamic';

/**
 * /admin/pr -- the Narrative Opportunity Engine (authority desk).
 *
 * NOT a "press release builder". This is the operator surface for the PR /
 * narrative intelligence engine (schema 025): a journalist-question inbox that
 * turns a pasted query into an instant, on-brand pitch grounded in the client's
 * accumulated intelligence, plus releases + distribution. Every action feeds the
 * shared intelligence graph (intelligence_objects) and emits pr.* events.
 *
 * Owner + staff only. Guarded by the existing /admin/* middleware matcher; this
 * page also rejects client_user defensively.
 */
export default function PrEnginePage() {
  const role = headers().get('x-ah-user-role') as 'owner' | 'staff' | 'client_user' | null;
  if (role === 'client_user') {
    redirect('/admin');
  }

  return (
    <div className="max-w-5xl">
      <div
        className="mb-1 inline-flex items-center gap-2 px-3 py-1 rounded-full text-[10.5px] uppercase tracking-[0.12em] font-medium"
        style={{ background: 'rgba(255,90,110,0.12)', color: '#FFE2DE', border: '1px solid rgba(255,90,110,0.3)' }}
      >
        <span>Authority desk</span>
      </div>
      <h1 className="text-3xl font-semibold tracking-tight mt-2 mb-1">
        Narrative Opportunity{' '}
        <span
          className="font-bold italic"
          style={{
            background: 'linear-gradient(120deg, #FF5A6E 0%, #FF9C5B 50%, #FFC73D 100%)',
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            color: 'transparent'
          }}
        >
          Engine
        </span>
      </h1>
      <p className="text-sm text-muted mb-6 max-w-2xl">
        Paste a journalist request, a podcast call for guests, or a community post expressing a real
        pain point. We read it, match it to the right client, explain why it matters, and draft a
        quotable response in that client&apos;s voice -- grounded in the intelligence we have already
        accumulated. Every draft makes the next one smarter.
      </p>

      <PrDesk />
    </div>
  );
}
