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
  return typeof v === 'string' && v.trim() ? v.trim() : null;
};
/** Split a free-text field into list items on newlines/semicolons/bullets. */
const list = (s: string | null): string[] =>
  s ? s.split(/[\n;•]+/).map((x) => x.trim()).filter(Boolean).slice(0, 8) : [];

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
  const keyMessage = str(o, 'key_message');
  const audience = str(o, 'target_audience');
  const messageSupport = str(o, 'message_support');
  const differentiators = str(o, 'differentiators');
  const brandVoice = str(o, 'brand_voice');
  const timeline = str(o, 'timeline');
  const channels = str(o, 'preferred_channels');
  const company = str(o, 'company');

  return {
    whyAdvertise: str(o, 'why_advertise'),
    goals: str(o, 'goals'),
    audience,
    audienceInsights: str(o, 'audience_insights'),
    keyMessage,
    messageSupport,
    brandVoice,
    differentiators,
    competitors: str(o, 'competitors'),
    brandColors: str(o, 'brand_colors'),
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
