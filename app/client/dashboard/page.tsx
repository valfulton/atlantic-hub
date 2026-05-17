/**
 * /client/dashboard
 *
 * Server component. Middleware has already verified the ah_client_session
 * cookie and attached x-ah-client-user-id + x-ah-client-session-id
 * headers, so the only failure path here is "user row missing" (deleted
 * mid-session) which we treat as logout.
 *
 * Pulls:
 *   - client_users row (the logged-in user, including their tier)
 *   - their most recent leads.audit_content (joined on email, with
 *     client_id preferred when present)
 *   - count of leads visible to them
 */
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { readClientActorFromHeaders } from '@/lib/auth/client-session';
import { findClientUserById } from '@/lib/auth/client-user';
import { getAvDb } from '@/lib/db/av';
import { TIER_FEATURES, TIER_LABEL } from '@/lib/client-portal/tiers';
import PortalHeader from '@/app/client/_components/PortalHeader';
import type { RowDataPacket } from 'mysql2';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface AuditRow extends RowDataPacket {
  audit_id: string | null;
  company: string | null;
  industry: string | null;
  audit_content: string | null;
  audit_generated: Date | null;
  created_at: Date | null;
}

interface CountRow extends RowDataPacket {
  c: number;
}

function auditPreview(text: string | null, maxChars = 480): string {
  if (!text) return '';
  const trimmed = text.trim().replace(/\r\n/g, '\n');
  if (trimmed.length <= maxChars) return trimmed;
  return trimmed.slice(0, maxChars).replace(/\s+\S*$/, '') + '...';
}

