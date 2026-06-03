/**
 * ClientDashboardBody — the entire client dashboard body, rendered identically by:
 *   - /client/dashboard            (the client's real hub)
 *   - /admin/av/clients/[id]/preview  (operator's read-only TRUE mirror)
 *
 * Pass 2, completed: one component so the preview shows exactly what the client
 * sees. The pages own auth/access/banner; this owns everything inside <main>.
 *
 * `preview` makes it read-only (client-only actions like Publish render as a
 * label, not a button). `leadsHref` lets the preview point the brief's lead links
 * at the operator client page instead of the live (session-scoped) portal.
 *
 * (#187) Chill pass: empty sections are HIDDEN rather than rendered as
 * "nothing yet" cards. A Day-1 client (like Tim before content drafts land)
 * sees the hero + guidance + brief + their team + a single "your plan"
 * footer — not seven stacked empty placeholders. More breath between
 * sections (space-y-10), audit + content + campaigns only render when there
 * is real content to render.
 */
import { TIER_LABEL } from '@/lib/client-portal/tiers';
import { formatUsd } from '@/lib/sales/deal_model';
import type { ClientDashboardData } from '@/lib/client/dashboard_data';
import ClientHero from '@/app/client/_components/ClientHero';
import GuidanceFeed from '@/app/client/_components/GuidanceFeed';
import ThisWeekFeed from '@/app/client/_components/ThisWeekFeed';
import CreativeBrief from '@/app/client/_components/CreativeBrief';
import Collapsible from '@/app/client/_components/Collapsible';
import PublishToNewsroom from '@/app/client/_components/PublishToNewsroom';

function auditPreview(text: string | null, maxChars = 480): string {
  if (!text) return '';
  const trimmed = text.trim().replace(/\r\n/g, '\n');
  if (trimmed.length <= maxChars) return trimmed;
  return trimmed.slice(0, maxChars).replace(/\s+\S*$/, '') + '...';
}

