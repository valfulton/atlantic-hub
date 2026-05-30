/**
 * RepCockpit — the gamified sales-rep view rendered at /admin/av/employees/me.
 * Server component (display only). Shows a rep their pipeline across A&V + EBW,
 * a big pipeline-$ number, weekly activity vs target, a streak badge, a team
 * leaderboard, and their live leads (click through to the operator lead page).
 *
 * Luxury-nautical: dark navy surfaces, amber accents, restrained maritime cues.
 */
import Link from 'next/link';
import { formatUsd, type RepDashboard, type RepLead, type TargetBrand } from '@/lib/sales/rep_dashboard';
import { QuickLogCall } from './QuickLogCall';

const AMBER = 'linear-gradient(120deg,#FF9C5B,#FFC73D)';

const STATUS_LABEL: Record<string, string> = {
  new: 'New', contacted: 'Contacted', qualified: 'Qualified', converted: 'Won',
  lost: 'Lost', nurture: 'Nurture', not_now: 'Not now', referred: 'Referred', case_study: 'Case study'
};

const BRAND_LABEL: Record<TargetBrand, string> = { av: 'A&V', ebw: 'EBW', both: 'A&V + EBW', other: '—' };

function bandColor(band: string | null): string {
  if (band === 'hot') return '#FF7A45';
  if (band === 'warm') return '#FFC73D';
  if (band === 'cool') return '#7CA9D6';
  return '#5b6472';
}

function StatCard({ label, value, sub, glow = false }: { label: string; value: string; sub?: string; glow?: boolean }) {
  return (
    <div
      className="rounded-2xl border border-border bg-surface p-4"
      style={glow ? { boxShadow: '0 0 0 1px rgba(255,199,61,0.25), 0 8px 30px -12px rgba(255,156,91,0.45)' } : undefined}
    >
      <div className="text-[11px] uppercase tracking-[0.12em] text-muted">{label}</div>
      <div className="text-2xl font-semibold text-ink mt-1 tabular-nums">{value}</div>
      {sub && <div className="text-[11px] text-muted mt-0.5">{sub}</div>}
    </div>
  );
}

/** SVG progress ring for weekly calls vs target. */
function ActivityRing({ done, target }: { done: number; target: number }) {
  const pct = target > 0 ? Math.min(1, done / target) : 0;
  const r = 34;
  const c = 2 * Math.PI * r;
  const dash = c * pct;
  return (
    <div className="relative w-[88px] h-[88px] shrink-0">
      <svg width="88" height="88" viewBox="0 0 88 88" className="-rotate-90">
        <circle cx="44" cy="44" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="8" />
        <circle
          cx="44" cy="44" r={r} fill="none" stroke="url(#ringGrad)" strokeWidth="8" strokeLinecap="round"
          strokeDasharray={`${dash} ${c}`}
        />
        <defs>
          <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#FF9C5B" />
            <stop offset="100%" stopColor="#FFC73D" />
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-lg font-semibold text-ink leading-none tabular-nums">{done}</div>
        <div className="text-[10px] text-muted">/ {target}</div>
      </div>
    </div>
  );
}

function brandBar(byBrand: { av: number; ebw: number; both: number }) {
  const total = Math.max(1, byBrand.av + byBrand.ebw + byBrand.both);
  const seg = (n: number, color: string, key: string) =>
    n > 0 ? <div key={key} style={{ width: `${(n / total) * 100}%`, background: color }} className="h-2.5" /> : null;
  return (
    <div className="flex w-full rounded-full overflow-hidden bg-black/30">
      {seg(byBrand.av, '#FFC73D', 'av')}
      {seg(byBrand.ebw, '#7CA9D6', 'ebw')}
      {seg(byBrand.both, '#9D7BE0', 'both')}
    </div>
  );
}

