/**
 * /admin/av/conductor  (#295)
 *
 * The Conductor Console — val's command bar for shaping how a Claude chat
 * behaves before she writes the first ask. Each mode button copies a
 * pre-built directive prompt to the clipboard; she pastes it at the top
 * of a new chat and the behavior contract is set without her having to
 * repeat in-flight corrections that have already cost time on past
 * sessions.
 *
 * Composition:
 *   - Five mode buttons (see ModeButton.tsx) — ship-only, design-first,
 *     parallel-agents, campaign-bundle, memory-pack
 *   - Spin-up chat templates — pre-written briefs for the most common
 *     parallel-chat scenarios (client work session, content batch,
 *     bug triage, security review, lean pass)
 *   - Links to the three handoff briefs already in the playbook
 *
 * This page is operator-only. No client-facing copy. No tenant scoping.
 * The page is server-rendered + static — no DB calls, no API hits.
 *
 * Visual rules: feedback_contrast_rule strictly observed. Every amber
 * surface uses text-black. No future-promise copy.
 */
import Link from 'next/link';
import { ModeButton } from './ModeButton';
import { CopyChip } from './CopyChip';

export const dynamic = 'force-static';

const MODES = [
  {
    icon: '🚢',
    label: 'Ship-only mode',
    blurb: 'Commit hash + URL only. No recap, no future-tense. Push the moment tsc passes.',
    prompt:
      'Ship-only mode for this chat. Respond with commit hash + URL only after tsc passes. Push immediately. No recap paragraphs, no "next I will," no future tense. If something blocks shipping, one short line stating what is blocked and why. Use explicit git pathspecs (never bare git commit). Honor every existing memory rule.'
  },
  {
    icon: '🎨',
    label: 'Design-first mode',
    blurb: 'Propose a 5-line spec before any code. Wait for approval. Then build.',
    prompt:
      'Design-first mode for this chat. Before writing code on any investor-facing, client-facing, or new surface, propose the change as a 5-line text spec: (1) what changes, (2) which file/route, (3) expected behavior, (4) visual cue if applicable, (5) tradeoff. Wait for my OK. Then build. Skip the spec only for typo-level fixes.'
  },
  {
    icon: '🌀',
    label: 'Parallel agents mode',
    blurb: 'Spawn sub-agents for read-only audits while you keep building. Never serial when parallel works.',
    prompt:
      'Parallel agents mode for this chat. Any read-only audit (file inventory, duplicate-pattern search, dead-code scan, route map, security review, src grep) gets spawned as a sub-agent via the Task tool so it runs while you keep building. Never serial when parallel is possible. Brief each sub-agent in full — they cannot see this conversation.'
  },
  {
    icon: '📦',
    label: 'Campaign-bundle mode',
    blurb: 'Whole chat = one Netlify push. Hold every commit until I say SHIP.',
    prompt:
      'Campaign-bundle mode for this chat. The whole chat is a single Netlify push. Hold every commit until I say SHIP. Bundle all diffs into one cohesive commit. Group related changes. Run tsc as you go but do not push per-feature. Final commit message should summarize every change with bullet headings per area touched.'
  },
  {
    icon: '🧠',
    label: 'Memory-pack mode',
    blurb: 'Surface every learning as a candidate memory. Format: type | name | one-line. Save only after my OK.',
    prompt:
      'Memory-pack mode for this chat. As you work, surface every learning that would be useful in future chats as a candidate memory. Format the candidates as a numbered list: `N. type (user/feedback/project/reference) | short-kebab-name | one-line description`. Do not write to the memory folder without my OK on the list. At end of chat, present the final pack for approval.'
  }
];

interface ChatSpinUpTemplate {
  title: string;
  blurb: string;
  href?: string;
  prompt: string;
}

const SPIN_UPS: ChatSpinUpTemplate[] = [
  {
    title: 'Client content sprint',
    blurb: 'Daily/weekly content batch for a specific client — blog + social + commercial in one push.',
    prompt:
      'Campaign-bundle mode for this chat. We are running a content sprint for [CLIENT NAME, client_id N]. Read their ICP + active campaigns + brand kit before drafting. Draft 1 blog + 3 social variants + 1 commercial concept. All must pass the review/brand/approve gate — do not auto-publish. Use luxury-nautical voice. Surface every AI prompt as editable before spending credits.'
  },
  {
    title: 'Bug triage session',
    blurb: 'A specific broken surface. You stay focused on root cause + minimum-viable fix.',
    prompt:
      'Ship-only mode + Parallel agents mode for this chat. The broken surface is: [URL]. Symptom: [WHAT BREAKS]. Spawn a sub-agent to grep related code paths while you read the page. Return the root cause + the minimum-viable fix as a 3-line plan, then ship after my OK. Do not refactor while you are in there.'
  },
  {
    title: 'Security review',
    blurb: 'Read-only audit of auth, secrets, injection vectors, exposed routes.',
    prompt:
      'Parallel agents mode + Design-first mode for this chat. Spawn the security-review skill on the current branch. While it runs, audit middleware.ts + every route under /api/admin/* for auth gating + every place we accept user input for injection vectors. Produce a numbered findings list with severity (P0/P1/P2) + repro. No code changes — findings only.'
  },
  {
    title: 'Lean pass / dead-code sweep',
    blurb: 'Read-only inventory of routes, duplicate patterns, unused exports. Feeds Lean Pass brief.',
    prompt:
      'Parallel agents mode for this chat. Read /Atlantic_Hub_Playbook/HANDOFF_Lean_Pass_Code_Consolidation.md first. Then spawn parallel sub-agents for: (a) hidden-pages audit, (b) duplicate-pattern audit, (c) unused-export inventory, (d) commented-out-code finder. Aggregate findings into the three playbook docs the brief names. No code changes this chat.'
  },
  {
    title: 'UX/UI primitive sweep',
    blurb: 'Pull from the UX/UI Unification brief. Builds Button/Card/Chip primitives, sweeps one page as proof.',
    prompt:
      'Design-first mode + Campaign-bundle mode for this chat. Read /Atlantic_Hub_Playbook/HANDOFF_UX_UI_Unification.md first. Propose Button + Card primitives as 5-line specs. After OK, build them under app/_components/ui/. Sweep ONE high-traffic page onto them as proof. Hold the push until I say SHIP. Strict contrast rule — no white on amber, ever.'
  }
];

