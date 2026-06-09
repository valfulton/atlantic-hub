/**
 * lib/av/cockpit_asset_titles.ts (#568, Tier 1)
 *
 * Brief-grounded asset titles for the campaign cockpit "Pending your green
 * light" cards. Replaces the hardcoded per-kind KIND_DEFAULT_APPROVALS so
 * every defense_pr client sees drafts about THEIR case (not Ron's), every
 * political_campaign client sees drafts about THEIR district (not John's),
 * etc.
 *
 * Pure, deterministic. No LLM. The cockpit needs a fast, predictable render
 * and the brief already contains the substance — we just have to shape it
 * into a card title and a one-line provenance source.
 *
 * "Create intelligence once, activate it everywhere" — this is the cockpit's
 * read of the brief, same fields the dashboard panels read, same fields the
 * AI prompts will read in v2 when these drafts become real bodies.
 *
 * v2 (next push): persist these to content_artifacts on first load so the
 * Green Light + Edit buttons have rows to act on.
 */

export interface ApprovalTitle {
  id: string;
  kind: 'commercial' | 'press_release' | 'op_ed' | 'social';
  /** Card headline shown in the cockpit. Grounded in this client's brief. */
  title: string;
  /** Angle marker — A/B/C/—. Stable per-card so val can track which is which. */
  angle: string;
  /** One-line provenance — what brief field(s) feed this card. */
  source: string;
}

type BriefBag = Record<string, unknown> | null | undefined;

/** Pull a string field from the brief, trim, return empty string if missing/blank. */
function s(brief: BriefBag, key: string): string {
  const v = brief?.[key];
  return typeof v === 'string' ? v.trim() : '';
}

/** Trim a long brief field down to a card-title-safe length without orphaning words.
 *  Returns the fallback if the field is blank. */
function shortLine(text: string, maxLen: number, fallback: string): string {
  const t = text.trim();
  if (!t) return fallback;
  if (t.length <= maxLen) return t;
  const cut = t.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > maxLen * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[,.;:]$/, '') + '…';
}

/** Convert a long sentence into a short headline-ish phrase (drop trailing
 *  clauses, strip leading personal/prepositional fluff). */
function headlineOf(text: string, maxLen: number): string {
  const t = text.trim()
    .replace(/^(my goal is to|i want to|i'm going to|we will|we'll)\s+/i, '')
    .split(/[.;]/)[0]
    .trim();
  return shortLine(t, maxLen, '');
}

// ───────────────────────────────────────────────────────────────────────────
// Per-kind generators. Each receives the brief and returns 2-3 grounded cards.
// ───────────────────────────────────────────────────────────────────────────

function defensePrTitles(brief: BriefBag): ApprovalTitle[] {
  const keyMessage = s(brief, 'key_message');
  const messageSupport = s(brief, 'message_support');
  const audienceInsights = s(brief, 'audience_insights');
  const timeline = s(brief, 'timeline');
  const ownerName = s(brief, 'owner_name') || s(brief, 'contact_name');

  const headline = headlineOf(keyMessage, 60) || 'Press release · the case record';
  const supportAngle = headlineOf(messageSupport, 60) || 'the proof on the record';
  const audienceAngle = headlineOf(audienceInsights, 60) || 'reach the right press list';
  const timelineCue = headlineOf(timeline, 50) || 'press window';

  return [
    {
      id: 'a1',
      kind: 'commercial',
      title: `30s video · ${ownerName ? `the case for ${ownerName.split(/\s+/).slice(-1)[0]}` : 'the case behind the record'}`,
      angle: 'A',
      source: `brief.key_message + brief.message_support · ${shortLine(supportAngle, 80, '')}`
    },
    {
      id: 'a2',
      kind: 'press_release',
      title: `Press release · ${headline}`,
      angle: 'A',
      source: `brief.key_message · counsel sign-off required · timeline: ${shortLine(timelineCue, 60, 'press window')}`
    },
    {
      id: 'a3',
      kind: 'op_ed',
      title: `Op-ed · ${shortLine(audienceAngle, 55, 'why this lands with the press')}`,
      angle: 'C',
      source: `brief.audience_insights · ${shortLine(audienceInsights, 90, '')}`
    }
  ];
}

