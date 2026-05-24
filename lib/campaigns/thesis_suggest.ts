/**
 * lib/campaigns/thesis_suggest.ts
 *
 * Propose NEW narrative-line theses grounded in what the owner's leads actually
 * need. This is the synthesis step beyond the raw "what your leads need" chips:
 * it reads the lead pain themes / industries / recurring words and writes 2-4
 * sharp, believable market theses the operator can accept into the line.
 *
 * One small LLM call, on demand (operator clicks "Suggest"). Cheap (gpt-4o-mini).
 * Returns [] on any failure so the UI degrades gracefully.
 */
import { getLane } from '@/lib/campaigns/store';
import { getLineLeadFit } from '@/lib/campaigns/line_fit';
import { openaiChatCompletion, parseOpenAIJson } from '@/lib/openai/client';

const MODEL = 'gpt-4o-mini';

const SYSTEM = `You are a brand strategist for an AI-native marketing firm.
A "narrative line" is a believable MARKET THESIS (not a slogan, not a tagline): one present-tense sentence asserting a shift in the market that a business can credibly lead and that its prospects already feel.
Good: "Luxury retreats are becoming strategic executive performance assets." / "Local trades are winning on trust, not the lowest bid."
Bad (reject these): generic categories ("Authority & Expertise"), hype ("We are the best"), or vague slogans ("Excellence delivered").
Write theses that speak directly to the prospects' stated pains and the customer's edge. Plural/brand voice. ASCII only, no em-dashes.`;

export interface ThesisSuggestion {
  thesis: string;
  why: string; // one short line: which lead need it answers
}

export async function suggestThesesForLine(lineId: number): Promise<ThesisSuggestion[]> {
  const line = await getLane(lineId);
  if (!line) return [];
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
    `Propose 3 distinct narrative-line theses that would genuinely serve these leads' needs and give this brand a defensible position. For each, add a one-line "why" naming the lead need it answers.`,
    `Return ONLY JSON: {"theses":[{"thesis":"...","why":"..."}]}`
  ].filter(Boolean).join('\n');

  try {
    const completion = await openaiChatCompletion(
      [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: user }
      ],
      { json: true, temperature: 0.8, maxTokens: 700, model: MODEL }
    );
    const parsed = parseOpenAIJson<{ theses?: Array<{ thesis?: unknown; why?: unknown }> }>(completion.text);
    const out: ThesisSuggestion[] = [];
    for (const t of parsed?.theses ?? []) {
      const thesis = typeof t.thesis === 'string' ? t.thesis.trim() : '';
      if (!thesis) continue;
      out.push({ thesis: thesis.slice(0, 280), why: typeof t.why === 'string' ? t.why.trim().slice(0, 200) : '' });
      if (out.length >= 4) break;
    }
    return out;
  } catch {
    return [];
  }
}
