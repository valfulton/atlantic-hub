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
 *
 * (#200) Field-level metadata enriched:
 *   - `example` -> placeholder text shown inside the input (Fix 2)
 *   - `why`     -> one-line caption telling the client/operator what filling
 *                  this field actually powers (Fix 3)
 *   - `clientFacing` -> when true, this field renders on the client-portal
 *                       intake form (`/client/intake`). When false/undefined,
 *                       it's operator-only. This eliminates the silent drift
 *                       where the client form previously had its own local
 *                       question list with only ~12 of 50 fields.
 *
 * (#200 Fix 1) Question wording: abstract "What is your X?" prompts are
 * replaced with forcing-function scenarios — concrete moments the client
 * already recognizes from their work. Busy people answer scenarios; they
 * skip self-reflection.
 */

import type { EngagementKind } from './engagement_kind';

export interface IntakeField {
  key: string;
  label: string;
  hint?: string;
  /** Placeholder example shown inside the input/textarea (Fix 2). */
  example?: string;
  /** One-line caption showing what filling this field powers (Fix 3). */
  why?: string;
  /** Render as a multi-line textarea (longer answers). */
  area?: boolean;
  /** When true, render on the client-portal intake form. (#200) */
  clientFacing?: boolean;
  /** (#551) Restrict this field to specific engagement kinds. Omit = ask for
   *  every kind (today's behavior — all current fields are kind-agnostic).
   *  e.g. tag deal-economics fields kinds:['lead_gen'] so a defense_pr intake
   *  doesn't ask Ron about close rates. */
  kinds?: EngagementKind[];
  /** (val 2026-06-10) Exclude this field for specific kinds. Mirror of `kinds`
   *  for the common case where a field should be asked for MOST kinds but NOT
   *  one. e.g. business-brand color questions are asked for every kind except
   *  political_campaign, which has its own separate campaign-brand fields. */
  excludeKinds?: EngagementKind[];
}

export interface IntakeGroup {
  group: string;
  fields: IntakeField[];
  /** (val 2026-06-10) Hide the entire group for these engagement kinds. Cleaner
   *  than tagging excludeKinds on every field. Used to hide business-economics
   *  groups from political_campaign clients without having to tag each field. */
  excludeKinds?: EngagementKind[];
  /** Mirror — show the entire group ONLY for these kinds. */
  kinds?: EngagementKind[];
}

export const INTAKE_GROUPS: IntakeGroup[] = [
  {
    group: 'Business basics',
    fields: [
      { key: 'company',      label: 'Company name', clientFacing: true },
      { key: 'contact_name', label: 'Contact name', clientFacing: true },
      { key: 'phone',        label: 'Phone',        clientFacing: true },
      { key: 'industry',     label: 'Industry',     clientFacing: true,
        hint: 'The category a stranger would use to find you.',
        why: 'Used to find the right prospects to discover for you, and to set the audit’s vocabulary.' },
      { key: 'company_size', label: 'Company size',  clientFacing: true,
        hint: 'Just me / 2-10 / 11-50 / 51-200 / 201-500 / 500+',
        why: 'Helps us match you to prospects of comparable size.' },
      { key: 'business_description', label: 'In one sentence, what do you actually do?', area: true, clientFacing: true,
        hint: 'Plain English. Skip the buzzwords. Pattern: "We help [who] achieve [outcome] through [how]."',
        why: 'Anchors every lead audit, call script, and outreach email so they reflect what you really sell.' },
      // (#540, val 2026-06-08) KYC + identity fields — were operator-only
      // before; now first-class intake questions so they get captured during
      // intake instead of forcing val to retype them on Account Info.
      // clientFacing: true so they appear on the intake form Adriana fills out.
      { key: 'owner_name', label: 'Legal owner name', clientFacing: true,
        hint: 'The name on incorporation docs / tax returns. May be same as contact name.',
        why: 'Public-record screens (court filings, business registrations) search the legal owner, not always the day-to-day contact.' },
      { key: 'business_state', label: 'Business state (2-letter)', clientFacing: true,
        hint: 'e.g. CA, GA, NY — where the entity is registered.',
        why: 'Scopes federal court + consumer complaint searches to your jurisdiction.' },
      { key: 'business_address', label: 'Business address', clientFacing: true,
        hint: 'Street + city + state + ZIP. Principal office.',
        why: 'Drives the market-stress screen (HMDA mortgage data, county records) and per-property lookups.' }
    ]
  },
  {
    group: 'Brand & identity',
    // (val 2026-06-10) Business brand has nothing to do with political brand.
    // John's Compass Marketing brand ≠ his campaign brand. Hide this whole
    // group for political_campaign; they get the Campaign brand group instead.
    excludeKinds: ['political_campaign'],
    fields: [
      { key: 'slogan', label: 'Your one-line tagline (if you have one)', clientFacing: true,
        hint: 'A sentence a stranger could repeat to a friend.',
        why: 'Anchors the voice in your outreach and on the lead audit.' },
      { key: 'has_logo',     label: 'Existing logo?', hint: 'Yes / No', clientFacing: true },
      { key: 'logo_changes', label: 'If yes, anything you’d change about it?', clientFacing: true,
        hint: 'Optional. e.g. "modernize the font" or "keep mark, lose tagline".' },
      { key: 'brand_traditional', label: 'Traditional or Modern?', clientFacing: true,
        hint: 'Traditional / Modern / In between' },
      { key: 'brand_friendly',    label: 'Friendly or Corporate?', clientFacing: true,
        hint: 'Friendly / Corporate / In between' },
      { key: 'brand_pricing',     label: 'High-end or Cost-effective?', clientFacing: true,
        hint: 'High-end / Cost-effective / In between' },
      { key: 'brand_colors', label: 'Brand colors (if you have them)', clientFacing: true,
        hint: 'Names or hex codes. e.g. "navy + gold" or "#0a1f3d, #d4a253"',
        why: 'Used when we brand assets (commercials, social cards, blog headers) on your behalf.' },
      { key: 'brand_voice', label: 'In three words, how should your brand sound on a call?', clientFacing: true,
        hint: 'Three adjectives. e.g. "warm, confident, direct" or "playful, refined, generous"',
        why: 'Sets the tone for cold emails and call scripts so they sound like you, not generic SaaS.' }
    ]
  },
  {
    group: 'Audience & ideal client',
    // (val 2026-06-10) Political campaign has voters, not ICP customers. The
    // district + planks fields cover the political equivalent.
    excludeKinds: ['political_campaign'],
    fields: [
      { key: 'ideal_client', label: 'Describe your IDEAL customer in one sentence.', area: true, clientFacing: true,
        hint: 'A specific person, not a category. Title, company size, industry, situation.',
        why: 'Drives who our Find-leads engine searches for. The more specific, the better the matches.' },
      { key: 'geo_focus',    label: 'Where do you sell?', clientFacing: true,
        hint: 'Cities, states, countries — wherever you can actually deliver.',
        why: 'Filters discovered prospects to your territory and gives lead audits local market context.' },
      { key: 'target_audience', label: 'If different from your ideal customer, who else?', area: true, clientFacing: true,
        hint: 'Sometimes the buyer and the influencer aren’t the same person (e.g. you sell to HR but the CFO signs).' },
      { key: 'client_problems', label: 'Fill in the blank: "My customers come to me when ___"', area: true, clientFacing: true,
        hint: 'The actual moment they pick up the phone — a deadline, an alert, a frustration.',
        why: 'Tells our call scripts what objection to expect and what trigger to mirror.' },
      { key: 'audience_insights', label: 'What does your ideal customer believe that most of their peers don’t?', area: true, clientFacing: true,
        hint: 'One belief or insight that separates the buyer from the skeptic.',
        why: 'Shapes the angle our outreach takes — leads with their worldview, not ours.' }
    ]
  },
  {
    group: 'Positioning & message',
    fields: [
      { key: 'founder_story', label: 'In one sentence: what made you start this work?', area: true, clientFacing: true,
        hint: 'The original moment, not a polished bio.',
        why: 'Gives your brand a human anchor in any PR or thought-leadership content.' },
      { key: 'key_message', label: 'If a prospect remembers ONE sentence from your pitch, what is it?', area: true, clientFacing: true,
        hint: 'One sentence. The line you’d say at the end of a discovery call.',
        why: 'Becomes the thesis of your narrative line and the line we lean on in every drafted email.' },
      { key: 'market_position', label: 'How do you want prospects to see you vs. the alternatives?', area: true, clientFacing: true,
        hint: 'The thing only you can credibly say.',
        why: 'Shapes your positioning in PR pitches and content.' },
      { key: 'differentiators', label: 'A buyer just asked "we already have what you sell — why you?" What’s your one-line answer?', area: true, clientFacing: true,
        hint: 'No marketing fluff. The actual sentence you’d say in the meeting.',
        why: 'Becomes the audit’s "what makes them different" line and the outreach’s lead hook.' },
      { key: 'competitors', label: 'When prospects push back, who are they comparing you to?', clientFacing: true,
        hint: '2-3 names. Could be a company, a category, or "their current vendor / current system".',
        why: 'Tells the call script what objections to expect and prepares the rep for them.' },
      { key: 'why_advertise', label: 'Why now? What changed in the last 90 days that made you want help with this?', area: true, clientFacing: true,
        hint: 'One sentence. The trigger.',
        why: 'Tells us what success looks like for THIS engagement (not generic "grow the business").' },
      { key: 'goals', label: 'Concrete number: by 90 days from today, what does winning look like?', area: true, clientFacing: true,
        hint: 'A number, not "more leads". e.g. "12 booked calls", "$50K in MRR", "3 podcast guest slots".',
        why: 'Becomes the yardstick on your dashboard and the pacing for our outreach cadence.' }
    ]
  },
  {
    group: 'Proof & credibility',
    fields: [
      { key: 'client_results', label: 'A specific result you’ve gotten a customer.', area: true, clientFacing: true,
        hint: 'Numbers if you have them. Anonymize if you have to.',
        why: 'Becomes proof points in every cold email and a credibility hook in PR pitches.' },
      { key: 'proof_points', label: 'Why should customers believe it works?', area: true, clientFacing: true,
        hint: 'Certifications, audit history, years in business, third-party validation.',
        why: 'Anchors credibility claims so the AI doesn’t invent ones we can’t back up.' },
      { key: 'notable_clients', label: 'Three to five customer names you’d happily reference on a sales call.', clientFacing: true,
        hint: 'If NDAs apply, use generic descriptors (e.g. "a Fortune 500 retailer").',
        why: 'Drops into outreach emails as a name-drop and into call scripts as "names you can mention".' },
      { key: 'press_awards', label: 'Press, awards, certifications, or stage moments.', clientFacing: true,
        hint: 'Trade press counts. Local awards count.',
        why: 'Used in PR pitches as proof of credibility, and in audits as a trust signal.' },
      { key: 'message_support', label: 'Your favorite testimonial or result (the one you’d quote on a call).', area: true, clientFacing: true,
        hint: 'A short, real quote or paraphrase.',
        why: 'Drops directly into outreach drafts and content as supporting proof.' }
    ]
  },
  {
    group: 'PR & authority',
    fields: [
      { key: 'pr_goals', label: 'When you imagine landing visibility, what does it look like?', area: true, clientFacing: true,
        hint: 'A real outlet, a stage, or a milestone. Skip if PR isn’t a goal right now.',
        why: 'Tells our PR engine what kinds of opportunities to prioritize for you.' },
      { key: 'pr_expert_topics', label: 'Topics you could speak to without prep — a reporter calls tomorrow, what are you the right person for?', area: true, clientFacing: true,
        hint: 'Bullet points are fine. Be specific. Skip if PR isn’t a goal right now.',
        why: 'Becomes the natural opener in every call script ("you wrote about X — would you weigh in on…?") and the matching key for inbound PR opportunities.' },
      { key: 'pr_dream_outlets', label: 'Three outlets or stages you’d love to land on.', clientFacing: true,
        hint: 'Skip if PR isn’t a goal right now.',
        why: 'Used to score and rank inbound PR opportunities for you.' },
      { key: 'pr_spokesperson', label: 'Who’s your spokesperson?', clientFacing: true,
        hint: 'Name + title of the person who actually does interviews.',
        why: 'Used in pitch emails so reporters know who they’re talking to.' },
      { key: 'pr_news_hooks', label: 'In the next 90 days, what’s coming that’s newsworthy?', area: true, clientFacing: true,
        hint: 'Launches, hires, milestones, anniversaries, new locations, big client wins (anonymized).',
        why: 'Becomes the timeliness hook in PR pitches.' },
      { key: 'pr_responsive', label: 'Yes / Maybe / Pass — would you take a 24-48hr press request?', clientFacing: true,
        hint: 'Yes (always send) / Maybe (only if it’s a big outlet) / Pass for now. Leave blank if PR isn’t a goal.',
        why: 'Bumps your score on time-sensitive PR opportunities so you see them first.' }
    ]
  },
  {
    group: 'Web, content & lead-gen',
    fields: [
      { key: 'has_website',  label: 'Existing website?', hint: 'Yes / No', clientFacing: true },
      { key: 'website_url',  label: 'Website URL (if yes)', clientFacing: true },
      { key: 'website_goals', label: 'What should your website actually accomplish for visitors?', area: true, clientFacing: true,
        hint: 'One outcome per visitor type.',
        why: 'Shapes the calls-to-action in any content we write for your site.' },
      { key: 'content_platforms', label: 'Which platforms do you want content for?', clientFacing: true,
        hint: 'LinkedIn, Instagram, YouTube, podcast, blog…' },
      { key: 'content_frequency', label: 'How often should content go out?', clientFacing: true,
        hint: 'e.g. weekly post, monthly blog' },
      { key: 'preferred_channels', label: 'Where do your customers actually spend their work day?', clientFacing: true,
        hint: 'Where you should show up to be seen.',
        why: 'Picks the channels your narrative line and content calendar prioritize.' },
      { key: 'current_leadgen', label: 'What are you ALREADY doing to get leads today?', area: true, clientFacing: true,
        hint: 'Honest list. "Nothing systematic" is a valid answer.',
        why: 'Tells the call script what the prospect is comparing you against so the rep doesn’t fight the wrong objection.' },
      { key: 'ad_budget', label: 'Budget for paid ads?', hint: 'Yes / No, with monthly amount if known', clientFacing: true }
    ]
  },
  {
    // (val + UX/UI 2026-06-07) "Your numbers" — the inputs that turn the
    // Marketing Intelligence Portfolio from activity wall into ROI math.
    // These six fields feed deal_model.ts directly + are the same inputs
    // Won/Lost logging needs, so capture is one coherent build. Anchoring
    // at intake also makes "what closed?" later feel like finishing a
    // sentence the client already started.
    group: 'Your numbers',
    // (val 2026-06-10) Deal economics don't apply to a political campaign —
    // they don't have close rates or LTV. Hide the whole group for political.
    excludeKinds: ['political_campaign'],
    fields: [
      { key: 'avg_deal_value', label: 'What is a typical customer or sale worth to you?', clientFacing: true,
        example: 'e.g. $4,200 / $25,000 / $150 per month',
        hint: 'Average revenue per closed deal — flat fee or first-period value. We use this to size proposals + prove ROI against real numbers.',
        why: 'Powers per-lead ROI math + sizes your custom proposal to your real economics.' },
      { key: 'deal_type', label: 'How do you bill — flat fee or per-unit / per-head?', clientFacing: true,
        hint: 'Flat fee (one number per deal) / Per-unit (price × units) / Hybrid',
        why: 'Determines whether we model revenue as deal_count × price OR units × price.' },
      { key: 'revenue_baseline', label: 'Roughly, what is your current MONTHLY revenue?', clientFacing: true,
        example: 'e.g. $35K / $120K / $8K',
        hint: 'A rough number is fine. This is the starting line we compare growth against.',
        why: 'The ROI starting line. Without it, the Revenue layer of your portfolio stays locked.' },
      { key: 'close_rate', label: 'Of the qualified leads you talk to, about what % become customers?', clientFacing: true,
        example: 'e.g. 15% / 30% / 5%',
        hint: 'Best guess is fine — we will tighten the number as you log Won/Lost outcomes.',
        why: 'Lets the engine forecast pipeline → revenue and shows reps how each conversation matters.' },
      { key: 'sales_cycle', label: 'From first contact to closed deal, how long does it usually take?', clientFacing: true,
        hint: 'Days / weeks / months — pick the unit. e.g. "21 days" or "3 months" or "1 quarter"',
        why: 'Times the cadence of follow-ups + when your portfolio should expect to show revenue lift.' },
      { key: 'customer_ltv', label: 'What is a customer worth over the WHOLE relationship, not just the first sale?', clientFacing: true,
        example: 'e.g. $14,000 / $300K / $1,800',
        hint: 'Lifetime revenue if you keep them — counts renewals, repeats, upsells.',
        why: 'Justifies higher acquisition cost on the right prospects + tells the renewal/retention story.' }
    ]
  },
  {
    // (val 2026-06-10) Political campaign intake — only renders when the
    // active engagement is political_campaign. Asks the questions the cockpit
    // body generator, district heat map, opposition KYC, and campaign calendar
    // need to actually function. Replaces the brand-color / industry questions
    // that don't apply to a candidate. This is the political_campaign template
    // for ANY future political client, not just John White.
    group: 'Campaign basics',
    fields: [
      { key: 'candidate_name', label: 'Candidate full name (as it will appear on the ballot)', clientFacing: true,
        example: 'e.g. John C. White',
        hint: 'Legal name plus middle initial if used on filings.',
        why: 'Anchors press releases, op-eds, and ballot-correct social posts. Public-record screens use this.',
        kinds: ['political_campaign'] },
      { key: 'office_sought', label: 'Office sought', clientFacing: true,
        example: 'U.S. House · State Senate · County Council · Mayor',
        hint: 'The seat as it appears on the ballot.',
        why: 'Decides the level of press list and the talking-point register (federal vs state vs local).',
        kinds: ['political_campaign'] },
      { key: 'district_code', label: 'District code', clientFacing: true,
        example: 'MD-3 · NY-14 · TX-15',
        hint: 'Canonical short code. State abbrev + district number.',
        why: 'Drives the district heat map, the local-outlets press list, and #hashtag.',
        kinds: ['political_campaign'] },
      { key: 'party', label: 'Party', clientFacing: true,
        hint: 'Republican / Democrat / Independent / Libertarian / Green / Other',
        kinds: ['political_campaign'] },
      { key: 'district_counties', label: 'Counties in the district', clientFacing: true,
        example: 'Anne Arundel, Howard, Carroll',
        hint: 'Comma-separated. Used for press list + signal scoping.',
        why: 'Distress signals filed at any of these courthouses surface on the district pulse.',
        kinds: ['political_campaign'] },
      { key: 'district_zips', label: 'District zip codes', area: true, clientFacing: true,
        example: 'e.g. 21401, 21146, 21061, 21054 ...',
        hint: 'Comma-separated list of every zip the district covers. Pull from FCC mapping if needed.',
        why: 'Filters public-record signals to your district so the district pulse stops showing noise from outside.',
        kinds: ['political_campaign'] }
    ]
  },
  {
    group: 'Campaign calendar',
    fields: [
      { key: 'filing_deadline', label: 'Filing deadline', clientFacing: true,
        example: 'YYYY-MM-DD',
        why: 'Auto-seeds the campaign calendar with the deadline + reminders.',
        kinds: ['political_campaign'] },
      { key: 'primary_date', label: 'Primary election date', clientFacing: true,
        example: 'YYYY-MM-DD',
        why: 'Drives the primary press cycle + GOTV cadence.',
        kinds: ['political_campaign'] },
      { key: 'general_date', label: 'General election date', clientFacing: true,
        example: 'YYYY-MM-DD',
        why: 'Drives the general press cycle + debate window.',
        kinds: ['political_campaign'] },
      { key: 'debate_dates', label: 'Scheduled debate dates (if known)', area: true, clientFacing: true,
        hint: 'One per line: date · venue · format.',
        kinds: ['political_campaign'] },
      { key: 'fec_filing_dates', label: 'FEC quarterly filing dates', clientFacing: true,
        hint: 'For federal campaigns. State campaigns: state board of elections filing dates.',
        kinds: ['political_campaign'] }
    ]
  },
  {
    group: 'Opponents + competitive field',
    fields: [
      { key: 'sitting_incumbent', label: 'Sitting incumbent name + party', clientFacing: true,
        example: 'e.g. Andy Harris (R)',
        why: 'KYC screen runs on incumbent. Op-eds reference them by full name.',
        kinds: ['political_campaign'] },
      { key: 'opponents', label: 'Other candidates running (your primary + general)', area: true, clientFacing: true,
        hint: 'One per line: name · party · brief one-liner (challenger / establishment / single-issue).',
        why: 'Each line triggers a public-record screen on that opponent and feeds the differentiator generator.',
        kinds: ['political_campaign'] },
      { key: 'fec_committee_id', label: 'FEC committee ID (if registered)', clientFacing: true,
        example: 'e.g. C00123456',
        why: 'Unlocks FEC API pulls for fundraising landscape + opponent receipts.',
        kinds: ['political_campaign'] }
    ]
  },
  {
    group: 'Message + position',
    fields: [
      { key: 'stump_speech', label: 'Your two-line stump speech', area: true, clientFacing: true,
        hint: 'How you describe yourself when you have ten seconds at a door. Plain words.',
        why: 'Every press release opener + every social caption pulls from this — never use buzzwords.',
        kinds: ['political_campaign'] },
      { key: 'three_planks', label: 'Your three planks', area: true, clientFacing: true,
        hint: 'One per line. Issue you will run on. Be specific.',
        why: 'Drives the three campaign narrative lines + the talking points the cascade engine matches to district signals.',
        kinds: ['political_campaign'] },
      { key: 'positions_local_issues', label: 'Positions on the three biggest local issues', area: true, clientFacing: true,
        hint: 'One per line. Issue · your position · the one-line reason.',
        why: 'Local press will ask. The op-ed and door-card generators use these verbatim.',
        kinds: ['political_campaign'] },
      { key: 'no_go_topics', label: 'Topics you will NOT take a public position on this cycle', area: true, clientFacing: true,
        hint: 'One per line. Used as a hard guardrail — never appears in drafts.',
        why: 'The press kit generator and op-ed prompts read this as a do-not-say list.',
        kinds: ['political_campaign'] }
    ]
  },
  {
    group: 'Campaign team',
    fields: [
      { key: 'campaign_manager', label: 'Campaign manager · name + email', clientFacing: true,
        kinds: ['political_campaign'] },
      { key: 'comms_director', label: 'Communications director · name + email', clientFacing: true,
        why: 'Press kit drafts route to them before the candidate sees them.',
        kinds: ['political_campaign'] },
      { key: 'field_director', label: 'Field director · name + email', clientFacing: true,
        kinds: ['political_campaign'] },
      { key: 'treasurer', label: 'Treasurer · name + email', clientFacing: true,
        why: 'Required for FEC + state filings; gate on all financial-claim copy.',
        kinds: ['political_campaign'] },
      { key: 'press_contacts', label: 'Local reporters you have a relationship with', area: true, clientFacing: true,
        hint: 'One per line: name · outlet · beat · last contact.',
        why: 'These become the first row of the press_touches log — warm leads pitched first.',
        kinds: ['political_campaign'] }
    ]
  },
  {
    group: 'Campaign brand',
    fields: [
      // (val 2026-06-10) Political brand is SEPARATE from any other business
      // the candidate runs. John has Compass Marketing; that brand has nothing
      // to do with the political campaign brand. Fields here OVERRIDE the
      // generic Brand & identity group above for political_campaign clients.
      { key: 'campaign_primary_color', label: 'Campaign primary color', clientFacing: true,
        hint: 'Hex value or color name. The dominant color on signs and ads.',
        why: 'Drives every social card + commercial frame — distinct from any business brand color.',
        kinds: ['political_campaign'] },
      { key: 'campaign_secondary_color', label: 'Campaign secondary color', clientFacing: true,
        kinds: ['political_campaign'] },
      { key: 'campaign_hashtag', label: 'Campaign hashtag', clientFacing: true,
        example: '#WhiteForMD3 · #Vote4White',
        kinds: ['political_campaign'] },
      { key: 'campaign_signoff', label: 'Campaign sign-off line', clientFacing: true,
        example: 'I\'m John White and I approved this message.',
        hint: 'The legally required disclaimer + any optional tagline.',
        kinds: ['political_campaign'] },
      { key: 'campaign_logo_url', label: 'Campaign logo URL', clientFacing: true,
        hint: 'Public link to PNG/SVG. Will be applied to every commercial + social card.',
        kinds: ['political_campaign'] },
      { key: 'campaign_website', label: 'Campaign website', clientFacing: true,
        example: 'whiteformd3.com',
        kinds: ['political_campaign'] }
    ]
  },
  {
    group: 'Logistics',
    fields: [
      { key: 'busy_seasons', label: 'When is your busy season?', clientFacing: true,
        hint: 'Months or events. When timing matters.',
        why: 'Helps the audit score timing fit for each prospect and paces your outreach cadence.' },
      { key: 'key_dates', label: 'Any key dates or deadlines in the next 12 months?', clientFacing: true,
        hint: 'Launches, industry events, renewal windows, anniversaries.',
        why: 'Feeds the content calendar and PR pitch timeliness.' },
      { key: 'timeline', label: 'Project timeline expectations', clientFacing: true,
        hint: 'How fast you want to move (different from seasonality).' },
      { key: 'budget', label: 'Estimated budget for this engagement', clientFacing: true },
      { key: 'assets_link', label: 'Link to your logos / photos / brand assets', clientFacing: true,
        hint: 'Google Drive, Dropbox, or similar.',
        why: 'Lets us brand commercials, social cards, and PDFs in your real visual identity.' },
      { key: 'additional_info', label: 'Anything else worth knowing?', area: true, clientFacing: true,
        hint: 'Rebrands coming, leadership changes, internal politics, legal sensitivities.',
        why: 'Operator-reviewed before we kick off; flags anything that should never appear in client-facing content.' }
    ]
  }
];

/** Flat list of every canonical intake key. */
export const INTAKE_KEYS: string[] = INTAKE_GROUPS.flatMap((g) => g.fields.map((f) => f.key));

/** Subset of intake keys rendered on the client-facing portal form. */
export const CLIENT_INTAKE_KEYS: string[] = INTAKE_GROUPS.flatMap((g) =>
  g.fields.filter((f) => f.clientFacing).map((f) => f.key)
);

/** Client-portal-only view of the groups (drops operator-only fields). */
export const CLIENT_INTAKE_GROUPS: IntakeGroup[] = INTAKE_GROUPS
  .map((g) => ({ group: g.group, fields: g.fields.filter((f) => f.clientFacing) }))
  .filter((g) => g.fields.length > 0);

/**
 * (#551) Filter groups to the fields relevant to an engagement kind. A field
 * with no `kinds` is kept for every kind (so an untagged config — today's —
 * is unchanged for all kinds). Empty groups are dropped. Pure; safe to call
 * from a client component. Pass null/undefined to get the groups untouched.
 */
export function groupsForEngagementKind(
  groups: IntakeGroup[],
  kind: EngagementKind | null | undefined
): IntakeGroup[] {
  if (!kind) return groups;
  return groups
    // Group-level kinds/excludeKinds gate first.
    .filter((g) => !g.kinds || g.kinds.includes(kind))
    .filter((g) => !g.excludeKinds || !g.excludeKinds.includes(kind))
    .map((g) => ({
      group: g.group,
      fields: g.fields.filter((f) => {
        // kinds: keep ONLY for these kinds (if present)
        if (f.kinds && !f.kinds.includes(kind)) return false;
        // excludeKinds: drop for these kinds (if present)
        if (f.excludeKinds && f.excludeKinds.includes(kind)) return false;
        return true;
      })
    }))
    .filter((g) => g.fields.length > 0);
}
