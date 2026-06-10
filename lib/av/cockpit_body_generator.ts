/**
 * lib/av/cockpit_body_generator.ts  (#577, 2026-06-10)
 *
 * The structural fix val called out: stop hand-writing press kits as SQL
 * rollouts (the Ron+John pattern). Every brief, on save, should yield a
 * full press kit automatically — the cockpit lights up the same day the
 * brief is filled, for every client, with no human in the loop until the
 * Edit modal or the Green Light.
 *
 *   cockpit_asset_titles.ts  →  titles + per-title provenance (deterministic)
 *   cockpit_body_generator.ts → body text per title (LLM, brief-grounded)
 *   cockpit_approvals table  → persisted rows the cockpit + dashboard read
 *
 * Idempotent: skips any title that already exists for the client (operator
 * edits + greenlit rows are never clobbered). Safe to call repeatedly.
 *
 * Soft-fail: any LLM error on a single card is logged and skipped; other
 * cards still land. The brief save endpoint never blocks on body generation.
 *
 * Cost discipline (per the LLM Coverage Directive):
 *   - press_release / op_ed → pr_draft_release (gpt-4o, strategic)
 *   - social               → social_caption  (gpt-4o-mini, cheap)
 *   - commercial           → commercial_voice (gpt-4o-mini, mid)
 *   Prompts are interpolated here (visible per val's QC rule). When the
 *   prompt registry surface ships, these get migrated to editable rows.
 */
import { runLlm } from '@/lib/llm/router';
import { cockpitTitlesFor, type ApprovalTitle } from './cockpit_asset_titles';
import {
  listApprovalsForClient,
  createApproval,
  type ApprovalKind
} from './cockpit_approvals';
import type { EngagementKind } from '@/lib/client/engagement_kind';
import type { TaskKind } from '@/lib/llm/types';

// ─────────────────────────────────────────────────────────────────────────────
// Per-kind LLM task routing + body-length targets
// ─────────────────────────────────────────────────────────────────────────────

const TASK_KIND_BY_APPROVAL: Record<ApprovalKind, TaskKind> = {
  press_release: 'pr_draft_release',
  op_ed: 'pr_draft_release',
  social: 'social_caption',
  commercial: 'commercial_voice'
};

const WORD_TARGET: Record<ApprovalKind, number> = {
  press_release: 350,
  op_ed: 500,
  social: 80,
  commercial: 180
};

const MAX_TOKENS_BY_APPROVAL: Record<ApprovalKind, number> = {
  press_release: 900,
  op_ed: 1100,
  social: 250,
  commercial: 500
};

// ─────────────────────────────────────────────────────────────────────────────
// Brief helpers — read a field with a sensible fallback
// ─────────────────────────────────────────────────────────────────────────────

type BriefBag = Record<string, unknown> | null | undefined;

function fieldOr(brief: BriefBag, key: string, fallback = ''): string {
  const v = brief?.[key];
  return typeof v === 'string' && v.trim() ? v.trim() : fallback;
}

function listOr(brief: BriefBag, key: string, joiner = ' · '): string {
  const v = brief?.[key];
  if (Array.isArray(v)) {
    return v.filter((x) => typeof x === 'string' && x.trim()).join(joiner);
  }
  if (typeof v === 'string') return v.trim();
  return '';
}

/** Compact brief block used in every prompt — the single ground truth so the
 *  model doesn't invent copy. Order: identity → message → support → audience
 *  → differentiators → constraints. Empty fields are skipped so prompts stay
 *  short and the model isn't told "the field is empty" (which it sometimes
 *  echoes literally in the body). */
