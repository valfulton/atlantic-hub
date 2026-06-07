import { headers } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { getClientAccountDetail, listClientAccounts } from '@/lib/av/clients_overview';
import { getClientAccessState } from '@/lib/av/client_access';
import { getAvDb } from '@/lib/db/av';
import AccessControls from './AccessControls';
import AccountInfoEditor from './AccountInfoEditor';
import AccountTeamPanel from './AccountTeamPanel';
import { listAccountEmployees, listAssignableEmployees } from '@/lib/av/account_employees';
import ExtractIntelButton from './ExtractIntelButton';
import MagicLinkButton from './MagicLinkButton';
import PortalAccessToggle from './PortalAccessToggle';
import PrefilledIntakeLink from './PrefilledIntakeLink';
import FindLeadsForClient from './FindLeadsForClient';
import IcpEditor from './IcpEditor';
import QuickActionsRibbon from '@/app/admin/_components/QuickActionsRibbon';
import MobileAccordion from '@/app/admin/_components/MobileAccordion';
import SharpenIcpPanel from './SharpenIcpPanel';
import EnrichClientLeadsButton from './EnrichClientLeadsButton';
import RefreshIntelPanel from './RefreshIntelPanel';
import { ClientPrPanel } from './ClientPrPanel';
import PrInboxPanel from './PrInboxPanel';
import PrVoicePicker from './PrVoicePicker';
import FillIntakeFromWebPanel from './FillIntakeFromWebPanel';
import BrandKitPanel from './BrandKitPanel';
import SocialChannelsPanel from './SocialChannelsPanel';
import OwnerIntakeLink from './OwnerIntakeLink';
import SendPasswordButton from './SendPasswordButton';
import ClientAccessGroup from './ClientAccessGroup';
import AttachLoginPanel from './AttachLoginPanel';
import PublicIntelPanel from './PublicIntelPanel';
import DistressWatchlistPanel from './DistressWatchlistPanel';
import CascadePanel from './CascadePanel';
import VerticalPackPanel from './VerticalPackPanel';
import IntelligenceFeedPanel from './IntelligenceFeedPanel';
import IcpFitScorePanel from './IcpFitScorePanel';
import AutopilotActivity from './AutopilotActivity';
import WeeklyDigestPanel from './WeeklyDigestPanel';
import ClientInfluenceCard from '@/app/_components/ClientInfluenceCard';
import { getIntelConfig } from '@/lib/client/brief_store';
import { getInboxRecord } from '@/lib/clients/pr_inbox';
import PrSourcesPanel from './PrSourcesPanel';
import { listSourcesForClient } from '@/lib/pr/client_sources';
import { getBriefPayload } from '@/lib/client/brief_store';
import { getClientIcpWithProvenance } from '@/lib/client/icp';
import { signIntakeShareToken, signOwnerIntakeShareToken } from '@/lib/auth/intake-share';
import { listBrandsForUser } from '@/lib/client/membership';
import ClientPipelineList from './ClientPipelineList';
import AssignLeadsPanel from './AssignLeadsPanel';
import ReleaseLeadsPanel from './ReleaseLeadsPanel';
import AddBrandPanel from './AddBrandPanel';
import StageStrip from './StageStrip';
import ActionStatusChip from './ActionStatusChip';
import PrepAllButton from './PrepAllButton';
import PrepPreflightButton from './PrepPreflightButton';
import NextActionHint from './NextActionHint';
import { loadOnboardingStatus } from '@/lib/av/onboarding_status';
import type { ClientTier } from '@/lib/client-portal/tiers';
import type { RowDataPacket } from 'mysql2';

