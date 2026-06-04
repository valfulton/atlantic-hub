/**
 * ThisWeekFeed  (#242)
 *
 * Client-side "your week at A&V" widget. Mounted on the client dashboard
 * and on the operator preview mirror so val can see exactly what Tim/Adriana
 * see. Renders nothing when there's no notable activity — Day-1 clients
 * stay calm.
 *
 * Symmetric with the operator-side AutopilotActivity (#241), but tuned for
 * what the client cares about (not "ICP sharpened" jargon — "we sharpened
 * your prospect targeting from your latest intake").
 *
 * Server component: fetches its own data with the client_id passed in by
 * the page. Pure JSX render — no client interactivity needed.
 */
import Link from 'next/link';
import { fetchClientThisWeek } from '@/lib/client/this_week';

const TONE_STYLE: Record<'good' | 'info' | 'urgent', { dot: string; text: string }> = {
  good:   { dot: '#6ee7b7', text: 'text-emerald-200' },
  info:   { dot: '#a8cbff', text: 'text-sky-200' },
  urgent: { dot: '#fcd34d', text: 'text-[#EBCB6B]/95' }
};

export default async function ThisWeekFeed({
  clientId,
  firstName
}: {
  clientId: number | null;
  firstName: string;
}) {
  if (!clientId) return null;
  const data = await fetchClientThisWeek(clientId);
  if (data.items.length === 0) return null;

  return (
    <section
      className="rounded-2xl border border-border overflow-hidden"
      style={{
        background:
          'radial-gradient(140% 160% at 100% 0%, rgba(245,158,11,0.08), transparent 55%), linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01))'
      }}
    >
      <div className="px-6 sm:px-8 py-6">
        <div className="text-[10px] uppercase tracking-[0.22em] text-brand mb-1">{data.windowLabel}</div>
        <h2 className="text-xl font-semibold text-ink tracking-tight">
          This week for {firstName || 'you'}.
        </h2>
        <p className="text-muted text-sm mt-2 leading-relaxed">
          What Atlantic &amp; Vine moved on your behalf since your last visit.
        </p>

        <ul className="mt-5 space-y-2.5">
          {data.items.map((it, i) => {
            const tone = TONE_STYLE[it.tone];
            const content = (
              <>
                <span
                  aria-hidden="true"
                  className="inline-block h-1.5 w-1.5 rounded-full shrink-0"
                  style={{ background: tone.dot }}
                />
                <span className={`text-sm ${tone.text}`}>{it.text}</span>
              </>
            );
            return (
              <li key={i} className="flex items-start gap-2.5">
                {it.href ? (
                  <Link href={it.href} className="flex items-start gap-2.5 hover:opacity-90 transition-opacity">
                    {content}
                  </Link>
                ) : (
                  content
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
