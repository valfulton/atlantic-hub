/**
 * /client/audit  — V3 (Velvet Royale chat, 2026-06-03)
 *
 * Full-page view of the client's Strategic Marketing Audit, in the V3 navy
 * register: monogram top bar → Cormorant eyebrow + title → prose in a single
 * v3-card on navy. Server-rendered, print-friendly, no client JS, no
 * PortalHeader, no WaveDivider. Narrow reading column (≈720px).
 */
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { readClientActorFromHeaders } from '@/lib/auth/client-session';
import { findClientUserById } from '@/lib/auth/client-user';
import { getClientOwnAudit } from '@/lib/client/dashboard_data';
import ClientV3TopNav from '@/app/client/_components/ClientV3TopNav';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function ClientAuditPage() {
  const actor = readClientActorFromHeaders(headers() as unknown as Headers);
  if (!actor) redirect('/client/login');

  const user = await findClientUserById(actor.clientUserId);
  if (!user) redirect('/client/login');

  // Shared loader — the client's own audit, matched by email (one source of truth).
  const audit = await getClientOwnAudit(user.email);

  const generated =
    (audit?.audit_generated ?? audit?.created_at)?.toISOString().slice(0, 10) || 'recently';

  return (
    <main className="v3-wrap" style={{ maxWidth: 720 }}>
      <ClientV3TopNav />

      <a href="/client/dashboard" className="v3-link" style={{ display: 'inline-block', margin: '18px 0 0' }}>
        ← Back to dashboard
      </a>

      <section className="v3-greet">
        <p className="v3-eyebrow">Strategic Marketing Audit</p>
        <h1 className="v3-h1">{audit?.company || user.display_name || 'Your business audit'}</h1>
        {audit && (
          <p className="v3-lede" style={{ fontStyle: 'normal', fontSize: 14 }}>
            {audit.industry ? `${audit.industry} · ` : ''}Generated {generated}
          </p>
        )}
      </section>

      {audit ? (
        <article
          className="v3-card"
          style={{ whiteSpace: 'pre-line', lineHeight: 1.7, fontSize: 15, padding: '26px 28px' }}
        >
          {audit.audit_content}
        </article>
      ) : (
        <article className="v3-card">
          <p className="v3-card__p" style={{ marginBottom: 0 }}>
            Your audit hasn&rsquo;t been generated yet. Check back soon, or reply to your intake
            confirmation email if it&rsquo;s been more than 48 hours.
          </p>
        </article>
      )}

      <p className="v3-foot" style={{ textAlign: 'left', marginTop: 24 }}>
        For your eyes only — please don&rsquo;t share publicly.
      </p>
    </main>
  );
}
