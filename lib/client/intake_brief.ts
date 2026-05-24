/**
 * lib/client/intake_brief.ts
 *
 * The bridge from a client's INTAKE answers to their CREATIVE BRIEF + first
 * NARRATIVE LINE. This is how "everything they write is captured" becomes
 * "the brief auto-populates" — instead of re-asking, we read intake_payload.
 *
 * Maps val's canonical 6-question creative brief (see
 * reference_creative_brief_questions in memory) onto the narrative-line fields.
 * Pure + defensive: intake_payload may be an object or a JSON string, and any
 * field may be missing.
 */
import type { NarrativeLineFields } from '@/lib/campaigns/store';

function asObject(raw: unknown): Record<string, unknown> {
  if (raw == null) return {};
  let v: unknown = raw;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return {}; } }
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}
const str = (o: Record<string, unknown>, k: string): string | null => {
  const v = o[k];
  if (typeof v === 'string' && v.trim()) return v.trim();
  if (Array.isArray(v)) { const j = v.map((x) => String(x)).filter(Boolean).join(', '); return j || null; }
  return null;
};
/** First non-empty value among several possible field names (the live intake
 *  form uses different names than our canonical ones — harvest both). */
const pick = (o: Record<string, unknown>, keys: string[]): string | null => {
  for (const k of keys) { const s = str(o, k); if (s) return s; }
  return null;
};
/** Split a free-text field into list items on newlines/semicolons/bullets. */
const list = (s: string | null): string[] =>
  s ? s.split(/[\n;•,]+/).map((x) => x.trim()).filter(Boolean).slice(0, 8) : [];

export interface BriefSeed {
  whyAdvertise: string | null;   // Q1
  goals: string | null;          // Q2
  audience: string | null;       // Q3
  audienceInsights: string | null; // Q4
  keyMessage: string | null;     // Q5 -> thesis
  messageSupport: string | null; // Q6 -> proof
  brandVoice: string | null;
  differentiators: string | null;
  competitors: string | null;
  brandColors: string | null;
  preferredChannels: string | null;
  timeline: string | null;
  /** Ready-to-use seed for createLane(...) — a candidate line from their own words. */
  lineSeed: NarrativeLineFields & { name: string };
}

export function extractBriefSeedFromIntake(intakePayload: unknown): BriefSeed {
  const o = asObject(intakePayload);
  // canonical name first, then the live intake form's real field names as fallback.
  const keyMessage = pick(o, ['key_message', 'market_position']);
  const audience = pick(o, ['target_audience', 'ideal_client']);
  const messageSupport = pick(o, ['message_support', 'proof_points', 'press_awards', 'client_results']);
  const differentiators = pick(o, ['differentiators', 'market_position']);
  const brandVoice = pick(o, ['brand_voice']);
  const timeline = pick(o, ['timeline', 'busy_seasons', 'key_dates']);
  const channels = pick(o, ['preferred_channels', 'content_platforms']);
  const company = str(o, 'company');

  return {
    whyAdvertise: pick(o, ['why_advertise', 'founder_story']),
    goals: pick(o, ['goals', 'website_goals']),
    audience,
    audienceInsights: pick(o, ['audience_insights', 'client_problems', 'client_results']),
    keyMessage,
    messageSupport,
    brandVoice,
    differentiators,
    competitors: pick(o, ['competitors']),
    brandColors: pick(o, ['brand_colors']),
    preferredChannels: channels,
    timeline,
    lineSeed: {
      name: keyMessage ? keyMessage.slice(0, 80) : (company ? `${company} — opening line` : 'Opening narrative line'),
      thesis: keyMessage,
      audience,
      emotionalDriver: brandVoice,
      authorityAngle: differentiators,
      seasonality: timeline,
      proofPoints: list(messageSupport),
      bestChannels: list(channels),
      state: 'candidate' // always lands in the parking lot for review, never auto-active
    }
  };
}