export default function ClientDashboardBody({
  data,
  email,
  preview = false,
  leadsHref
}: {
  data: ClientDashboardData;
  email: string;
  preview?: boolean;
  leadsHref?: string;
}) {
  const { firstName, tier, audit, leadCount, guidance, campaign, liveCount, inMotion, clientCampaigns, brief, monthlyPipelineCents, team, features, clientId } = data;

  // (#187) Decide what's worth showing. A Day-1 client has no content, no
  // campaigns, no audit — those collapsibles render as empty placeholders that
  // crowd the page without conveying anything. Hide them entirely until they
  // have signal. The hero + guidance + brief carry the page on their own; new
  // sections appear as work lands.
  const hasContent = campaign.length > 0;
  const hasCampaigns = clientCampaigns.length > 0;
  const hasAudit = !!audit;
  const hasTeam = team.length > 0;

  return (
    <main className="w-full max-w-6xl mx-auto px-3 sm:px-4 py-6 sm:py-12 space-y-8 sm:space-y-10">
      <ClientHero firstName={firstName} pipeline={brief.pipeline} monthlyPipelineCents={monthlyPipelineCents}>
        <p className="text-muted text-sm mt-4 max-w-xl leading-relaxed">
          {brief.pipeline.hot > 0
            ? `${brief.pipeline.hot} hot lead${brief.pipeline.hot === 1 ? '' : 's'} ready to move — let's turn momentum into booked business.`
            : liveCount > 0
              ? `${liveCount} piece${liveCount === 1 ? '' : 's'} live${inMotion > 0 ? `, ${inMotion} more in motion` : ''}. Your story is out in the world and building.`
              : inMotion > 0
                ? `${inMotion} piece${inMotion === 1 ? '' : 's'} in motion. Your campaign is taking shape — you'll see it go live here.`
                : 'Your campaign is being set in motion. Everything we create for you will appear here.'}
        </p>
      </ClientHero>

      {/* (#242 / #216 v0) "This week" activity feed — surfaces system events
          the client cares about (new leads, hot fits, press matches, audit
          refresh) since their last visit. Hides itself for Day-1 clients
          with no activity yet, so it appears the first time the system
          does meaningful work. Server component fetches its own data. */}
      <ThisWeekFeed clientId={clientId} firstName={firstName} />

      <GuidanceFeed guidance={guidance} firstName={firstName} />

      <CreativeBrief brief={brief} firstName={firstName} {...(leadsHref ? { leadsHref } : {})} />

      {hasTeam && (
        <Collapsible title="Your sales team" meta={`${team.length} rep${team.length === 1 ? '' : 's'}`} defaultOpen>
          <ul className="grid sm:grid-cols-2 gap-3">
            {team.map((rep) => (
              <li key={rep.clientId} className="rounded-2xl border border-border bg-surface p-5">
                <h3 className="text-ink font-medium leading-snug">{rep.name}</h3>
                <div className="mt-3 flex items-center gap-4 text-sm">
                  <span>
                    <span className="text-ink font-semibold tabular-nums">{rep.liveLeadCount}</span>{' '}
                    <span className="text-muted">live lead{rep.liveLeadCount === 1 ? '' : 's'}</span>
                  </span>
                  {rep.monthlyPipelineCents != null && rep.monthlyPipelineCents > 0 && (
                    <span className="tabular-nums" style={{ color: '#FFC73D' }}>
                      {formatUsd(rep.monthlyPipelineCents)}<span className="text-muted text-xs">/mo</span>
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Collapsible>
      )}

      {/* (#187) Removed the "You're on the X plan + your audit will appear..."
          paragraph here -- the tier already shows in PortalHeader, and the
          audit hint is folded into the "Your plan" section at the bottom. */}

      {hasCampaigns && (
        <Collapsible title="Your campaigns" meta={`${clientCampaigns.length} campaign${clientCampaigns.length === 1 ? '' : 's'}`}>
          <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {clientCampaigns.map((c) => (
              <li key={c.id} className="rounded-2xl border border-border bg-surface p-5">
                <div className="flex items-center gap-2 mb-2">
                  <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: c.laneAccent || '#FF9C5B' }} />
                  {c.laneName && <span className="text-[10px] uppercase tracking-[0.14em] text-muted">{c.laneName}</span>}
                </div>
                <h3 className="text-ink font-medium leading-snug">{c.name}</h3>
                <div className="mt-3 flex items-center gap-3 text-xs text-muted">
                  <span><span className="text-brand font-medium">{c.liveCount}</span> live</span>
                  <span>{c.pieceCount} total</span>
                </div>
              </li>
            ))}
          </ul>
        </Collapsible>
      )}

      {/* (#187) "Your content" only renders when there's actually something
          in motion. The empty-state copy was crowding the page for Day-1
          clients with nothing to show -- the hero already says "Your campaign
          is being set in motion." */}
      {hasContent && (
        <Collapsible title="Your content" meta={liveCount > 0 ? `${liveCount} live` : `${campaign.length} in motion`} defaultOpen>
          <ul className="grid sm:grid-cols-2 gap-3">
            {campaign.map((c) => {
              const tone =
                c.stage === 'live'
                  ? { bg: 'rgba(16,185,129,0.16)', fg: '#6ee7b7' }
                  : c.stage === 'ready'
                    ? { bg: 'rgba(245,158,11,0.16)', fg: '#fcd34d' }
                    : { bg: 'rgba(148,163,184,0.16)', fg: '#cbd5e1' };
              return (
                <li key={c.id} className="rounded-2xl border border-border bg-surface overflow-hidden flex flex-col">
                  {c.heroUrl && (
                    <div className="w-full aspect-video bg-black overflow-hidden">
                      {c.heroType === 'video' ? (
                        <video src={c.heroUrl} muted loop playsInline preload="metadata" className="w-full h-full object-cover" />
                      ) : (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img src={c.heroUrl} alt={c.title} className="w-full h-full object-cover" />
                      )}
                    </div>
                  )}
                  <div className="p-5 flex flex-col flex-1">
                    <div className="flex items-center gap-2 mb-2 text-[10px] uppercase tracking-[0.14em]">
                      <span className="text-muted">{c.typeLabel}</span>
                      <span className="ml-auto inline-flex items-center px-2 py-0.5 rounded-full font-medium" style={{ background: tone.bg, color: tone.fg }}>
                        {c.stageLabel}
                      </span>
                    </div>
                    <h3 className="text-ink font-medium leading-snug">{c.title}</h3>
                    {c.excerpt && <p className="text-sm text-muted mt-2 leading-relaxed flex-1">{c.excerpt}</p>}
                    {c.liveHref && (
                      <a href={c.liveHref} target="_blank" rel="noopener" className="mt-3 text-sm text-brand hover:underline">
                        View it live -&gt;
                      </a>
                    )}
                    {c.stage === 'ready' && !c.liveHref && (
                      preview
                        ? <span className="mt-3 text-xs text-muted">Ready to publish</span>
                        : <PublishToNewsroom artifactId={c.id} />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </Collapsible>
      )}

      {/* (#187) Audit section only renders when there's a real audit. The
          "we're working on it" placeholder was just adding noise for fresh
          clients — they hear the same message in their welcome email. */}
      {hasAudit && audit && (
        <Collapsible title="Strategic Marketing Audit" meta="ready" defaultOpen>
          <div className="flex items-start justify-between gap-4 mb-3">
            <div>
              <div className="text-[10px] uppercase tracking-[0.16em] text-muted">Strategic Marketing Audit</div>
              <h2 id="audit-h" className="text-lg font-semibold text-ink mt-1">
                {audit.company || firstName || 'Your business audit'}
              </h2>
            </div>
            {!preview && (
              <a href="/client/audit" className="shrink-0 text-sm text-brand hover:underline">Read full audit -&gt;</a>
            )}
          </div>

          <div className="text-sm text-ink whitespace-pre-line leading-relaxed">{auditPreview(audit.audit_content)}</div>

          <div className="mt-4 pt-4 border-t border-border text-xs text-muted flex flex-wrap gap-x-4 gap-y-1">
            {audit.industry && (
              <span><span className="text-muted/70">Industry:</span> <span className="text-ink">{audit.industry}</span></span>
            )}
            <span>
              <span className="text-muted/70">Generated:</span>{' '}
              <span className="text-ink">{(audit.audit_generated ?? audit.created_at)?.toISOString().slice(0, 10) || 'Recently'}</span>
            </span>
            <span><span className="text-muted/70">Leads tracked:</span> <span className="text-ink">{leadCount}</span></span>
          </div>
        </Collapsible>
      )}

      {/* (#187) Merged "What's included" + "Unlock more" into a single
          collapsed-by-default "Your plan" section. Two separate sections at
          the bottom of every dashboard was overkill -- val asked for fewer
          competing signals. The hint about a pending audit (when there isn't
          one yet) lives in the meta line so it's subtle, not a whole section. */}
      <Collapsible
        title="Your plan"
        meta={hasAudit ? TIER_LABEL[tier] : `${TIER_LABEL[tier]} · audit pending`}
      >
        <div className="space-y-5">
          <div>
            <div className="text-[10px] uppercase tracking-[0.14em] text-brand/85 mb-2">Included</div>
            <ul className="grid sm:grid-cols-2 gap-2">
              {features.included.map((feature) => (
                <li key={feature} className="flex items-start gap-2 rounded-xl border border-border bg-surface px-4 py-3 text-sm text-ink">
                  <span aria-hidden="true" className="text-brand mt-0.5 shrink-0">&#x2713;</span>
                  <span>{feature}</span>
                </li>
              ))}
            </ul>
          </div>

          {features.locked.length > 0 && (
            <div>
              <div className="flex items-end justify-between gap-4 mb-2">
                <div className="text-[10px] uppercase tracking-[0.14em] text-muted">
                  Unlock more with an upgrade
                </div>
                <a href="https://atlanticandvine.netlify.app/#pricing" target="_blank" rel="noopener" className="text-xs text-brand hover:underline">
                  See all tiers -&gt;
                </a>
              </div>
              <ul className="grid sm:grid-cols-2 gap-2">
                {features.locked.map((feature) => (
                  <li key={feature.name} className="relative flex items-start gap-2 rounded-xl border border-dashed border-border bg-surface/60 px-4 py-3 text-sm">
                    <span aria-hidden="true" className="text-muted mt-0.5 shrink-0">&#x1F512;</span>
                    <div className="flex-1">
                      <div className="text-muted">{feature.name}</div>
                      <div className="text-[10px] uppercase tracking-[0.14em] text-brand mt-1">Available in {feature.tier}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Collapsible>

      <footer className="border-t border-border pt-5 text-xs text-muted text-center">
        &copy; {new Date().getFullYear()} Atlantic And Vine LLC. Signed in as <span className="text-ink">{email}</span>.
      </footer>
    </main>
  );
}
