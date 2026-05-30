/**
 * lib/campaigns/thesis_suggest.ts
 *
 * Propose NEW narrative-line theses grounded in what the owner's leads actually
 * need. This is the synthesis step beyond the raw "what your leads need" chips:
 * it reads the lead pain themes / industries / recurring words and writes sharp,
 * believable market theses the operator can accept into the line.
 *
 * Two-step so the operator stays in control + spend stays visible:
 *   1. buildThesisSuggestPrompt(lineId) -> the exact editable prompt, NO LLM cost.
 *   2. suggestThesesForLine(lineId, { customPrompt }) -> one small LLM call
 *      (gpt-4o-mini), returns 2 theses, each SCORED for fit against the leads.
 *
 * Returns [] on any failure so the UI degrades gracefully.
 */
import { getLane, listLanes, type NarrativeLane } from '@/lib/campaigns/store';
import { getLineLeadFit, type LineFit } from '@/lib/campaigns/line_fit';
import { getBriefForPrompt } from '@/lib/client/brief_store';
import { getSystemPrompt } from '@/lib/ai/prompt_registry';
import { openaiChatCompletion, parseOpenAIJson } from '@/lib/openai/client';

const MODEL = 'gpt-4o-mini';
const HOW_MANY = 2; // fewer, sharper choices — operator was discarding >50% of 3.

export interface ThesisSuggestion {
  thesis: string;
  why: string;               // one short line: which lead need it answers
  fitScore: number;          // # of distinct lead-need terms the thesis hits
  matchedTerms: string[];    // which need terms it matched (the "why it fits")
  band: 'strong' | 'good' | 'light' | 'loose'; // drives color + sparkle in the UI
}

/** Build the editable user prompt for a line — pure, no LLM call. */
export async function buildThesisSuggestPrompt(
  lineId: number
): Promise<{ system: string; user: string; needTerms: string[]; totalLeads: number } | null> {
  const line = await getLane(lineId);
  if (!line) return null;
  const fit = await getLineLeadFit(lineId);

  // Ground on the brand's OWN identity (its creative brief) instead of a hardcoded
  // "Atlantic & Vine" label — so EBW / HH / each client account speak as themselves.
  const brief = await getBriefForPrompt({ tenantId: line.tenantId, clientId: line.clientId });

  // (#76) Pull the OTHER narrative lines for this same owner so we can tell the
  // suggester "make this line DIFFERENT from those". Without this, two lines
  // for the same owner that both lack a thesis get identical prompts and the
  // LLM returns identical suggestions for each — the bug val caught. Include
  // archived/inactive too so newly-spawned lines don't accidentally collide
  // with retired ones that are still living in the operator's head.
  const siblings = (
    await listLanes(line.tenantId, { includeInactive: true, clientId: line.clientId ?? null })
  ).filter((sib) => sib.id !== line.id);

  const painThemes = fit.needs.painThemes.map((p) => `${p.label} (${p.count})`).join(', ') || 'none recorded';
  const industries = fit.needs.industries.map((p) => p.label).join(', ') || 'mixed';
  const keywords = fit.needs.keywords.map((k) => k.label).join(', ') || 'none recorded';

  // (#76) The line's full per-line identity — every field that distinguishes
  // THIS line from a sibling. The previous prompt only included thesis +
  // audience + authority_angle, dropping ~8 fields the operator can curate
  // (name, description, emotional driver, seasonality, conversion signal,
  // proof points, channels, do_say, dont_say). When all three of the
  // previously-included fields were empty (the common case at suggestion
  // time), prompts collapsed to identical strings across sibling lines.
  const thisLineBlock = buildLineFingerprint(line);
  const siblingBlock = buildSiblingContrastBlock(siblings);

  const user = [
    brief.block,
    ``,
    `Tenant: "${line.tenantId}". This is ${line.clientId ? 'a client account' : "one of the firm's own house brands"}.`,
    ``,
    `THIS NARRATIVE LINE (the one you are proposing theses FOR):`,
    thisLineBlock,
    ``,
    siblingBlock,
    `What this customer's ${fit.totalLeads} leads actually need (from their pipeline):`,
    `- Pain themes: ${painThemes}`,
    `- Industries: ${industries}`,
    `- Recurring words they use: ${keywords}`,
    ``,
    `Propose ${HOW_MANY} distinct narrative-line theses that speak AS ${brief.brandName}, would genuinely serve these leads' needs, and give this brand a defensible position WITHIN THIS LINE'S identity (the line's name + emotional driver + channels + do_say/dont_say above are anchors — your theses should sound like that line, not a generic version of the brand). Where sibling lines exist above, your theses must occupy DIFFERENT territory from them — no overlap with sibling theses. For each, add a one-line "why" naming the lead need it answers AND how it differs from the siblings.`,
    `Return ONLY JSON: {"theses":[{"thesis":"...","why":"..."}]}`
  ].filter(Boolean).join('\n');

  const system = await getSystemPrompt('thesis_suggester');
  return { system, user, needTerms: needTermsFromFit(fit), totalLeads: fit.totalLeads };
}

/**
 * (#76) The fingerprint of THIS line — every field that's been curated so far.
 * Skips empty fields so a freshly-spawned line doesn't show a wall of "(empty)"
 * placeholders, while still differing from a sibling that has different fields.
 */