const HANDOFF_BRIEFS = [
  {
    label: 'UX / UI Unification',
    blurb: 'Contrast law, Button/Card primitives, frame extraction.',
    href: '/Atlantic_Hub_Playbook/HANDOFF_UX_UI_Unification.md'
  },
  {
    label: 'Newsroom + Frame Bundling',
    blurb: 'PublicFrame/OperatorFrame/ClientFrame, tenant brand context, newsroom-as-TV spec.',
    href: '/Atlantic_Hub_Playbook/HANDOFF_Newsroom_Frame_Bundling.md'
  },
  {
    label: 'Lean Pass + Code Consolidation',
    blurb: 'Hidden-pages audit, duplicate-pattern sweep, package extraction proposal.',
    href: '/Atlantic_Hub_Playbook/HANDOFF_Lean_Pass_Code_Consolidation.md'
  },
  {
    label: 'Conductor Console (this concept)',
    blurb: 'Multi-chat visibility, smart prompts, memory packets — the bigger system this dashboard hints at.',
    href: '/Atlantic_Hub_Playbook/HANDOFF_Conductor_Console.md'
  }
];

export default function ConductorPage() {
  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <div className="mb-8">
        <div className="text-[10px] uppercase tracking-[0.22em] text-brand mb-2">Conductor</div>
        <h1 className="text-3xl font-semibold tracking-tight text-ink">Command bar.</h1>
        <p className="text-sm text-muted mt-2 max-w-2xl leading-relaxed">
          One-click directives for the next Claude chat. Each mode button copies a behavior
          contract to your clipboard — paste it at the top of a new chat and the contract is
          set, no in-flight corrections needed. Modes compound (ship-only + campaign-bundle =
          quiet bundle that ships at the end).
        </p>
      </div>

      <section className="mb-12">
        <div className="text-[11px] uppercase tracking-[0.16em] text-muted mb-3">Modes</div>
        <div className="grid sm:grid-cols-2 gap-3">
          {MODES.map((m) => (
            <ModeButton key={m.label} {...m} />
          ))}
        </div>
      </section>

      <section className="mb-12">
        <div className="text-[11px] uppercase tracking-[0.16em] text-muted mb-3">
          Spin a new chat — pre-bundled
        </div>
        <ul className="space-y-2.5">
          {SPIN_UPS.map((s) => (
            <li
              key={s.title}
              className="rounded-2xl border border-border bg-surface/60 p-4"
            >
              <div className="flex items-baseline justify-between gap-3 mb-1">
                <h3 className="text-[13.5px] font-semibold text-ink">{s.title}</h3>
                <CopyChip text={s.prompt} />
              </div>
              <p className="text-[12px] text-muted leading-snug">{s.blurb}</p>
              <details className="mt-2 group">
                <summary className="text-[11px] text-muted cursor-pointer hover:text-ink select-none">
                  Show the prompt
                </summary>
                <pre className="mt-2 text-[11px] text-ink/85 bg-black/30 border border-border rounded-md p-3 whitespace-pre-wrap leading-relaxed">
                  {s.prompt}
                </pre>
              </details>
            </li>
          ))}
        </ul>
      </section>

      <section className="mb-12">
        <div className="text-[11px] uppercase tracking-[0.16em] text-muted mb-3">
          Spun-off handoff briefs (in /Atlantic_Hub_Playbook/)
        </div>
        <ul className="space-y-1.5">
          {HANDOFF_BRIEFS.map((b) => (
            <li key={b.label}>
              <div className="rounded-md border border-border bg-surface/50 px-3 py-2">
                <div className="text-[13px] text-ink font-medium">{b.label}</div>
                <div className="text-[11.5px] text-muted mt-0.5">{b.blurb}</div>
                <div className="text-[10.5px] text-muted/70 mt-1 font-mono">
                  {b.href}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-2xl border border-[color-mix(in_srgb,var(--gold-bright)_25%,transparent)] bg-[var(--gold-bright)]/[0.03] px-5 py-4">
        <div className="text-[10px] uppercase tracking-[0.18em] text-brand mb-1">
          Wake-up rule
        </div>
        <p className="text-[12.5px] text-ink/90 leading-relaxed">
          If a chat drifts off-mode or starts narrating instead of shipping, paste the relevant
          mode button again. Modes are sticky for the chat once set — repeating is the polite
          way to refocus mid-flight.
        </p>
        <p className="text-[11px] text-muted mt-2 leading-relaxed">
          A bigger version of this console (live status of every running Claude chat, prompt
          libraries per client, memory-packet bundling) lives in the{' '}
          <span className="text-ink/80">Conductor Console</span> handoff brief — open that as a
          new chat when ready to design the full system.
        </p>
      </section>

      <div className="mt-10 flex items-center gap-4 text-[12px]">
        <Link href="/admin/av" className="text-muted hover:text-brand">
          ← Back to cockpit
        </Link>
      </div>
    </div>
  );
}

