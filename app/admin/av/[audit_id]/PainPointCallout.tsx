/**
 * components: PainPointCallout
 *
 * "What to say on the call" callout on the lead detail page. Reads the
 * lead.painPointProfile JSON populated by lib/ai/pain_extractor.ts.
 * Renders nothing if no profile yet -- silence is fine, sales rep can
 * still use the audit content below.
 *
 * Server-component-friendly: no client hooks, just JSX from a passed-in
 * profile object.
 */

interface PainPointProfile {
  primary_pain: string;
  urgency_signal: 'high' | 'medium' | 'low' | 'unknown';
  decision_maker_proximity: 'direct' | 'team_member' | 'unclear';
  budget_signal: 'strong' | 'possible' | 'weak' | 'unknown';
  timing_signal: 'now' | 'this_quarter' | 'later' | 'unknown';
  last_objection_seen: string | null;
  conversation_starters: string[];
  do_not_say: string[];
  extracted_at: string;
}

interface Props {
  profile: PainPointProfile | null | undefined;
  extractedAt?: string | null;
}

function urgencyStyle(s: string): string {
  if (s === 'high') return 'bg-rose-500/15 text-rose-200 border-rose-500/40';
  if (s === 'medium') return 'bg-[color-mix(in_srgb,var(--gold-bright)_12%,transparent)] text-[color-mix(in_srgb,var(--gold-bright)_95%,transparent)] border-[color-mix(in_srgb,var(--gold-bright)_40%,transparent)]';
  if (s === 'low') return 'bg-sky-500/15 text-sky-200 border-sky-500/40';
  return 'bg-surface text-muted border-border';
}

function timingLabel(s: string): string {
  if (s === 'now') return 'Looking now';
  if (s === 'this_quarter') return 'This quarter';
  if (s === 'later') return 'Later';
  return 'Timing unknown';
}

function dmLabel(s: string): string {
  if (s === 'direct') return 'Direct decision maker';
  if (s === 'team_member') return 'Likely team member';
  return 'Role unclear';
}

function budgetLabel(s: string): string {
  if (s === 'strong') return 'Budget likely';
  if (s === 'possible') return 'Budget possible';
  if (s === 'weak') return 'Budget weak';
  return 'Budget unknown';
}

export function PainPointCallout({ profile, extractedAt }: Props) {
  if (!profile || !profile.primary_pain) return null;

  return (
    <section
      aria-label="What to say on the call"
      className="rounded-xl border border-[color-mix(in_srgb,var(--gold-bright)_30%,transparent)] p-5 mb-6 bg-gradient-to-br from-[color-mix(in_srgb,var(--gold-bright)_10%,transparent)] to-rose-500/5"
    >
      <header className="flex items-baseline justify-between mb-3 gap-3 flex-wrap">
        <div className="flex items-baseline gap-2">
          <span className="text-[10px] uppercase tracking-[0.14em] text-[var(--gold-bright)] font-medium">
            What to say on the call
          </span>
          <span
            className={`inline-block px-2 py-0.5 rounded-full border text-[10px] uppercase tracking-wider ${urgencyStyle(profile.urgency_signal)}`}
            title="Urgency signal extracted by AI"
          >
            {profile.urgency_signal} urgency
          </span>
        </div>
        {extractedAt && (
          <span className="text-[10px] text-muted">
            Refreshed {new Date(extractedAt).toLocaleString()}
          </span>
        )}
      </header>

      <p className="text-base text-ink leading-relaxed mb-4">
        {profile.primary_pain}
      </p>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-4">
        <Chip label={timingLabel(profile.timing_signal)} />
        <Chip label={dmLabel(profile.decision_maker_proximity)} />
        <Chip label={budgetLabel(profile.budget_signal)} />
      </div>

      {profile.conversation_starters.length > 0 && (
        <div className="mb-3">
          <div className="field-label mb-1.5">Try opening with</div>
          <ul className="space-y-1.5">
            {profile.conversation_starters.map((s, i) => (
              <li
                key={i}
                className="text-sm text-ink bg-surface border border-border rounded-md px-3 py-2"
              >
                {s}
              </li>
            ))}
          </ul>
        </div>
      )}

      {profile.last_objection_seen && (
        <div className="mb-3">
          <div className="field-label mb-1">Recent objection on record</div>
          <p className="text-sm text-rose-200/90">{profile.last_objection_seen}</p>
        </div>
      )}

      {profile.do_not_say.length > 0 && (
        <div>
          <div className="field-label mb-1">Avoid saying</div>
          <ul className="space-y-1">
            {profile.do_not_say.map((s, i) => (
              <li key={i} className="text-xs text-muted">- {s}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Chip({ label }: { label: string }) {
  return (
    <span className="text-xs text-muted bg-surface border border-border rounded-md px-2.5 py-1 truncate">
      {label}
    </span>
  );
}
