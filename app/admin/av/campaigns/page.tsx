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
        Campaigns
      </h1>
      <p className="text-sm text-muted mb-6 max-w-2xl">
        The execution layer beneath your <strong>Narrative Lines</strong>. A campaign is a time-boxed push
        that rides a line and groups the blog posts, social posts, and commercials produced around it — so
        one thesis becomes coordinated movement. Manage the strategy itself over in Narrative Lines.
      </p>
      <CampaignsBoard />
    </div>
  );
}