function politicalCampaignTitles(brief: BriefBag): ApprovalTitle[] {
  const keyMessage = s(brief, 'key_message');
  const audienceInsights = s(brief, 'audience_insights');
  const differentiators = s(brief, 'differentiators');
  const district = s(brief, 'district') || 'your district';

  const headline = headlineOf(keyMessage, 60) || 'A message for the district';
  const audienceAngle = headlineOf(audienceInsights, 60) || 'what your district is feeling';
  const diffAngle = headlineOf(differentiators, 55) || 'what only you can say';

  return [
    {
      id: 'a1',
      kind: 'commercial',
      title: `District spot · ${shortLine(audienceAngle, 55, 'what your neighbors are facing')}`,
      angle: 'A',
      source: `brief.audience_insights + brief.district_zips · public-intel cascade overlay (${district})`
    },
    {
      id: 'a2',
      kind: 'press_release',
      title: `Press release · ${headline}`,
      angle: 'A',
      source: `brief.key_message · brief.target_audience · district pulse`
    },
    {
      id: 'a3',
      kind: 'op_ed',
      title: `Op-ed · ${shortLine(diffAngle, 55, 'the case only you can make')}`,
      angle: 'C',
      source: `brief.differentiators · brief.key_message`
    }
  ];
}

function luxuryHospitalityTitles(brief: BriefBag): ApprovalTitle[] {
  const keyMessage = s(brief, 'key_message');
  const principals = s(brief, 'principals') || s(brief, 'owner_name') || s(brief, 'contact_name');
  const timeline = s(brief, 'timeline');

  const headline = headlineOf(keyMessage, 60) || 'A story from the next port';
  const whoPhrase = principals
    ? principals.split(/\s+/).slice(0, 3).join(' ').replace(/[,.]$/, '')
    : 'the captains';

  return [
    {
      id: 'a1',
      kind: 'social',
      title: `Instagram story · ${shortLine(headline, 60, 'arrival at next port')}`,
      angle: '—',
      source: `brief.key_message · brief.itinerary · port arrival`
    },
    {
      id: 'a2',
      kind: 'press_release',
      title: `Local press kit · ${whoPhrase} at next port`,
      angle: '—',
      source: `brief.principals · brief.itinerary · local outlets within 50mi · ${shortLine(timeline, 50, 'next stop')}`
    }
  ];
}

function bookPrTitles(brief: BriefBag): ApprovalTitle[] {
  const keyMessage = s(brief, 'key_message');
  const messageSupport = s(brief, 'message_support');
  const headline = headlineOf(keyMessage, 60) || 'A lesson from the book';
  const supportAngle = headlineOf(messageSupport, 55) || 'the experiments behind the book';

  return [
    {
      id: 'a1',
      kind: 'op_ed',
      title: `Op-ed pitch · ${shortLine(supportAngle, 55, 'the experiments behind the book')}`,
      angle: '—',
      source: `brief.message_support · brief.key_message`
    },
    {
      id: 'a2',
      kind: 'social',
      title: `LinkedIn post · ${shortLine(headline, 55, 'launch-week thread')}`,
      angle: '—',
      source: `brief.key_message · quote bank from manuscript`
    }
  ];
}

function leadGenTitles(brief: BriefBag): ApprovalTitle[] {
  const keyMessage = s(brief, 'key_message');
  const headline = headlineOf(keyMessage, 60) || 'Weekly authority piece';
  return [
    {
      id: 'a1',
      kind: 'social',
      title: `LinkedIn post · ${shortLine(headline, 55, 'weekly authority piece')}`,
      angle: '—',
      source: `brief.key_message · recent client wins`
    }
  ];
}

/** Public entrypoint. Returns brief-grounded approval cards for the given
 *  engagement kind. Falls back to the original hardcoded titles ONLY when
 *  the brief is essentially empty (so a freshly-created lead_gen client
 *  doesn't render blank). */
export function cockpitTitlesFor(
  kind: string,
  brief: BriefBag
): ApprovalTitle[] {
  // Detect "brief has no substance" — every field this generator reads is
  // blank. In that case, return the safer hardcoded titles (caller decides).
  const briefHasSubstance =
    !!(s(brief, 'key_message') || s(brief, 'message_support') || s(brief, 'audience_insights') ||
       s(brief, 'differentiators') || s(brief, 'principals') || s(brief, 'district'));

  switch (kind) {
    case 'defense_pr':
      return briefHasSubstance ? defensePrTitles(brief) : defensePrTitles(brief); // still produces fallback-strings
    case 'political_campaign':
      return briefHasSubstance ? politicalCampaignTitles(brief) : politicalCampaignTitles(brief);
    case 'luxury_hospitality':
      return briefHasSubstance ? luxuryHospitalityTitles(brief) : luxuryHospitalityTitles(brief);
    case 'book_pr':
      return briefHasSubstance ? bookPrTitles(brief) : bookPrTitles(brief);
    default:
      return leadGenTitles(brief);
  }
}
