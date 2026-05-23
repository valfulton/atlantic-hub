import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { ArtifactsSection } from '@/app/admin/pr/ArtifactsSection';

export const dynamic = 'force-dynamic';

/**
 * /admin/av/content -- the Content & Blog desk.
 *
 * A dedicated home for owned content (blog posts, SEO articles, own-brand social,
 * client deliverables): draft -> approve -> brand -> publish to the newsroom or a
 * connected site. Same surface as the "Owned content" block on the PR engine,
 * given its own landing page so it's actually findable.
 *
 * Owner + staff only.
 */
export default function ContentPage() {
  const role = headers().get('x-ah-user-role') as 'owner' | 'staff' | 'client_user' | null;
  if (role === 'client_user') redirect('/admin');

  return (
    <div className="max-w-5xl">
      <h1 className="text-3xl font-semibold tracking-tight mb-1">
        Content &amp;{' '}
        <span
          className="font-bold italic"
          style={{
            background: 'linear-gradient(120deg, #FF5A6E 0%, #FF9C5B 50%, #FFC73D 100%)',
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            color: 'transparent'
          }}
        >
          Blog
        </span>
      </h1>
      <p className="text-sm text-muted mb-6 max-w-2xl">
        Draft blog posts, SEO articles, and own-brand content, then approve and publish them to your
        public newsroom or straight onto a connected site (atlanticandvine.netlify.app). Everything is
        grounded in the intelligence the platform has accumulated.
      </p>
      <ArtifactsSection />
    </div>
  );
}
