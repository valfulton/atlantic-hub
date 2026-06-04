/**
 * ClientHero — the "Your campaign, live" hero band at the top of the client's
 * dashboard. SHARED by the real /client/dashboard and the operator preview
 * (/admin/av/clients/[id]/preview) so the two render from one source — fix once,
 * both update. Pass 2 of the mirror refactor.
 *
 * Shows the live pipeline count (hot/warm/cool) and, when the client has a deal
 * model set, their POTENTIAL PIPELINE in real monthly dollars. Page-specific
 * copy goes in via children.
 */
import { formatUsd } from '@/lib/sales/deal_model';

export default function ClientHero({
  firstName,
  pipeline,
  monthlyPipelineCents,
  children
}: {
  firstName: string;
  pipeline: { total: number; hot: number; warm: number; cool: number };
  monthlyPipelineCents?: number | null;
  children?: React.ReactNode;
}) {
  return (
    <section
      className="mb-8 rounded-2xl border border-border overflow-hidden"
      style={{
        background:
          'radial-gradient(120% 140% at 0% 0%, rgba(245,158,11,0.10), transparent 55%), linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01))'
      }}
    >
      <div className="px-4 sm:px-8 py-5 sm:py-7">
        <div className="text-[10px] uppercase tracking-[0.22em] text-brand mb-2">Your campaign, live</div>
        <h1 className="text-xl sm:text-3xl font-semibold text-ink tracking-tight break-words">Welcome back, {firstName}.</h1>

        <div className="mt-4 sm:mt-5 flex flex-wrap items-end gap-x-6 sm:gap-x-8 gap-y-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-muted mb-1">Live pipeline</div>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl sm:text-4xl font-semibold text-ink leading-none">{pipeline.total}</span>
              <span className="text-sm text-muted">{pipeline.total === 1 ? 'lead' : 'leads'} in play</span>
            </div>
          </div>

          {pipeline.total > 0 && (
            <div className="flex items-center gap-4 text-sm">
              {pipeline.hot > 0 && <span className="text-rose-300"><span className="font-semibold">{pipeline.hot}</span> hot</span>}
              {pipeline.warm > 0 && <span className="text-[#EBCB6B]"><span className="font-semibold">{pipeline.warm}</span> warm</span>}
              {pipeline.cool > 0 && <span className="text-sky-300"><span className="font-semibold">{pipeline.cool}</span> cool</span>}
            </div>
          )}

          {monthlyPipelineCents != null && monthlyPipelineCents > 0 && (
            <div title="Forecast based on your deal model and the leads currently in your pipeline — not booked revenue.">
              <div className="text-[10px] uppercase tracking-[0.18em] text-muted mb-1">
                Potential pipeline <span className="text-muted/70 normal-case tracking-normal">(forecast)</span>
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-2xl sm:text-3xl font-semibold leading-none" style={{ color: '#FFC73D' }}>
                  {formatUsd(monthlyPipelineCents)}
                </span>
                <span className="text-sm text-muted">/mo</span>
              </div>
            </div>
          )}
        </div>

        {children}
      </div>
    </section>
  );
}
