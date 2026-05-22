import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { SelfTestView } from './SelfTestView';

export const dynamic = 'force-dynamic';

/**
 * /admin/av/selftest -- one-load health check for the commercial,
 * brand-kit, logo-library and social-content stack.
 *
 * Renders the /api/admin/av/selftest probe as a green/red checklist so the
 * operator can confirm everything is wired (schema applied, env keys set,
 * data flowing) without opening a single lead.
 *
 * Owner + staff only.
 */
export default function CommercialSelfTestPage() {
  const role = headers().get('x-ah-user-role') as 'owner' | 'staff' | 'client_user' | null;
  if (role === 'client_user') {
    redirect('/admin');
  }

  return (
    <div className="max-w-4xl">
      <h1 className="text-3xl font-semibold tracking-tight mb-1">
        Commercial stack{' '}
        <span
          className="font-bold italic"
          style={{
            background: 'linear-gradient(120deg, #FF5A6E 0%, #FF9C5B 50%, #FFC73D 100%)',
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            color: 'transparent'
          }}
        >
          self-test
        </span>
      </h1>
      <p className="text-sm text-muted mb-6 max-w-2xl">
        One look tells you whether the database tables are live, the API keys are set, and your data is
        flowing -- no clicking through leads. Green is good. Red points at the exact thing to fix.
      </p>
      <SelfTestView />
    </div>
  );
}
