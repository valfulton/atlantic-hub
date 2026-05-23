import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { CampaignsBoard } from './CampaignsBoard';

export const dynamic = 'force-dynamic';

/**
 * /admin/av/campaigns -- the orchestration spine.
 *
 * Narrative lanes (editable editorial pillars) and the campaigns that live in
 * each. A campaign groups blog/social/commercial output so one intelligence
 * signal becomes coordinated movement. Owner + staff only.
 */
export default function CampaignsPage() {
  const role = headers().get('x-ah-user-role') as 'owner' | 'staff' | 'client_user' | null;
  if (role === 'client_user') redirect('/admin');

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
          Lanes
        </span>
      </h1>
      <p className="text-sm text-muted mb-6 max-w-2xl">
        Your editorial pillars. Each lane holds campaigns; each campaign groups the blog posts, social
        posts, and commercials produced around one intelligence signal — so one idea becomes coordinated
        movement. Add, rename, or retire lanes anytime; they&apos;re yours to shape.
      </p>
      <CampaignsBoard />
    </div>
  );
}
