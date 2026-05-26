/**
 * lib/client/intake_fields.ts
 *
 * THE canonical client-intake field set — the single source of truth for the
 * full intake (operator editor + client portal form). Field `key`s match the
 * live marketing form (AV_livewebsite/client-intake.html) so payloads line up
 * and intake extraction (lib/client/intake_extract.ts) reads consistent names.
 *
 * Anti-drift: do not invent intake keys elsewhere. Add a field HERE and both
 * surfaces pick it up. These keys are stored verbatim in the client's brief/
 * intake payload (merged), which is what intake extraction consumes.
 */

export interface IntakeField {
  key: string;
  label: string;
  hint?: string;
  /** render as a multi-line textarea (longer answers) */
  area?: boolean;
}

export interface IntakeGroup {
  group: string;
  fields: IntakeField[];
}

export const INTAKE_GROUPS: IntakeGroup[] = [
  {
    group: 'Business basics',
    fields: [
      { key: 'company', label: 'Company name' },
      { key: 'contact_name', label: 'Contact name' },
      { key: 'phone', label: 'Phone' },
      { key: 'industry', label: 'Industry' },
      { key: 'company_size', label: 'Company size' },
      { key: 'business_description', label: 'Business description', hint: 'What they do, in plain terms', area: true }
    ]
  },
  {
    group: 'Brand & identity',
    fields: [
      { key: 'slogan', label: 'Slogan (if any)' },
      { key: 'has_logo', label: 'Existing logo?', hint: 'Yes / No' },
      { key: 'logo_changes', label: 'If yes, what to change' },
      { key: 'brand_traditional', label: 'Traditional ↔ Modern' },
      { key: 'brand_friendly', label: 'Friendly ↔ Corporate' },
      { key: 'brand_pricing', label: 'High-end ↔ Cost-effective' },
      { key: 'brand_colors', label: 'Preferred colors' },
      { key: 'brand_voice', label: 'Brand voice', hint: 'How the brand should sound' }
    ]
  },
  {
    group: 'Audience & ideal client',
    fields: [
      { key: 'ideal_client', label: 'Who is your ideal client?', area: true },
      { key: 'geo_focus', label: 'Geographic focus' },
      { key: 'target_audience', label: 'Target audience (if different)', area: true },
      { key: 'client_problems', label: 'What problems do you solve?', area: true },
      { key: 'audience_insights', label: 'What do you know about them?', area: true }
    ]
  },
  {
    group: 'Positioning & message',
    fields: [
      { key: 'founder_story', label: 'Why does this business exist?', area: true },
      { key: 'key_message', label: 'The ONE thing they should remember', area: true },
      { key: 'market_position', label: 'How do you want to be positioned?', area: true },
      { key: 'differentiators', label: 'What sets you apart from competitors?', area: true },
      { key: 'competitors', label: 'Main competitors' },
      { key: 'why_advertise', label: 'What are you hoping to achieve right now?', area: true },
      { key: 'goals', label: 'What would success look like in 90 days?', area: true }
    ]
  },
  {
    group: 'Proof & credibility',
    fields: [
      { key: 'client_results', label: 'What results do you get clients?', area: true },
      { key: 'proof_points', label: 'Why should customers believe it?', area: true },
      { key: 'notable_clients', label: 'Notable clients / names we can drop' },
      { key: 'press_awards', label: 'Press, awards, or certifications' },
      { key: 'message_support', label: 'Favorite results or testimonials', area: true }
    ]
  },
  {
    group: 'PR & authority',
    fields: [
      { key: 'pr_goals', label: 'What kind of visibility are you after?', area: true },
      { key: 'pr_expert_topics', label: 'What can you speak about as an authority?', area: true },
      { key: 'pr_dream_outlets', label: 'Dream outlets or stages' },
      { key: 'pr_spokesperson', label: 'Who is your spokesperson?' },
      { key: 'pr_news_hooks', label: 'Upcoming news, launches, or milestones?', area: true },
      { key: 'pr_responsive', label: 'Available for fast-turnaround interviews/quotes?' }
    ]
  },
  {
    group: 'Web, content & lead-gen',
    fields: [
      { key: 'has_website', label: 'Existing website?', hint: 'Yes / No' },
      { key: 'website_url', label: "Website URL (if yes)" },
      { key: 'website_goals', label: 'What should the website accomplish?', area: true },
      { key: 'content_platforms', label: 'Platforms you want content for' },
      { key: 'content_frequency', label: 'Content frequency' },
      { key: 'preferred_channels', label: 'Where do your customers spend time?' },
      { key: 'current_leadgen', label: 'Current lead-generation methods' },
      { key: 'ad_budget', label: 'Budget for paid ads?', hint: 'Yes / No' }
    ]
  },
  {
    group: 'Logistics',
    fields: [
      { key: 'busy_seasons', label: 'Your busy seasons' },
      { key: 'key_dates', label: 'Key dates or deadlines' },
      { key: 'timeline', label: 'Timeline expectations', hint: 'Project timeline (not seasonality)' },
      { key: 'budget', label: 'Estimated budget' },
      { key: 'assets_link', label: 'Link to logos / photos / brand assets' },
      { key: 'additional_info', label: 'Anything else we should know?', area: true }
    ]
  }
];

/** Flat list of every canonical intake key. */
export const INTAKE_KEYS: string[] = INTAKE_GROUPS.flatMap((g) => g.fields.map((f) => f.key));