function buildBriefBlock(brief: BriefBag, clientName: string): string {
  const lines: string[] = [];
  const push = (label: string, value: string) => {
    if (value && value.trim()) lines.push(`- ${label}: ${value.trim()}`);
  };
  push('Brand', clientName);
  push('Principal / contact', fieldOr(brief, 'owner_name') || fieldOr(brief, 'contact_name'));
  push('Industry', fieldOr(brief, 'industry'));
  push('District / territory', fieldOr(brief, 'district') || fieldOr(brief, 'territory') || fieldOr(brief, 'business_state'));
  push('Key message (one line)', fieldOr(brief, 'key_message'));
  push('Supporting proof', fieldOr(brief, 'message_support') || listOr(brief, 'message_support_points'));
  push('Audience insights', fieldOr(brief, 'audience_insights') || listOr(brief, 'audience_insights_list'));
  push('Differentiators', fieldOr(brief, 'differentiators') || listOr(brief, 'differentiators_list'));
  push('Timeline / urgency', fieldOr(brief, 'timeline') || fieldOr(brief, 'urgency'));
  push('Do-not-say / red lines', fieldOr(brief, 'red_lines') || listOr(brief, 'red_lines_list'));
  push('Website', fieldOr(brief, 'website_url') || fieldOr(brief, 'website'));
  // (val 2026-06-10) Political-campaign-specific fields. Picked up only when
  // the brief carries them, so non-political clients see no extra noise.
  push('Candidate', fieldOr(brief, 'candidate_name'));
  push('Office sought', fieldOr(brief, 'office_sought'));
  push('District', fieldOr(brief, 'district_code') || fieldOr(brief, 'district'));
  push('District counties', fieldOr(brief, 'district_counties'));
  push('Party', fieldOr(brief, 'party'));
  push('Primary date', fieldOr(brief, 'primary_date'));
  push('General date', fieldOr(brief, 'general_date'));
  push('Sitting incumbent', fieldOr(brief, 'sitting_incumbent'));
  push('Opponents', fieldOr(brief, 'opponents'));
  push('Stump speech', fieldOr(brief, 'stump_speech'));
  push('Three planks', fieldOr(brief, 'three_planks'));
  push('Local-issue positions', fieldOr(brief, 'positions_local_issues'));
  push('No-go topics', fieldOr(brief, 'no_go_topics'));
  push('Campaign hashtag', fieldOr(brief, 'campaign_hashtag'));
  push('Campaign sign-off', fieldOr(brief, 'campaign_signoff'));
  push('Campaign website', fieldOr(brief, 'campaign_website'));
  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Prompt builders — one per kind. Visible here per val's QC rule. Per-kind
// prompts ground the model in the engagement type (defense_pr is journalist-
// register, political_campaign is district-anchored, etc.).
// ─────────────────────────────────────────────────────────────────────────────

interface PromptArgs {
  title: ApprovalTitle;
  engagementKind: EngagementKind;
  briefBlock: string;
  wordTarget: number;
}

function pressReleasePrompt(a: PromptArgs): string {
  const angleHint =
    a.engagementKind === 'defense_pr'
      ? 'Frame: a federal-prosecution defense story. Lead with the court record fact (acquittal, judge opinion length, procedural posture). Quote the principal sparingly. Voice: an experienced criminal-defense communications director.'
      : a.engagementKind === 'political_campaign'
        ? `Frame: a campaign press release written for LOCAL DISTRICT PRESS. Hard requirements:
  - Name the district in the FIRST sentence (e.g. "Maryland's Third Congressional District")
  - Lead with what THIS WEEK in the district demanded — a school board vote, a plant closure, a court filing, a county council move — not generic campaign rhetoric
  - Quote the candidate by their FULL NAME on first reference, last name after
  - Use "we" when speaking for the district ("we deserve", "our families"), "I" only for the candidate's own commitment
  - End with a clear, simple call to action (visit the campaign website, attend an event, register to vote)
  - Sign off with the campaign disclaimer from brief.campaign_signoff if present
  - NEVER use legalese, NEVER use beltway buzzwords, NEVER reference national party leaders unless the brief explicitly authorizes it
  - Voice: a campaign comms director writing for local print, NOT the candidate's lawyer`
        : a.engagementKind === 'luxury_hospitality'
          ? 'Frame: a luxury-hospitality press release for local press at the next port. Lead with the unique experience the vessel + crew bring. Voice: a luxury-travel PR director.'
          : a.engagementKind === 'book_pr'
            ? 'Frame: a book-launch press release. Lead with the one idea the book changes. Voice: a literary publicist.'
            : 'Frame: an authority-building press release. Voice: a senior brand publicist.';
  return [
    `You are drafting a real press release for the brand below, suitable for sending to a journalist today.`,
    angleHint,
    ``,
    `BRIEF (the only source of truth — do not invent facts):`,
    a.briefBlock,
    ``,
    `CARD TITLE (already approved by the operator): ${a.title.title}`,
    `CARD ANGLE: ${a.title.angle}`,
    `PROVENANCE (which brief fields fed this card): ${a.title.source}`,
    ``,
    `Write ONE press release of about ${a.wordTarget} words.`,
    `Format: FOR IMMEDIATE RELEASE date stub at the top, headline (do not invent a number), 3–5 short paragraphs, one direct quote from the principal (use the principal name from the brief), close with a Contact: line.`,
    `Do NOT include markdown. Do NOT prefix with "Press release:" — just the release text itself.`,
    `If a brief field is empty, simply omit that detail — do not write "[insert X]" or "[TBD]".`
  ].join('\n');
}

function opEdPrompt(a: PromptArgs): string {
  const voice =
    a.engagementKind === 'defense_pr'
      ? "Voice: the principal's first-person voice — a physician/professional defending the public record of their conduct. Calm, factual, signed by the principal."
      : a.engagementKind === 'political_campaign'
        ? `Voice: the candidate's first-person voice. Hard requirements:
  - Open with a SPECIFIC moment in the district (a porch conversation, a county council meeting, a specific local fact), not a national headline
  - The district name appears in the first paragraph
  - Use "I" for the candidate's commitments, "we" when speaking for the district
  - One paragraph (mid-piece) connects the local moment to the national context — never the other way around
  - End with a forward-looking commitment in plain words ("when I'm elected I will…")
  - Sign-off includes the campaign disclaimer if brief.campaign_signoff is present
  - NEVER legalese, NEVER beltway jargon, NEVER mention the opposing party by name unless brief authorizes it
  - Author bio: name + office sought + district. Nothing else.`
        : a.engagementKind === 'book_pr'
          ? "Voice: the author's first-person voice — drawing one specific lesson from the manuscript and connecting it to current events."
          : "Voice: the principal's first-person voice — measured, authoritative.";
  return [
    `You are drafting an op-ed in the principal's first-person voice for a major outlet.`,
    voice,
    ``,
    `BRIEF (the only source of truth):`,
    a.briefBlock,
    ``,
    `CARD TITLE: ${a.title.title}`,
    `CARD ANGLE: ${a.title.angle}`,
    `PROVENANCE: ${a.title.source}`,
    ``,
    `Write ONE op-ed of about ${a.wordTarget} words.`,
    `Format: a working headline on its own line, the by-line ("By <principal name>"), then 6–9 short paragraphs.`,
    `Open with a specific moment or fact (not "In today's world…"). Close with a forward-looking commitment by the principal.`,
    `End with a one-line author bio: who they are + the relevant credential. Below that, list 3-5 target outlets in priority order (newest first).`,
    `Do NOT include markdown. If a brief field is empty, simply omit that detail — never write "[insert X]" or "[TBD]".`
  ].join('\n');
}

function socialPrompt(a: PromptArgs): string {
  const register =
    a.engagementKind === 'defense_pr'
      ? 'Register: journalist-of-record, fact-leading. No emoji. No exclamation points.'
      : a.engagementKind === 'political_campaign'
        ? 'Register: candidate-in-first-person, district-anchored. One hashtag at most (district code or campaign hashtag).'
        : a.engagementKind === 'luxury_hospitality'
          ? 'Register: invitation-card luxury, port-of-call evocative. No emoji. No exclamation points.'
          : a.engagementKind === 'book_pr'
            ? 'Register: literary, idea-leading. Address the reader as "you" once.'
            : 'Register: authoritative, audience-respecting. No marketing-bait phrasing.';
  const platformHint = inferPlatformFromTitle(a.title.title);
  return [
    `You are drafting a single social post for ${platformHint}.`,
    register,
    ``,
    `BRIEF (the only source of truth):`,
    a.briefBlock,
    ``,
    `CARD TITLE: ${a.title.title}`,
    `PROVENANCE: ${a.title.source}`,
    ``,
    `Write ONE post of about ${a.wordTarget} words. No more than ${a.wordTarget + 30} words.`,
    `Lead with a specific fact from the brief. No throat-clearing openings. No "Excited to share…".`,
    `No markdown. No formatting characters except a single line break between paragraphs.`,
    `Output only the post text itself — no quotation marks around it, no "Here's the post:" preamble.`
  ].join('\n');
}

function commercialPrompt(a: PromptArgs): string {
  return [
    `You are drafting a 30-second commercial — voiceover script + a 1-line visual cue per scene.`,
    `Voice: confident, plain-spoken, principal-first.`,
    ``,
    `BRIEF (the only source of truth):`,
    a.briefBlock,
    ``,
    `CARD TITLE: ${a.title.title}`,
    `CARD ANGLE: ${a.title.angle}`,
    `PROVENANCE: ${a.title.source}`,
    ``,
    `Write a 30-second commercial (about ${a.wordTarget} words of VO). Format:`,
    `[Scene 1, 0:00–0:08] visual cue · VO line`,
    `[Scene 2, 0:08–0:18] visual cue · VO line`,
    `[Scene 3, 0:18–0:26] visual cue · VO line`,
    `[Scene 4, 0:26–0:30] visual cue · final VO line + brand sign-off`,
    `Use only facts from the brief. Do NOT invent statistics or quotes.`
  ].join('\n');
}

/** Cheap title sniff so the social prompt knows which platform register to land. */
function inferPlatformFromTitle(title: string): string {
  const t = title.toLowerCase();
  if (t.includes('linkedin')) return 'LinkedIn';
  if (t.includes('facebook')) return 'Facebook';
  if (t.includes('instagram')) return 'Instagram';
  if (t.includes('x post') || t.includes('twitter') || t.startsWith('x ')) return 'X (Twitter)';
  return 'the brand\'s primary social channel';
}

function promptFor(kind: ApprovalKind, args: PromptArgs): string {
  switch (kind) {
    case 'press_release': return pressReleasePrompt(args);
    case 'op_ed':         return opEdPrompt(args);
    case 'social':        return socialPrompt(args);
    case 'commercial':    return commercialPrompt(args);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public entrypoint
// ─────────────────────────────────────────────────────────────────────────────

export interface GenerateCockpitBodiesResult {
  generated: number;
  skipped: number;
  failed: number;
  /** Per-card outcome so the caller (or the visible-prompt UI later) can show
   *  what landed and what didn't. Order matches the title generator's output. */
  details: Array<{
    title: string;
    kind: ApprovalKind;
    outcome: 'generated' | 'skipped' | 'failed';
    approvalId?: number;
    error?: string;
  }>;
}

/**
 * For a given client + engagement kind + brief, generate body text for every
 * card the title generator produces and persist as pending cockpit_approvals
 * rows. Existing rows for the same title are left untouched (operator edits +
 * approvals win).
 *
 * Caller pattern (brief save endpoint):
 *
 *   await saveBriefPayload(...);
 *   // fire-and-forget; never blocks the save response
 *   void generateCockpitBodies({ clientId, engagementKind, brief, clientName });
 */
export async function generateCockpitBodies(params: {
  clientId: number;
  engagementKind: EngagementKind;
  brief: BriefBag;
  clientName: string;
  /** Cap how many cards to actually generate in this run. Defaults to 8. */
  maxCards?: number;
}): Promise<GenerateCockpitBodiesResult> {
  const { clientId, engagementKind, brief, clientName } = params;
  const cap = Math.max(1, Math.min(20, params.maxCards ?? 8));

  const details: GenerateCockpitBodiesResult['details'] = [];
  let generated = 0;
  let skipped = 0;
  let failed = 0;

  // Pull titles from the deterministic generator (same kind-aware shape the
  // cockpit page renders today).
  const titles = cockpitTitlesFor(engagementKind, brief as Record<string, unknown>);

  // Build a set of existing titles so we never overwrite an operator edit or
  // a greenlit row. Idempotency is essential — this runs on every brief save.
  const existing = await listApprovalsForClient(clientId, { status: 'all', limit: 50 });
  const existingTitles = new Set(existing.map((a) => a.title.trim().toLowerCase()));

  const briefBlock = buildBriefBlock(brief, clientName);

  for (const title of titles) {
    if (details.length >= cap) break;

    const normTitle = title.title.trim().toLowerCase();
    if (existingTitles.has(normTitle)) {
      details.push({ title: title.title, kind: title.kind, outcome: 'skipped' });
      skipped += 1;
      continue;
    }

    const taskKind = TASK_KIND_BY_APPROVAL[title.kind];
    const maxTokens = MAX_TOKENS_BY_APPROVAL[title.kind];
    const wordTarget = WORD_TARGET[title.kind];

    const prompt = promptFor(title.kind, {
      title,
      engagementKind,
      briefBlock,
      wordTarget
    });

    try {
      const res = await runLlm({
        taskKind,
        clientId,
        tenantId: 'av',
        prompt,
        maxTokens,
        temperature: title.kind === 'social' ? 0.85 : 0.7,
        note: `cockpit body · ${engagementKind} · ${title.kind} · ${title.angle}`
      });
      const body = (res.text ?? '').trim();
      if (!body) {
        details.push({ title: title.title, kind: title.kind, outcome: 'failed', error: 'empty body' });
        failed += 1;
        continue;
      }
      const approvalId = await createApproval({
        clientId,
        kind: title.kind,
        title: title.title,
        body,
        source: `auto-generated · ${title.source}`,
        angle: title.angle,
        status: 'pending'
      });
      if (approvalId > 0) {
        details.push({ title: title.title, kind: title.kind, outcome: 'generated', approvalId });
        generated += 1;
      } else {
        details.push({ title: title.title, kind: title.kind, outcome: 'failed', error: 'insert returned 0' });
        failed += 1;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[cockpit_body_generator]', clientId, title.kind, msg);
      details.push({ title: title.title, kind: title.kind, outcome: 'failed', error: msg });
      failed += 1;
    }
  }

  return { generated, skipped, failed, details };
}