function buildLineFingerprint(line: NarrativeLane): string {
  const parts: string[] = [];
  parts.push(`- name: "${line.name}"`);
  if (line.description) parts.push(`- description: ${line.description}`);
  if (line.state) parts.push(`- state: ${line.state}`);
  if (line.cadenceHint) parts.push(`- cadence: ${line.cadenceHint}`);
  if (line.thesis) parts.push(`- current working thesis (improve on it or offer alternatives): ${line.thesis}`);
  else parts.push(`- current thesis: (none yet — propose fresh)`);
  if (line.audience) parts.push(`- audience: ${line.audience}`);
  if (line.emotionalDriver) parts.push(`- emotional driver: ${line.emotionalDriver}`);
  if (line.authorityAngle) parts.push(`- authority angle: ${line.authorityAngle}`);
  if (line.seasonality) parts.push(`- seasonality / timing: ${line.seasonality}`);
  if (line.conversionSignal) parts.push(`- conversion signal: ${line.conversionSignal}`);
  if (line.proofPoints.length > 0) parts.push(`- proof points: ${line.proofPoints.join(' | ')}`);
  if (line.bestChannels.length > 0) parts.push(`- best channels: ${line.bestChannels.join(', ')}`);
  if (line.doSay.length > 0) parts.push(`- DO say: ${line.doSay.join(' | ')}`);
  if (line.dontSay.length > 0) parts.push(`- DO NOT say: ${line.dontSay.join(' | ')}`);
  return parts.join('\n');
}

/**
 * (#76) The "make-it-different" guard — list of sibling lines' theses so the
 * LLM can avoid duplicating territory. Returns '' when this is the only line
 * for the owner, so single-line briefs don't carry dead text.
 */
function buildSiblingContrastBlock(siblings: NarrativeLane[]): string {
  if (siblings.length === 0) return '';
  const lines: string[] = ['OTHER NARRATIVE LINES this owner ALREADY runs (your proposals must NOT overlap with these — claim different territory):'];
  for (const sib of siblings) {
    const bits: string[] = [`"${sib.name}"`];
    if (sib.state) bits.push(`[${sib.state}]`);
    if (sib.thesis) bits.push(`— thesis: ${sib.thesis}`);
    else bits.push(`— no thesis set yet`);
    if (sib.audience) bits.push(`— audience: ${sib.audience}`);
    if (sib.authorityAngle) bits.push(`— authority: ${sib.authorityAngle}`);
    lines.push(`- ${bits.join(' ')}`);
  }
  lines.push('');
  return lines.join('\n');
}

export async function suggestThesesForLine(
  lineId: number,
  opts: { customPrompt?: string } = {}
): Promise<ThesisSuggestion[]> {
  const built = await buildThesisSuggestPrompt(lineId);
  if (!built) return [];
  const user = opts.customPrompt && opts.customPrompt.trim() ? opts.customPrompt.trim() : built.user;

  try {
    const completion = await openaiChatCompletion(
      [
        { role: 'system', content: built.system },
        { role: 'user', content: user }
      ],
      { json: true, temperature: 0.8, maxTokens: 600, model: MODEL }
    );
    const parsed = parseOpenAIJson<{ theses?: Array<{ thesis?: unknown; why?: unknown }> }>(completion.text);
    const out: ThesisSuggestion[] = [];
    for (const t of parsed?.theses ?? []) {
      const thesis = typeof t.thesis === 'string' ? t.thesis.trim() : '';
      if (!thesis) continue;
      const why = typeof t.why === 'string' ? t.why.trim().slice(0, 200) : '';
      const { matchedTerms, band } = scoreThesisFit(thesis, built.needTerms);
      out.push({ thesis: thesis.slice(0, 280), why, fitScore: matchedTerms.length, matchedTerms, band });
      if (out.length >= HOW_MANY) break;
    }
    // Best fit first so the operator's eye lands on the strongest option.
    out.sort((a, b) => b.fitScore - a.fitScore);
    return out;
  } catch {
    return [];
  }
}

// ---- fit scoring (pure, no API cost) --------------------------------------

const SCORE_STOP = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'their', 'your', 'from', 'into', 'are', 'our',
  'who', 'what', 'when', 'will', 'have', 'has', 'they', 'them', 'about', 'more', 'less',
  'business', 'businesses', 'company', 'companies', 'team', 'teams', 'becoming', 'become'
]);

/** Lowercase -> 4+ letter words, light de-pluralize, drop stopwords. */
function tokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.toLowerCase().matchAll(/[a-z]{4,}/g)) {
    let w = m[0];
    if (w.length > 4 && w.endsWith('s')) w = w.slice(0, -1);
    if (!SCORE_STOP.has(w)) out.add(w);
  }
  return out;
}

/** The need terms a thesis should try to hit, drawn from the leads' own words. */
function needTermsFromFit(fit: LineFit): string[] {
  const labels = [
    ...fit.needs.painThemes.map((p) => p.label),
    ...fit.needs.keywords.map((k) => k.label),
    ...fit.needs.industries.map((i) => i.label)
  ];
  const set = new Set<string>();
  for (const label of labels) for (const tok of tokens(label.replace(/_/g, ' '))) set.add(tok);
  return [...set];
}

function scoreThesisFit(thesis: string, needTerms: string[]): { matchedTerms: string[]; band: ThesisSuggestion['band'] } {
  const tt = tokens(thesis);
  const matched = needTerms.filter((t) => tt.has(t));
  // If there were no need terms to match (thin pipeline), don't punish — call it 'good'.
  const band: ThesisSuggestion['band'] =
    needTerms.length === 0 ? 'good'
      : matched.length >= 3 ? 'strong'
        : matched.length === 2 ? 'good'
          : matched.length === 1 ? 'light'
            : 'loose';
  return { matchedTerms: matched.slice(0, 6), band };
}