export default async function ClientDashboardPage() {
  const actor = readClientActorFromHeaders(headers() as unknown as Headers);
  if (!actor) redirect('/client/login');

  const user = await findClientUserById(actor.clientUserId);
  if (!user) redirect('/client/login');

  const db = getAvDb();
  const [auditRows] = await db.execute<AuditRow[]>(
    `SELECT audit_id, company, industry, audit_content, audit_generated, created_at
       FROM leads
      WHERE archived_at IS NULL
        AND audit_content IS NOT NULL
        AND (
          (? IS NOT NULL AND client_id = ?)
          OR email = ?
        )
      ORDER BY (client_id = ?) DESC,
               COALESCE(audit_generated, created_at) DESC
      LIMIT 1`,
    [user.client_id, user.client_id, user.email, user.client_id]
  );
  const audit = auditRows[0] ?? null;

  const [countRows] = await db.execute<CountRow[]>(
    `SELECT COUNT(*) AS c FROM leads
      WHERE archived_at IS NULL
        AND (
          (? IS NOT NULL AND client_id = ?)
          OR email = ?
        )`,
    [user.client_id, user.client_id, user.email]
  );
  const leadCount = Number(countRows[0]?.c ?? 0);

  const features = TIER_FEATURES[user.tier];
  const headline = user.display_name?.split(/[ ,]/)[0] || 'there';

  return (
    <>
      <PortalHeader
        displayName={user.display_name}
        email={user.email}
        tier={user.tier}
        active="dashboard"
      />

      <main className="max-w-6xl mx-auto px-4 py-8 sm:py-10">
        <section className="mb-8 sm:mb-10">
          <h1 className="text-2xl sm:text-3xl font-semibold text-ink">
            Welcome back, {headline}.
          </h1>
          <p className="text-muted mt-1 text-sm">
            You&apos;re on the{' '}
            <span className="text-ink font-medium">{TIER_LABEL[user.tier]}</span>{' '}
            plan. {audit
              ? 'Your Strategic Marketing Audit is below.'
              : 'Your audit will appear here once it has been generated.'}
          </p>
        </section>

        <section
          aria-labelledby="audit-h"
          className="mb-8 rounded-2xl border border-border bg-surface p-6"
        >
          <div className="flex items-start justify-between gap-4 mb-3">
            <div>
              <div className="text-[10px] uppercase tracking-[0.16em] text-muted">
                Strategic Marketing Audit
              </div>
              <h2 id="audit-h" className="text-lg font-semibold text-ink mt-1">
                {audit?.company || user.display_name || 'Your business audit'}
              </h2>
            </div>
            {audit && (
              <a
                href="/client/audit"
                className="shrink-0 text-sm text-brand hover:underline"
              >
                Read full audit -&gt;
              </a>
            )}
          </div>

          {audit ? (
            <div className="text-sm text-ink whitespace-pre-line leading-relaxed">
              {auditPreview(audit.audit_content)}
            </div>
          ) : (
            <div className="text-sm text-muted">
              We&apos;re working on your audit. It will appear here automatically
              once our team finishes it. If it&apos;s been more than 48 hours,
              reply to your intake confirmation email and we&apos;ll check on it.
            </div>
          )}

          {audit && (
            <div className="mt-4 pt-4 border-t border-border text-xs text-muted flex flex-wrap gap-x-4 gap-y-1">
              {audit.industry && (
                <span>
                  <span className="text-muted/70">Industry:</span>{' '}
                  <span className="text-ink">{audit.industry}</span>
                </span>
              )}
              <span>
                <span className="text-muted/70">Generated:</span>{' '}
                <span className="text-ink">
                  {(audit.audit_generated ?? audit.created_at)
                    ?.toISOString()
                    .slice(0, 10) || 'Recently'}
                </span>
              </span>
              <span>
                <span className="text-muted/70">Leads tracked:</span>{' '}
                <span className="text-ink">{leadCount}</span>
              </span>
            </div>
          )}
        </section>

        <section aria-labelledby="features-h" className="mb-8">
          <h2 id="features-h" className="text-lg font-semibold text-ink mb-3">
            What&apos;s included in your plan
          </h2>
          <ul className="grid sm:grid-cols-2 gap-2">
            {features.included.map((feature) => (
              <li
                key={feature}
                className="flex items-start gap-2 rounded-xl border border-border bg-surface px-4 py-3 text-sm text-ink"
              >
                <span aria-hidden="true" className="text-brand mt-0.5 shrink-0">
                  &#x2713;
                </span>
                <span>{feature}</span>
              </li>
            ))}
          </ul>
        </section>

        {features.locked.length > 0 && (
          <section aria-labelledby="locked-h" className="mb-12">
            <div className="flex items-end justify-between gap-4 mb-3">
              <h2 id="locked-h" className="text-lg font-semibold text-ink">
                Unlock more with an upgrade
              </h2>
              <a
                href="https://atlanticandvine.netlify.app/#pricing"
                target="_blank"
                rel="noopener"
                className="text-sm text-brand hover:underline"
              >
                See all tiers -&gt;
              </a>
            </div>
            <ul className="grid sm:grid-cols-2 gap-2">
              {features.locked.map((feature) => (
                <li
                  key={feature.name}
                  className="relative flex items-start gap-2 rounded-xl border border-dashed border-border bg-surface/60 px-4 py-3 text-sm"
                >
                  <span aria-hidden="true" className="text-muted mt-0.5 shrink-0">
                    &#x1F512;
                  </span>
                  <div className="flex-1">
                    <div className="text-muted">{feature.name}</div>
                    <div className="text-[10px] uppercase tracking-[0.14em] text-brand mt-1">
                      Available in {feature.tier}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            <div className="mt-5 rounded-2xl border border-border bg-surface p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="text-sm text-muted">
                Want to talk through which tier fits your business?
              </div>
              <a
                href="https://atlanticandvine.netlify.app/#client-intake"
                target="_blank"
                rel="noopener"
                className="inline-flex items-center justify-center px-4 py-2 rounded-md bg-brand text-brand-fg text-sm font-medium hover:opacity-90"
              >
                Talk to us
              </a>
            </div>
          </section>
        )}

        <footer className="border-t border-border pt-5 text-xs text-muted text-center">
          &copy; {new Date().getFullYear()} Atlantic And Vine LLC. Signed in as{' '}
          <span className="text-ink">{user.email}</span>.
        </footer>
      </main>
    </>
  );
}
