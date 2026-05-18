import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { SocialIntegrationsBoard } from './SocialIntegrationsBoard';

export const dynamic = 'force-dynamic';

/**
 * /admin/social -- Social Integrations landing.
 *
 * v0 stub: shows the navigation slot, all five provider cards (LinkedIn,
 * X, Instagram, Facebook, TikTok), the multi-tenant chip, and a clear
 * "Coming next session" CTA per provider so Val can demo the roadmap
 * before the OAuth flow is built.
 *
 * The full implementation is queued at:
 *   docs/CLAUDE_KICKOFF_SOCIAL_POSTING.md
 *
 * That session will replace this page's static cards with live OAuth
 * Connect buttons and a connected-accounts list backed by schema 017.
 */
export default function SocialIntegrationsPage() {
  const role = headers().get('x-ah-user-role') as 'owner' | 'staff' | 'client_user' | null;
  if (role === 'client_user') {
    redirect('/admin');
  }

  return (
    <div className="max-w-5xl">
      <div className="mb-1 inline-flex items-center gap-2 px-3 py-1 rounded-full text-[10.5px] uppercase tracking-[0.12em] font-medium"
           style={{ background: 'rgba(255,90,110,0.12)', color: '#FFE2DE', border: '1px solid rgba(255,90,110,0.3)' }}>
        <span>Next session</span>
      </div>
      <h1 className="text-3xl font-semibold tracking-tight mt-2 mb-1">
        Social{' '}
        <span
          className="font-bold italic"
          style={{
            background: 'linear-gradient(120deg, #FF5A6E 0%, #FF9C5B 50%, #FFC73D 100%)',
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            color: 'transparent'
          }}
        >
          integrations
        </span>
      </h1>
      <p className="text-sm text-muted mb-6 max-w-2xl">
        One place to connect every social account across every brand you operate. Once a connector is
        live, every commercial generated on a lead can publish directly -- no downloads, no copy-paste,
        no leaving the dashboard. Pick a brand, connect once, post forever.
      </p>

      <SocialIntegrationsBoard />
    </div>
  );
}