interface UnassignedRow extends RowDataPacket {
  audit_id: string;
  company: string;
  industry: string | null;
  email: string | null;
  ai_score: number | string | null;
  ai_score_band: string | null;
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * /admin/av/clients/[client_id] -- operator-only client account detail.
 *
 * Shows the client's account, pipeline, ICP, and discovery activity/errors.
 * This is where the operator sees what the client never does: raw errors and
 * the machinery behind their hub.
 */
export default async function ClientDetailPage({ params }: { params: { client_id: string } }) {
  const role = headers().get('x-ah-user-role') as 'owner' | 'staff' | 'client_user' | null;
  if (role === 'client_user') redirect('/admin');

  const clientId = Number.parseInt(params.client_id, 10);
  if (!Number.isFinite(clientId) || clientId <= 0) notFound();

  const d = await getClientAccountDetail(clientId);
  if (!d) notFound();
  // (#306) Other-clients list for the bulk-move-to destination picker.
  // Excludes the current client in the JSX. Best-effort: empty list is fine.
  const clientAccounts = await listClientAccounts().catch(() => []);

  const access = await getClientAccessState(clientId);
  // (#377) Pre-load the account team so the panel renders immediately on first
  // paint. Both reads degrade to [] on error.
  const [teamAssigned, teamAssignable] = await Promise.all([
    listAccountEmployees(clientId),
    listAssignableEmployees(clientId)
  ]);
  const { icp, provenance: icpProvenance } = await getClientIcpWithProvenance(clientId);
  const currentTier = (d.members[0]?.tier as ClientTier) || 'sprint';

  // Intake-gate state for the toggle: the operator override (portal_full_access)
  // AND whether the client completed their own intake (client_completed_at). EITHER
  // unlocks the hub, so the badge must reflect both — not just the override.
  let portalFullAccess = false;
  let intakeCompleted = false;
  try {
    const bp = (await getBriefPayload('av', clientId)) as Record<string, unknown> | null;
    portalFullAccess = bp?.portal_full_access === true;
    const stamp = bp?.client_completed_at;
    intakeCompleted = typeof stamp === 'string' && stamp.trim().length > 0;
  } catch { /* default: intake required */ }

  // (#237) Prefilled-intake share link -> the HUB's intake-form/[token] route,
  // not the marketing site. Both surfaces accept the same JWT and write to the
  // same backend, but the hub render is the upgraded one (Your-turn pills, etc.)
  // and is the single source of truth going forward. Older marketing-site links
  // (atlanticandvine.netlify.app/client-intake?t=...) still work for clients who
  // already received one -- this only changes what NEW shares point to.
  const _hubBase = process.env.URL || 'https://atlantic-hub.netlify.app';
  const intakeShareUrl = `${_hubBase}/client/intake-form/${await signIntakeShareToken(clientId)}`;

  // (#347 + #355) Stage strip + per-action statuses — "lights turning on" view.
  // Single batched read; tolerant of missing tables (returns notStarted).
  const onboarding = await loadOnboardingStatus(clientId);

  // (#45 Phase B) If the primary client_user attached to this brand also owns
  // OTHER brands, surface the all-brands intake link so val can send ONE URL
  // covering CBB + CLDA (or however many). When the owner has only this one
  // brand, we don't render the all-brands link (would be redundant).
  let ownerIntakeShareUrl: string | null = null;
  let ownerBrandCount = 0;
  const ownerIntakeName: string = d.members[0]?.displayName || d.name;
  // (#368) Track whether ANY login resolves for this brand (direct or via
  // brand_members). When false, the AttachLoginPanel shows so val isn't stuck
  // on the "no user on this account" error with no obvious next step.
  let hasAnyLogin = false;
  try {
    const _db = getAvDb();
    const [_rows] = await _db.execute<(RowDataPacket & { client_user_id: number })[]>(
      `SELECT client_user_id FROM client_users
        WHERE client_id = ? ORDER BY client_user_id ASC LIMIT 1`,
      [clientId]
    );
    const _ownerUserId = _rows[0]?.client_user_id;
    if (_ownerUserId) {
      hasAnyLogin = true;
      const _memberships = await listBrandsForUser(_ownerUserId);
      if (_memberships.length >= 2) {
        ownerBrandCount = _memberships.length;
        ownerIntakeShareUrl = `${_hubBase}/client/intake-form/${await signOwnerIntakeShareToken(_ownerUserId)}`;
      }
    } else {
      // No direct client_user — does brand_members point a login at this brand?
      const [_memberRows] = await _db.execute<(RowDataPacket & { client_user_id: number })[]>(
        `SELECT client_user_id FROM brand_members WHERE client_id = ? LIMIT 1`,
        [clientId]
      );
      if (_memberRows[0]?.client_user_id) hasAnyLogin = true;
    }
  } catch { /* non-fatal — single-brand link is still available */ }

  // (#368) Suggested email for the AttachLoginPanel — prefer the brand contact
  // on the brief, else the brand's first member email. val edits before submit.
  let suggestedLoginEmail: string | null = null;
  try {
    const bp = (await getBriefPayload('av', clientId)) as Record<string, unknown> | null;
    const candidates = [bp?.primary_contact_email, bp?.contact_email, bp?.email];
    for (const c of candidates) {
      if (typeof c === 'string' && c.trim() && c.includes('@')) {
        suggestedLoginEmail = c.trim();
        break;
      }
    }
    if (!suggestedLoginEmail && d.members[0]?.email) suggestedLoginEmail = d.members[0].email;
  } catch { /* non-fatal */ }

  // (#88) Per-client PR drafter voice + posture, read from the brief payload.
  // Both null when val hasn't picked any yet.
  const intelCfg = await getIntelConfig('av', clientId);

  // (#235) Default URL for the "Fill intake from web" panel: prefer the
  // client's saved website_url, else fall back to nothing (operator types).
  let defaultIntakeUrl: string | null = null;
  try {
    const bp2 = (await getBriefPayload('av', clientId)) as Record<string, unknown> | null;
    const w = bp2?.website_url;
    if (typeof w === 'string' && w.trim()) defaultIntakeUrl = w.trim();
  } catch { /* non-fatal */ }

  // (#216 v2) When was the last successful digest sent to this client?
  // Surfaces in WeeklyDigestPanel as "Last sent X ago" so val knows whether
  // the Friday cron already covered them.
  let lastDigestSentAt: string | null = null;
  try {
    const db = getAvDb();
    const [rows] = await db.execute<(RowDataPacket & { created_at: string | Date })[]>(
      `SELECT created_at FROM system_events
        WHERE event_type = 'client.digest.sent'
          AND organization_id = ?
        ORDER BY created_at DESC LIMIT 1`,
      [clientId]
    );
    const ts = rows[0]?.created_at;
    if (ts) lastDigestSentAt = new Date(ts).toISOString();
  } catch { /* non-fatal */ }

  // (#90) Stale-audit count: how many of this client's leads were audited
  // BEFORE the latest brief edit. Surfaces above the RefreshIntelPanel so val
  // sees the audit-refresh need at a glance instead of having to scan the
  // pipeline for amber pills.
  let staleAuditCount = 0;
  try {
    const db = getAvDb();
    const [rows] = await db.execute<(RowDataPacket & { stale_count: number })[]>(
      `SELECT COUNT(*) AS stale_count
         FROM leads l
         JOIN creative_briefs cb
           ON cb.client_id = l.client_id AND cb.tenant_id = 'av'
        WHERE l.client_id = ?
          AND l.archived_at IS NULL
          AND (l.audit_generated IS NULL OR l.audit_generated < cb.updated_at)`,
      [clientId]
    );
    staleAuditCount = Number(rows[0]?.stale_count ?? 0);
  } catch { /* non-fatal */ }

  // Unassigned leads available to hand to this client (bulk handoff #79).
  let unassigned: { auditId: string; company: string; industry: string | null; email: string | null; score: number | null; band: string | null }[] = [];
  try {
    const db = getAvDb();
    const [rows] = await db.execute<UnassignedRow[]>(
      `SELECT audit_id, company, industry, email, ai_score, ai_score_band
         FROM leads
        WHERE client_id IS NULL AND archived_at IS NULL
        ORDER BY (ai_score IS NULL), ai_score DESC, id DESC
        LIMIT 60`
    );
    unassigned = rows.map((r) => ({
      auditId: r.audit_id,
      company: r.company,
      industry: r.industry,
      email: r.email,
      score: r.ai_score == null ? null : Number(r.ai_score),
      band: r.ai_score_band
    }));
  } catch {
    /* non-fatal: panel shows an empty state */
  }

  const icpBits = [
    d.icp.industries.length ? `Industries: ${d.icp.industries.join(', ')}` : null,
    d.icp.geographies.length ? `Locations: ${d.icp.geographies.join(', ')}` : null,
    d.icp.companySizeMin || d.icp.companySizeMax
      ? `Size: ${d.icp.companySizeMin ?? 1}–${d.icp.companySizeMax ?? '∞'}`
      : null
  ].filter(Boolean);

  return (
    <div className="max-w-5xl">
      <div className="text-sm text-muted mb-4">
        <Link href="/admin/av/clients" className="hover:text-ink transition-colors">Clients</Link>
        <span className="mx-1.5">/</span>
        <span className="text-ink">{d.name}</span>
      </div>

      {/* (val 2026-06-07, #494) Mobile-only quick-actions ribbon. On phones
          val can tap any of these to scroll to + auto-expand the target
          panel — no more 2,000px scroll to reach the thing she wants.
          Hidden on desktop (all panels visible there anyway). */}
      <QuickActionsRibbon
        actions={[
          { label: 'Send access', icon: '🔑', targetId: 'access-group', primary: true },
          { label: 'Edit ICP', icon: '✎', targetId: 'icp' },
          { label: 'Pipeline', icon: '◉', targetId: 'their-pipeline' }
        ]}
      />

      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold">{d.name}</h1>
          <p className="text-sm text-muted mt-1 capitalize">
            {d.planTier} plan{d.industry ? ` · ${d.industry}` : ''}
            {!d.enabled && <span style={{ color: '#fca5a5' }}> · disabled</span>}
          </p>
        </div>
      </div>

      {/* Quick links into this client's brief + dashboard preview. */}
      <div className="flex flex-wrap gap-4 mb-5 text-sm">
        <Link href={`/admin/av/intake?clientId=${clientId}`} className="text-brand hover:underline">Edit full intake →</Link>
        <Link href={`/admin/av/brief?clientId=${clientId}`} className="text-brand hover:underline">Edit creative brief →</Link>
        <Link href={`/admin/av/clients/${clientId}/preview`} className="text-brand hover:underline">Preview their dashboard →</Link>
        <Link href={`/admin/av/clients/${clientId}/intelligence`} className="text-brand hover:underline">Intelligence inventory →</Link>
        <Link href={`/admin/av/clients/${clientId}/timeline`} className="text-brand hover:underline">Activity timeline →</Link>
      </div>

      {/* (val 2026-06-02) Next-action hint — reads the strip, surfaces the
          first un-done stage as a "→ Next:" CTA with a jump-to-panel button.
          Cuts decision fatigue when opening a half-prepped client. */}
      <NextActionHint status={onboarding} />

      {/* (#347) "Lights turning on" — 13-stage onboarding strip. Computed
          server-side from real data: brief fields, intelligence_objects, ICP,
          brand kit, socials, leads, audits, content, outreach. Chips link to
          panel anchors below so val can jump to whatever's still dim. */}
      <StageStrip status={onboarding} />

      {/* Cross-client watchlist deep-link (#411) — during onboarding val needs
          to verify this client's distress signals are firing across all
          adapters. The unified watchlist is the operator's single board. */}
      <div className="-mt-3 mb-5 flex flex-wrap items-center gap-3 text-[12px]">
        <Link
          href={`/admin/av/watchlist?client=${clientId}`}
          className="inline-flex items-center gap-1.5 rounded-md border border-[color-mix(in_srgb,var(--gold-bright)_35%,transparent)] text-[var(--gold-bright)] hover:bg-[color-mix(in_srgb,var(--gold-bright)_10%,transparent)] px-3 py-1.5 transition-colors"
        >
          🔭 Open this client&apos;s watchlist on the unified board →
        </Link>
        <Link
          href="/admin/av/watchlist"
          className="text-muted hover:text-ink"
        >
          See all clients&apos; watchlists
        </Link>
      </div>

      {/* (#358) Free pre-flight — runs no LLM. Surfaces website reachability +
          brief-fillness + per-step readiness so val sees what Prep will and
          won't do BEFORE spending tokens. */}
      <PrepPreflightButton clientId={clientId} />

      {/* (#353) Quick prep — fills the brand kit / intake / ICP / intel /
          socials all at once for new clients (or top-ups for clients with
          gaps). Blanks-only, so anything val typed stays. The briefFilledCount
          drives a sparse-brief warning in the confirm dialog so val doesn't
          burn LLM cycles on near-empty briefs. Prep also runs the pre-flight
          internally and pre-skips (never fires the LLM on) doomed steps. */}
      <PrepAllButton
        clientId={clientId}
        clientName={d.name}
        briefFilledCount={onboarding.stages.find((s) => s.key === 'intake_filled')?.detail?.split(' ')[0] ?? '0'}
      />

      {/* (val 2026-06-02) All four access surfaces now live in ONE collapsible
          group with portal-vs-form sub-sections so val can see at a glance
          what each link does. Replaces the earlier #297 amber explainer card
          which sat above two scattered controls; that copy is now the group's
          sub-section headers. */}
      {/* (val 2026-06-07) Wrapped in MobileAccordion: collapses to a 56px header
          on phones, untouched on desktop. The quick-actions ribbon's "Send
          access" scrolls here + auto-expands it (id must match the ribbon's
          targetId). Pattern to replicate across the rest of the cockpit panels. */}
      <MobileAccordion id="access-group" icon="🔑" title="Send access" status="Magic link · password · prefilled intake">
      {/* (#368) When NO login resolves for this brand (no direct client_user
          and no brand_members row), show the attach panel BEFORE the access
          group — it's the only thing that'll make any of those buttons work. */}
      {!hasAnyLogin && (
        <div className="mb-4">
          <AttachLoginPanel
            clientId={clientId}
            clientName={d.name}
            suggestedEmail={suggestedLoginEmail}
          />
        </div>
      )}
      <ClientAccessGroup
        portal={
          <>
            <MagicLinkButton clientId={clientId} clientName={d.name} />
            <SendPasswordButton clientId={clientId} />
          </>
        }
        share={
          <>
            <PrefilledIntakeLink url={intakeShareUrl} />
            {ownerIntakeShareUrl && ownerBrandCount >= 2 && (
              <OwnerIntakeLink url={ownerIntakeShareUrl} ownerName={ownerIntakeName} brandCount={ownerBrandCount} />
            )}
          </>
        }
      />
      </MobileAccordion>

      {/* (#235) Fill intake from public web — paste their site, get suggested
          intake fields drafted from the page. Eliminates the SQL-paste
          onboarding path. Preview-first; reversible via brief versions. */}
      <div id="fill-intake" className="mb-5">
        <div className="flex justify-end mb-1.5 -mr-1">
          <ActionStatusChip status={onboarding.actions.intakeWebFill} notRunLabel="Not filled" />
        </div>
        <FillIntakeFromWebPanel
          clientId={clientId}
          clientName={d.name}
          defaultUrl={defaultIntakeUrl}
        />
      </div>

      {/* (#208) Brand-kit extractor — same URL, pulls VISUAL kit (colors /
          logo / aesthetic / typography). Pair with FillIntake for a full
          onboard from one paste. Powers branded commercials + social cards. */}
      <div id="brand-kit" className="mb-5">
        <div className="flex justify-end mb-1.5 -mr-1">
          <ActionStatusChip status={onboarding.actions.brandKit} notRunLabel="Not extracted" />
        </div>
        <BrandKitPanel
          clientId={clientId}
          clientName={d.name}
          defaultUrl={defaultIntakeUrl}
        />
      </div>

      {/* MagicLinkButton + SendPasswordButton now live inside ClientAccessGroup
          near the top of the page. Removed here to avoid double-render. */}

      {/* (#369) Public Intelligence Layer — free public data adapters per
          client. HMDA (Marty) + CA SOS (Adriana) live; CFPB/ACS/recorders
          stubbed as "Coming soon." Collapsed by default — no fetch until
          val opens it. */}
      {/* (#376) Vertical Packs — same engine, different pack per vertical.
          Sits ABOVE Public Intelligence because the pack tells val which
          adapters to enable. Applying a pack seeds weights + names the
          recommended adapters + cascade recipes for that vertical. */}
      <div id="vertical-pack" className="mb-5">
        <VerticalPackPanel clientId={clientId} clientName={d.name} />
      </div>

      <div id="public-intel" className="mb-5">
        <PublicIntelPanel clientId={clientId} clientName={d.name} />
      </div>

      {/* (#372) Revenue Distress Intelligence Engine — top-N entities by
          weighted distress score, scored from public_intel_records. The
          framing flip: this isn't a lead list, it's "who's about to need
          your service this week." Sits below Public intel because the
          engine reads what those adapters write. */}
      <div id="distress-watchlist" className="mb-5">
        {/* (#386) moveTargets — every OTHER client in the operator's tenant. Val
            can move a watchlist entity from this brand to any other brand. For
            client_user owners (Adriana) the picker is rendered separately by
            the client surface and is scoped to brands they own. */}
        <DistressWatchlistPanel
          clientId={clientId}
          clientName={d.name}
          moveTargets={clientAccounts
            .filter((c) => c.clientId !== clientId)
            .map((c) => ({ clientId: c.clientId, clientName: c.name }))}
        />
      </div>

      {/* (#374) Cascade Pipeline — chain reactions that fire automatically when
          a triggering record lands. Sits between Public Intel (raw record
          producer) and Distress watchlist (scoring consumer). */}
      <div id="cascade-pipeline" className="mb-5">
        <CascadePanel clientId={clientId} clientName={d.name} />
      </div>

      {/* (#380) Intelligence Feed — unified chronological view of every record
          from every adapter + every cascade emission + every worker run.
          The "information everywhere" surface so nothing rots invisible. */}
      <div id="intelligence-feed" className="mb-5">
        <IntelligenceFeedPanel clientId={clientId} clientName={d.name} />
      </div>

      {/* Intake -> canonical intelligence (one visible-prompt pass). */}
      <div id="extract-intel" className="mb-5">
        <div className="flex justify-end mb-1.5 -mr-1">
          <ActionStatusChip status={onboarding.actions.intelligence} notRunLabel="Not extracted" />
        </div>
        <ExtractIntelButton clientId={clientId} />
      </div>

      {/* (#45) Social channels — paste profile URLs val has on file; client
          confirms in their intake. Drives the per-brand post-target rails.
          defaultWebsiteUrl seeds the "Pull from their website" scrape so val
          doesn't have to retype it. */}
      <div id="social-channels">
        <SocialChannelsPanel clientId={clientId} defaultWebsiteUrl={defaultIntakeUrl} />
      </div>

      {/* Multi-brand (#101): give this same login another brand (e.g. Adriana's CBB + CLDA). */}
      <AddBrandPanel clientId={clientId} ownerName={d.members[0]?.displayName || d.name} />

      {/* Account info editor (name / industry / contact) — no SQL needed. */}
      <AccountInfoEditor
        clientId={clientId}
        initialClientName={d.name}
        initialShortName={d.shortName ?? ''}
        initialIndustry={d.industry ?? ''}
        contactEmail={d.members[0]?.email ?? null}
        initialContactName={d.members[0]?.displayName ?? ''}
      />

      {/* Intake gate override: grant full portal access, or require intake first. */}
      <PortalAccessToggle clientId={clientId} initialFullAccess={portalFullAccess} intakeCompleted={intakeCompleted} />

      {/* Access & tier controls */}
      <AccessControls clientId={clientId} initialState={access} currentTier={currentTier} />

      {/* (#377) Account team — assign AV employees to this client. The client
          dashboard surfaces whoever's assigned here in the "Your A&V team" widget. */}
      <AccountTeamPanel
        clientId={clientId}
        clientName={d.name}
        initialAssigned={teamAssigned}
        initialAssignable={teamAssignable}
      />

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
        {[
          { label: 'Leads in pipeline', value: d.leadCount },
          { label: 'Found this month', value: d.discoveredThisMonth },
          { label: 'Discovery errors logged', value: d.recentErrors.filter((e) => e.status === 'failure').length }
        ].map((s) => (
          <div key={s.label} className="rounded-2xl border border-border bg-surface p-4">
            <div className="text-2xl font-semibold text-ink tabular-nums">{s.value}</div>
            <div className="text-[11px] uppercase tracking-[0.12em] text-muted mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Account holders + ICP */}
      <div className="grid sm:grid-cols-2 gap-3 mb-6">
        <div className="rounded-2xl border border-border bg-surface p-4">
          <div className="text-[11px] uppercase tracking-[0.12em] text-muted mb-2">Account</div>
          {d.members.length === 0 ? (
            <p className="text-sm text-muted">No users on this account.</p>
          ) : (
            <ul className="space-y-1.5">
              {d.members.map((m) => (
                <li key={m.email} className="text-sm">
                  <span className="text-ink">{m.displayName || m.email}</span>
                  <span className="text-muted text-xs"> · {m.tier}{m.lastLoginAt ? ` · last in ${m.lastLoginAt.slice(0, 10)}` : ''}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-2xl border border-border bg-surface p-4">
          <div className="text-[11px] uppercase tracking-[0.12em] text-muted mb-2">Their ICP</div>
          {icpBits.length === 0 ? (
            <p className="text-sm text-muted">No ideal-client profile set yet.</p>
          ) : (
            <ul className="text-sm text-ink space-y-1">
              {icpBits.map((b) => <li key={b}>{b}</li>)}
            </ul>
          )}
          {d.icp.description && <p className="text-xs text-muted mt-2 leading-relaxed">{d.icp.description}</p>}
        </div>
      </div>

      {/* Discovery activity / errors */}
      <div className="rounded-2xl border border-border bg-surface p-4 mb-6">
        <div className="text-[11px] uppercase tracking-[0.12em] text-muted mb-3">Discovery activity (operator-only)</div>
        {d.recentErrors.length === 0 ? (
          <p className="text-sm text-muted">No discovery errors logged. All clean.</p>
        ) : (
          <ul className="space-y-2">
            {d.recentErrors.map((e, i) => (
              <li key={i} className="flex items-start gap-3 text-sm">
                <span
                  className="mt-1 inline-block w-2 h-2 rounded-full shrink-0"
                  style={{ background: e.status === 'failure' ? '#fca5a5' : '#6ee7b7' }}
                  aria-hidden="true"
                />
                <div className="min-w-0">
                  <div className="text-ink">
                    {e.stage ? <span className="uppercase text-[10px] tracking-[0.12em] text-muted mr-2">{e.stage}</span> : null}
                    {e.message || (e.status === 'failure' ? 'Discovery error' : 'Discovery run')}
                  </div>
                  {e.at && <div className="text-[11px] text-muted">{e.at.replace('T', ' ').slice(0, 16)}</div>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* (#239) AI ICP sharpener — reads the brief, proposes structured ICP
          (industries / locations / excludes / size range). Sits ABOVE the
          IcpEditor so val can sharpen → review → manually tweak. AI-applied
          items render with a distinct chip in the editor below. */}
      <SharpenIcpPanel clientId={clientId} clientName={d.name} />

      {/* (#241) Autopilot activity — what the system did automatically for
          this client (sharpened ICP, scored leads, refreshed audits). Hidden
          when there's no history yet (fresh client stays clean). */}
      <AutopilotActivity clientId={clientId} />

      {/* (#216 v1+v2) Weekly digest — preview + manually send the email
          summarizing the client's week. Pairs with AutopilotActivity since
          they're both "what we did for them" surfaces — this one outbound.
          Friday cron also sends automatically; lastDigestSentAt lets val
          see at a glance whether the cron already covered them. */}
      <WeeklyDigestPanel
        clientId={clientId}
        clientName={d.name}
        lastSentAt={lastDigestSentAt}
      />

      {/* Editable ICP — who discovery targets (fix off-target leads, exclude noise). */}
      <MobileAccordion id="icp" icon="✎" title="Edit ICP" status="Ideal customer profile + fit">
        <div className="flex justify-end mb-1.5 -mr-1">
          <ActionStatusChip status={onboarding.actions.icp} notRunLabel="Not set" />
        </div>
        <IcpEditor clientId={clientId} initial={icp} provenance={icpProvenance} />
      </MobileAccordion>

      {/* Find leads scoped to THIS client (their hub only — never the AV pipeline). */}
      <div id="find-leads">
        <div className="flex justify-end mb-1.5 -mr-1">
          <ActionStatusChip status={onboarding.actions.leads} notRunLabel="No leads yet" />
        </div>
        <FindLeadsForClient clientId={clientId} clientName={d.name} />
      </div>

      {/* (#98) What this client cares about — at-a-glance snapshot of their
          key message / voice / authority topics / dream outlets pulled from
          their brief. Sits right above the PR section so val sees it while
          reading/working their PR pipeline. */}
      <ClientInfluenceCard clientId={clientId} />

      {/* (#88) Per-client PR voice + posture picker. Flips THIS brand's
          drafter voice (client/advisory/congratulatory) without opening the
          full brief editor. Takes effect on the next draft. */}
      <PrVoicePicker
        clientId={clientId}
        clientName={d.name}
        initialVoice={intelCfg.defaultVoice}
        initialPosture={intelCfg.posture}
      />

      {/* (#213 Part A) Their PR pipeline -- opportunities matched to this
          client's leads. Was previously only visible in the global PR inbox. */}
      <ClientPrPanel clientId={clientId} clientName={d.name} />

      {/* (#226) Per-client PR ingest mailbox. Address goes on John White's
          media list, etc., and routes journalist requests straight into the
          PR pipeline -- ending the val-as-middleware pattern. */}
      <PrInboxPanel
        clientId={clientId}
        clientName={d.name}
        initial={await getInboxRecord(clientId).then((r) => ({
          slug: r?.slug ?? null,
          email: r?.email ?? null,
          setAt: r?.setAt ?? null
        })).catch(() => ({ slug: null, email: null, setAt: null }))}
      />

      {/* (#214) Per-client PR discovery source tuning. RSS feeds tagged to
          this client only, so John's political feeds / Adriana's legal feeds /
          Ron's healthcare feeds run alongside the tenant-wide sources. */}
      <PrSourcesPanel
        clientId={clientId}
        clientName={d.name}
        initial={await listSourcesForClient(clientId).then((rows) =>
          rows.map((s) => ({
            id: s.id,
            kind: s.kind,
            label: s.label,
            url: s.configJson && typeof s.configJson === 'object' && 'url' in (s.configJson as Record<string, unknown>)
              ? String((s.configJson as { url?: unknown }).url ?? '')
              : null,
            isActive: s.isActive,
            lastRunAt: s.lastRunAt,
            lastStatus: s.lastStatus
          }))
        ).catch(() => [])}
      />

      {/* Bulk lead handoff: assign unassigned prospects to this client. */}
      <AssignLeadsPanel clientId={clientId} clientName={d.name} leads={unassigned} />

      {/* Bulk take-back: return this client's leads to the house pipeline (#96).
          Ownership flips only; enrichment/scores/audits stay on the lead. */}
      <ReleaseLeadsPanel
        clientId={clientId}
        clientName={d.name}
        leads={d.leads
          .filter((l): l is typeof l & { auditId: string } => typeof l.auditId === 'string' && l.auditId.length > 0)
          .map((l) => ({
            auditId: l.auditId,
            company: l.company,
            industry: l.industry,
            contactName: l.contactName,
            score: l.score,
            band: l.band
          }))}
      />

      {/* (#95) Score this client's pipeline against their ICP + brief. Sits
          next to enrich + refresh because they're all "make their pipeline
          actionable" actions. */}
      <IcpFitScorePanel clientId={clientId} clientName={d.name} />

      {/* Enrich this client's leads on their behalf (Hunter contact details). */}
      <EnrichClientLeadsButton clientId={clientId} clientName={d.name} />

      {/* (#90) Stale audit hint — when val edits the brief, this surfaces a
          calm amber chip telling her how many lead audits were grounded in
          the older positioning. Acts as a nudge to click RefreshIntelPanel. */}
      {staleAuditCount > 0 && (
        <div className="rounded-2xl border border-[color-mix(in_srgb,var(--gold-bright)_30%,transparent)] bg-[var(--gold-bright)]/[0.04] p-3 text-[12.5px] text-[color-mix(in_srgb,var(--gold-bright)_95%,transparent)]/90 flex items-start gap-2">
          <span aria-hidden="true">&#9203;</span>
          <span>
            <span className="font-medium text-[color-mix(in_srgb,var(--gold-bright)_95%,transparent)]">{staleAuditCount} audit{staleAuditCount === 1 ? '' : 's'} catching up</span> —
            the brief was edited after these leads were audited.{' '}
            <span className="text-[color-mix(in_srgb,var(--gold-bright)_70%,transparent)]">
              Use &ldquo;Refresh AI intel&rdquo; below (audits + call scripts) to re-ground them in the current brief.
            </span>
          </span>
        </div>
      )}

      {/* (#203) Force-regenerate AI intel for this client's leads (replaces
          phpMyAdmin SQL pattern). Audits + call scripts + outreach drafts. */}
      <RefreshIntelPanel clientId={clientId} clientName={d.name} />

      {/* (#306) Their pipeline — with bulk-select + bulk-delete + bulk-move-
          to-another-client. Address inline so val can triage by geography. */}
      <MobileAccordion id="their-pipeline" icon="◉" title="Their pipeline" status="Leads to triage">
      <div className="rounded-2xl border border-border bg-surface p-4">
        <div className="text-[11px] uppercase tracking-[0.12em] text-muted mb-3">Their pipeline</div>
        <ClientPipelineList
          clientId={clientId}
          clientName={d.name}
          leads={d.leads.slice(0, 30).map((l) => ({
            id: l.id,
            auditId: l.auditId,
            company: l.company,
            industry: l.industry,
            contactName: l.contactName,
            contactTitle: l.contactTitle,
            score: l.score,
            band: l.band,
            addressCity: l.addressCity,
            addressState: l.addressState
          }))}
          otherClients={clientAccounts
            .filter((c) => c.clientId !== clientId)
            .map((c) => ({ clientId: c.clientId, name: c.name }))}
        />
      </div>
      </MobileAccordion>
    </div>
  );
}
