/**
 * NextActionHint  (val 2026-06-02)
 *
 * Reads the OnboardingStatus, surfaces the FIRST un-done (or in-progress)
 * stage as a "→ Next:" CTA above the strip. Click the CTA to jump to that
 * stage's panel anchor. Cuts decision fatigue when val opens a half-prepped
 * client and doesn't remember what's missing.
 *
 * When everything is done (demo ready), shows a celebratory "Ready for the
 * demo" instead of a next step.
 */
import Link from 'next/link';
import type { OnboardingStatus, StageState } from '@/lib/av/onboarding_status';

function chooseNext(stages: StageState[]): StageState | null {
  const inProgress = stages.find((s) => s.status === 'inProgress');
  if (inProgress) return inProgress;
  const notStarted = stages.find((s) => s.status === 'notStarted');
  return notStarted ?? null;
}

/** Friendly suggested verb per stage, more actionable than the chip label. */
const NEXT_VERB: Record<string, string> = {
  account: 'Set up the account',
  intake_sent: 'Send them their intake link',
  intake_filled: 'Fill more of the intake from the web',
  intelligence: 'Extract intelligence from intake',
  icp: 'Sharpen the ICP',
  brand_kit: 'Extract the brand kit',
  socials: 'Pull or paste their social URLs',
  campaigns: 'Draft campaign candidates',
  leads: 'Find their first leads',
  first_audit: 'Run an audit on their first lead',
  first_content: 'Draft their first content piece',
  first_outreach: 'Send the first outreach or log a call',
  demo_ready: 'Flip the demo-ready switch'
};

export default function NextActionHint({ status }: { status: OnboardingStatus }) {
  const next = chooseNext(status.stages);

  if (!next || status.demoReady) {
    return (
      <div className="rounded-2xl border border-brand/40 bg-brand/[0.08] px-4 py-3 mb-5 flex items-center justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.14em] text-brand">Demo ready</div>
          <div className="text-sm text-ink mt-0.5">
            All stages lit. Walk them through it — the deck makes itself.
          </div>
        </div>
        <span className="text-brand text-xl" aria-hidden>✦</span>
      </div>
    );
  }

  const verb = NEXT_VERB[next.key] ?? next.label;
  const anchor = next.anchor ?? null;

  return (
    <div className="rounded-2xl border border-emerald-400/30 bg-emerald-400/[0.04] px-4 py-3 mb-5 flex items-center justify-between gap-3 flex-wrap">
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-[0.14em] text-emerald-300">Next up</div>
        <div className="text-sm text-ink mt-0.5">
          <span className="text-emerald-200/90 mr-1.5">→</span>
          <span className="font-medium">{verb}</span>
          {next.detail ? <span className="text-muted ml-2 text-[12px]">{next.detail}</span> : null}
        </div>
      </div>
      {anchor ? (
        <Link
          href={`#${anchor}`}
          className="shrink-0 rounded-lg border border-emerald-400/50 bg-emerald-400/15 hover:bg-emerald-400/25 text-emerald-100 text-xs font-medium px-3 py-1.5"
        >
          Jump to panel →
        </Link>
      ) : null}
    </div>
  );
}
