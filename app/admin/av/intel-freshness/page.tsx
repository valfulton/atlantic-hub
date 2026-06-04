// OPERATOR-ONLY — reachable only via operator/investor surfaces, never public/client nav (by design).
// Absence from nav is intentional, not abandonment. Do NOT delete in a dead-code sweep.
// See Atlantic_Hub_Playbook/Hidden_Pages_Audit.md (PR A).

/**
 * /admin/av/intel-freshness  (#204)
 *
 * Operator-side "which leads are stale" view. Lists every lead with the
 * last-refreshed timestamps for audit, call script, and outreach, so val
 * can spot which leads are running on old prompts/briefs and needs a
 * refresh. Sortable, filterable, links per lead to the detail page.
 */
import Link from 'next/link';
import { listLeadsWithIntelFreshness } from '@/lib/leads/intel_freshness';
import { IntelFreshnessTable } from './IntelFreshnessTable';

export const dynamic = 'force-dynamic';

export default async function IntelFreshnessPage() {
  const leads = await listLeadsWithIntelFreshness({ limit: 1000 });

  const total = leads.length;
  const neverAudited = leads.filter((l) => !l.auditAt).length;
  const neverCallScripted = leads.filter((l) => !l.callScriptAt).length;
  const stalwartAge = (ts: string | null) => (ts ? (Date.now() - new Date(ts).getTime()) / 86_400_000 : Infinity);
  const auditStale14d = leads.filter((l) => stalwartAge(l.auditAt) > 14).length;
  const callScriptStale14d = leads.filter((l) => stalwartAge(l.callScriptAt) > 14).length;

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-white">
            Intel <span className="text-[#EBCB6B] italic">freshness</span>
          </h1>
          <p className="text-sm text-white/60 mt-1 max-w-2xl">
            Every lead, with the last time each piece of AI-generated intel was refreshed.
            Sorted with the stalest leads up top. Use the per-client &quot;Refresh AI intel&quot; panel
            (on each client&apos;s page) to regenerate in bulk after a prompt change or fresh intake.
          </p>
        </div>
        <Link
          href="/admin/av"
          className="text-[12px] text-white/50 hover:text-white/80 transition shrink-0"
        >
          ← Back to leads
        </Link>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Leads tracked" value={total} />
        <Stat label="Never audited" value={neverAudited} tone={neverAudited > 0 ? 'warn' : 'ok'} />
        <Stat label="Audit > 14 days old" value={auditStale14d} tone={auditStale14d > 0 ? 'warn' : 'ok'} />
        <Stat label="Call script > 14d old" value={callScriptStale14d} tone={callScriptStale14d > 0 ? 'warn' : 'ok'} />
      </div>

      <IntelFreshnessTable leads={leads} />
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'ok' | 'warn' }) {
  const ring =
    tone === 'warn'
      ? 'border-[#EBCB6B]/35 bg-[#EBCB6B]/5'
      : 'border-white/10 bg-black/20';
  return (
    <div className={`rounded-xl border ${ring} px-4 py-3`}>
      <div className="text-[10px] uppercase tracking-[0.12em] text-white/50">{label}</div>
      <div className="text-2xl font-semibold text-white mt-1">{value}</div>
    </div>
  );
}