export default function RepCockpit({ data, repName }: { data: RepDashboard; repName: string }) {
  const { stats, leads, leaderboard } = data;
  const firstName = repName.split(' ')[0] || repName;
  const yourRank = leaderboard.find((e) => e.isYou)?.rank ?? null;

  return (
    <div className="space-y-5">
      {/* Hero — the number that goes up */}
      <div className="rounded-3xl border border-border bg-surface p-6 relative overflow-hidden">
        {/* maritime cue: faint horizon waves */}
        <svg viewBox="0 0 1200 120" preserveAspectRatio="none" className="absolute bottom-0 left-0 w-full h-16 opacity-[0.06]" aria-hidden="true">
          <path d="M0,60 C150,100 350,20 600,60 C850,100 1050,20 1200,60 L1200,120 L0,120 Z" fill="#FFC73D" />
        </svg>
        <div className="relative">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-muted">
            <span className="live-dot" aria-hidden="true" /> Your book · A&amp;V + EBW
          </div>
          <h1 className="text-2xl font-semibold text-ink mt-2">Let&apos;s go, {firstName}.</h1>
          <div className="mt-4 flex flex-wrap items-end gap-x-8 gap-y-3">
            <div>
              <div className="text-[11px] uppercase tracking-[0.12em] text-muted">Live pipeline value</div>
              <div
                className="text-4xl font-bold tabular-nums bg-clip-text text-transparent"
                style={{ backgroundImage: AMBER }}
              >
                {formatUsd(stats.livePipelineValueCents)}
              </div>
              <div className="text-[11px] text-muted mt-0.5">{stats.liveLeadCount} live · {stats.hotLeadCount} hot 🔥</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-[0.12em] text-muted">Closed wins</div>
              <div className="text-4xl font-bold text-emerald-300 tabular-nums">{stats.convertedCount}</div>
              <div className="text-[11px] text-muted mt-0.5">{formatUsd(stats.closedValueCents)} booked</div>
            </div>
          </div>
        </div>
      </div>

      {/* Activity + streak + meetings */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="rounded-2xl border border-border bg-surface p-4 flex items-center gap-4">
          <ActivityRing done={stats.callsThisWeek} target={stats.weeklyCallTarget} />
          <div>
            <div className="text-sm font-semibold text-ink">Calls this week</div>
            <div className="text-[11px] text-muted mt-0.5">{stats.connectsThisWeek} connected</div>
            <div className="text-[11px] text-muted">
              {stats.callsThisWeek >= stats.weeklyCallTarget
                ? 'Target smashed — keep rolling 🌊'
                : `${stats.weeklyCallTarget - stats.callsThisWeek} to hit your target`}
            </div>
          </div>
        </div>
        <StatCard
          label="Current streak"
          value={`${stats.currentStreakDays} day${stats.currentStreakDays === 1 ? '' : 's'}`}
          sub={`${stats.activeDaysLast30} active days in last 30`}
          glow={stats.currentStreakDays >= 3}
        />
        <StatCard
          label="Meetings booked"
          value={String(stats.meetingsBookedAllTime)}
          sub={stats.newUncalledCount > 0 ? `${stats.newUncalledCount} new lead${stats.newUncalledCount === 1 ? '' : 's'} await your first call` : 'All leads worked — nice'}
        />
      </div>

      {/* Pipeline by brand */}
      {stats.liveLeadCount > 0 && (
        <div className="rounded-2xl border border-border bg-surface p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[11px] uppercase tracking-[0.12em] text-muted">Live pipeline by brand</div>
            <div className="text-[11px] text-muted">
              <span style={{ color: '#FFC73D' }}>A&amp;V {stats.byBrand.av}</span>
              <span className="mx-2" style={{ color: '#7CA9D6' }}>EBW {stats.byBrand.ebw}</span>
              <span style={{ color: '#9D7BE0' }}>Both {stats.byBrand.both}</span>
            </div>
          </div>
          {brandBar(stats.byBrand)}
        </div>
      )}

      {/* Best opportunity */}
      {stats.topLead && stats.topLead.auditId && (
        <Link
          href={`/admin/av/lead/${stats.topLead.auditId}`}
          className="block rounded-2xl border border-border bg-surface p-4 hover:border-brand transition-colors"
        >
          <div className="text-[11px] uppercase tracking-[0.12em] text-muted mb-1">⭐ Best opportunity</div>
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-semibold text-ink truncate">{stats.topLead.company}</div>
            <div className="text-sm font-semibold tabular-nums" style={{ color: '#FFC73D' }}>
              {formatUsd(stats.topLead.estimatedValueCents)}
            </div>
          </div>
          <div className="text-[11px] text-muted mt-0.5">Score {stats.topLead.score} · open it to make the call</div>
        </Link>
      )}

      {/* Leaderboard */}
      <div className="rounded-2xl border border-border bg-surface p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-[11px] uppercase tracking-[0.12em] text-muted">Team leaderboard</div>
          {yourRank && <div className="text-[11px] text-muted">You&apos;re #{yourRank} of {leaderboard.length}</div>}
        </div>
        <div className="space-y-1">
          {leaderboard.slice(0, 8).map((e) => {
            const medal = e.rank === 1 ? '🥇' : e.rank === 2 ? '🥈' : e.rank === 3 ? '🥉' : null;
            return (
              <div
                key={e.userId}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 ${e.isYou ? 'bg-[var(--surface-2)] border border-brand/40' : 'hover:bg-[var(--surface)]'}`}
              >
                <div className="w-6 text-center text-sm">{medal ?? <span className="text-muted tabular-nums">{e.rank}</span>}</div>
                <div className="flex-1 min-w-0">
                  <div className={`text-sm truncate ${e.isYou ? 'text-ink font-semibold' : 'text-ink'}`}>
                    {e.name}{e.isYou ? ' (you)' : ''}
                  </div>
                  <div className="text-[11px] text-muted">{e.liveLeadCount} live · {e.callsThisWeek} calls this wk</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-semibold text-emerald-300 tabular-nums">{e.convertedCount} won</div>
                  <div className="text-[11px] text-muted tabular-nums">{formatUsd(e.livePipelineValueCents)}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Your pipeline */}
      <div className="rounded-2xl border border-border bg-surface p-4">
        <div className="text-[11px] uppercase tracking-[0.12em] text-muted mb-3">
          Your pipeline ({leads.length})
        </div>
        {leads.length === 0 ? (
          <p className="text-sm text-muted">
            No live leads assigned to you yet. Once an operator routes leads to your queue (from Find new leads),
            they&apos;ll land right here.
          </p>
        ) : (
          <ul className="space-y-2">
            {leads.map((l) => <LeadRowCard key={l.id} lead={l} />)}
          </ul>
        )}
      </div>
    </div>
  );
}

function LeadRowCard({ lead }: { lead: RepLead }) {
  return (
    <li className="rounded-xl border border-border bg-bg/40 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href={lead.auditId ? `/admin/av/lead/${lead.auditId}` : '#'} className="text-sm font-semibold text-ink hover:text-brand truncate block">
            {lead.company}
          </Link>
          <div className="text-[11px] text-muted mt-0.5 flex flex-wrap items-center gap-x-2">
            {lead.contactName && <span>{lead.contactName}</span>}
            {lead.industry && <span>· {lead.industry}</span>}
            <span
              className="inline-flex items-center px-1.5 py-px rounded text-[10px] font-medium border border-border"
              title="Target brand"
            >
              {BRAND_LABEL[lead.targetBrand]}
            </span>
            <span className="inline-flex items-center px-1.5 py-px rounded text-[10px] font-medium bg-black/30">
              {STATUS_LABEL[lead.leadStatus] ?? lead.leadStatus}
            </span>
          </div>
          {lead.painSummary && (
            <div className="text-[11px] text-muted/90 mt-1 italic truncate">“{lead.painSummary}”</div>
          )}
        </div>
        <div className="text-right shrink-0">
          <div className="flex items-center justify-end gap-1.5">
            <span className="inline-block w-2 h-2 rounded-full" style={{ background: bandColor(lead.band) }} aria-hidden="true" />
            <span className="text-sm font-semibold tabular-nums text-ink">{lead.score ?? '—'}</span>
          </div>
          {lead.estimatedValueCents > 0 && (
            <div className="text-[11px] tabular-nums mt-0.5" style={{ color: '#FFC73D' }}>{formatUsd(lead.estimatedValueCents)}</div>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 mt-2">
        {lead.phone && (
          <a href={`tel:${lead.phone.replace(/[^0-9+]/g, '')}`} className="text-[11px] px-2 py-1 rounded-md border border-border text-ink hover:border-brand">
            📞 Call
          </a>
        )}
        {lead.email && (
          <a href={`mailto:${lead.email}`} className="text-[11px] px-2 py-1 rounded-md border border-border text-ink hover:border-brand">
            ✉ Email
          </a>
        )}
        {lead.auditId && <QuickLogCall auditId={lead.auditId} />}
        {lead.auditId && (
          <Link href={`/admin/av/lead/${lead.auditId}`} className="text-[11px] px-2 py-1 rounded-md text-[#1a1207] font-medium" style={{ background: AMBER }}>
            Open lead →
          </Link>
        )}
      </div>
    </li>
  );
}
