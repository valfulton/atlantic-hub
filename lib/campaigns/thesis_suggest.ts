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
import { getLane } from '@/lib/campaigns/store';
import { getLineLeadFit, type LineFit } from '@/lib/campaigns/line_fit';
import { openaiChatCompletion, parseOpenAIJson } from '@/lib/openai/client';

const MODEL = 'gpt-4o-mini';
const HOW_MANY = 2; // fewer, sharper choices — operator was discarding >50% of 3.

const SYSTEM = `You are a brand strategist for an AI-native marketing firm.
A "narrative line" is a believable MARKET THESIS (not a slogan, not a tagline): one present-tense sentence asserting a shift in the market that a business can credibly lead and that its prospects already feel.
Good: "Luxury retreats are becoming strategic executive performance assets." / "Local trades are winning on trust, not the lowest bid."
Bad (reject these): generic categories ("Authority & Expertise"), hype ("We are the best"), or vague slogans ("Excellence delivered").
Write theses that speak directly to the prospects' stated pains and the customer's edge. Plural/brand voice. ASCII only, no em-dashes.`;

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

  const painThemes = fit.needs.painThemes.map((p) => `${p.label} (${p.count})`).join(', ') || 'none recorded';
  const industries = fit.needs.industries.map((p) => p.label).join(', ') || 'mixed';
  const keywords = fit.needs.keywords.map((k) => k.label).join(', ') || 'none recorded';

  const user = [
    `Brand/context: ${line.clientId ? 'a client account' : 'Atlantic & Vine (house brand)'} in tenant "${line.tenantId}".`,
    line.thesis ? `Current working thesis (improve on it or offer alternatives): ${line.thesis}` : `No thesis yet.`,
    line.audience ? `Stated audience: ${line.audience}` : '',
    line.authorityAngle ? `Authority angle: ${line.authorityAngle}` : '',
    ``,
    `What this customer's ${fit.totalLeads} leads actually need (from their pipeline):`,
    `- Pain themes: ${painThemes}`,
    `- Industries: ${industries}`,
    `- Recurring words they use: ${keywords}`,
    ``,
    `Propose ${HOW_MANY} distinct narrative-line theses that would genuinely serve these leads' needs and give this brand a defensible position. For each, add a one-line "why" naming the lead need it answers.`,
    `Return ONLY JSON: {"theses":[{"thesis":"...","why":"..."}]}`
  ].filter(Boolean).join('\n');

  return { system: SYSTEM, user, needTerms: needTermsFromFit(fit), totalLeads: fit.totalLeads };
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
