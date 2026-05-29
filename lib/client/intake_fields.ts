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
}

export interface IntakeGroup {
  group: string;
  fields: IntakeField[];
}

export const INTAKE_GROUPS: IntakeGroup[] = [
  {
    group: 'Business basics',
    fields: [
      { key: 'company',      label: 'Company name', clientFacing: true,
        example: 'Acme Co.' },
      { key: 'contact_name', label: 'Contact name', clientFacing: true,
        example: 'Jane Smith' },
      { key: 'phone',        label: 'Phone',         clientFacing: true,
        example: '(555) 123-4567' },
      { key: 'industry',     label: 'Industry',      clientFacing: true,
        example: 'e.g. payroll-tax savings / commercial real estate / wedding planning',
        why: 'Used to find the right prospects to discover for you, and to set the audit’s vocabulary.' },
      { key: 'company_size', label: 'Company size',  clientFacing: true,
        example: 'Just me / 2-10 / 11-50 / 51-200 / 201-500 / 500+',
        why: 'Helps us match you to prospects of comparable size.' },
      { key: 'business_description', label: 'In one sentence, what do you actually do?', area: true, clientFacing: true,
        hint: 'Plain English. Skip the buzzwords.',
        example: 'We help mid-size employers recover an average of $640/employee/year in payroll taxes through an IRS-approved Section 125 plan.',
        why: 'Anchors every lead audit, call script, and outreach email so they reflect what you really sell.' }
    ]
  },
  {
    group: 'Brand & identity',
    fields: [
      { key: 'slogan', label: 'Your one-line tagline (if you have one)', clientFacing: true,
        hint: 'A sentence a stranger could repeat to a friend.',
        example: 'Payroll taxes, recovered. Legally. Quietly.',
        why: 'Anchors the voice in your outreach and on the lead audit.' },
      { key: 'has_logo',     label: 'Existing logo?', hint: 'Yes / No', clientFacing: true,
        example: 'Yes' },
      { key: 'logo_changes', label: 'If yes, anything you’d change about it?', clientFacing: true,
        example: 'Keep mark, lose the tagline; modernize the font' },
      { key: 'brand_traditional', label: 'Traditional or Modern?', clientFacing: true,
        hint: 'Pick the one that fits.',
        example: 'Traditional / Modern / In between' },
      { key: 'brand_friendly',    label: 'Friendly or Corporate?', clientFacing: true,
        example: 'Friendly / Corporate / In between' },
      { key: 'brand_pricing',     label: 'High-end or Cost-effective?', clientFacing: true,
        example: 'High-end / Cost-effective / In between' },
      { key: 'brand_colors', label: 'Brand colors (if you have them)', clientFacing: true,
        example: 'Navy + gold; or hex #0a1f3d, #d4a253',
        why: 'Used when we brand assets (commercials, social cards, blog headers) on your behalf.' },
      { key: 'brand_voice', label: 'In three words, how should your brand sound on a call?', clientFacing: true,
        hint: 'Adjectives, not paragraphs.',
        example: 'Direct, warm, expert',
        why: 'Sets the tone for cold emails and call scripts so they sound like you, not generic SaaS.' }
    ]
  },
  {
    group: 'Audience & ideal client',
    fields: [
      { key: 'ideal_client', label: 'Describe your IDEAL customer in one sentence.', area: true, clientFacing: true,
        hint: 'A specific person, not a category. Title, company size, industry, situation.',
        example: 'HR Director or CFO at a US employer with 50-500 W-2 employees, struggling with rising payroll costs.',
        why: 'Drives who our Find-leads engine searches for. The more specific, the better the matches.' },
      { key: 'geo_focus',    label: 'Where do you sell?', clientFacing: true,
        hint: 'Cities, states, countries — wherever you can actually deliver.',
        example: 'Florida, Alabama, Mississippi, Louisiana (Gulf states)',
        why: 'Filters discovered prospects to your territory and gives lead audits local market context.' },
      { key: 'target_audience', label: 'If different from your ideal customer, who else?', area: true, clientFacing: true,
        hint: 'Sometimes the buyer and the influencer aren’t the same person.',
        example: 'Brokers, PEO consultants, and benefits administrators who refer us in.' },
      { key: 'client_problems', label: 'Fill in the blank: "My customers come to me when ___"', area: true, clientFacing: true,
        hint: 'The actual moment they pick up the phone.',
        example: 'their accountant tells them they have no more deductions left, or their CFO sees a new line item that wasn’t there last quarter.',
        why: 'Tells our call scripts what objection to expect and what trigger to mirror.' },
      { key: 'audience_insights', label: 'What does your ideal customer believe that most of their peers don’t?', area: true, clientFacing: true,
        hint: 'One belief or insight that separates the buyer from the skeptic.',
        example: 'That payroll taxes are negotiable if you know the right IRS sections — most CFOs assume they’re fixed.',
        why: 'Shapes the angle our outreach takes — leads with their worldview, not ours.' }
    ]
  },
  {
    group: 'Positioning & message',
    fields: [
      { key: 'founder_story', label: 'In one sentence: what made you start this work?', area: true, clientFacing: true,
        hint: 'The original moment, not a polished bio.',
        example: 'Watched a small business owner lose 40% of his payroll to taxes and decided someone had to translate the IRS code into plain English.',
        why: 'Gives your brand a human anchor in any PR or thought-leadership content.' },
      { key: 'key_message', label: 'If a prospect remembers ONE sentence from your pitch, what is it?', area: true, clientFacing: true,
        hint: 'One sentence. The line you’d say at the end of a discovery call.',
        example: 'You can keep paying these payroll taxes, or you can keep this money.',
        why: 'Becomes the thesis of your narrative line and the line we lean on in every drafted email.' },
      { key: 'market_position', label: 'How do you want prospects to see you vs. the alternatives?', area: true, clientFacing: true,
        hint: 'The thing only you can credibly say.',
        example: 'Not a benefits broker, not a tax attorney — the only firm built specifically around Section 125 payroll-tax recovery.',
        why: 'Shapes your positioning in PR pitches and content.' },
      { key: 'differentiators', label: 'A CFO just asked "we already have benefits — why you?" What’s your one-line answer?', area: true, clientFacing: true,
        hint: 'No marketing fluff. The actual sentence you’d say in the meeting.',
        example: 'Because EHP isn’t a benefit — it’s a payroll-tax recovery program that happens to give your employees a $0 health benefit.',
        why: 'Becomes the audit’s "what makes them different" line and the outreach’s lead hook.' },
      { key: 'competitors', label: 'When prospects push back, who are they comparing you to?', clientFacing: true,
        hint: '2-3 names. Could be a company, a category, or "their current accountant".',
        example: 'BCBS group plans, captive PEO models, a local benefits broker, "we’ll just stay with what we have"',
        why: 'Tells the call script what objections to expect and prepares the rep for them.' },
      { key: 'why_advertise', label: 'Why now? What changed in the last 90 days that made you want help with this?', area: true, clientFacing: true,
        hint: 'One sentence. The trigger.',
        example: 'Closed three EHP deals from referrals in Q1 and want to stop relying on luck.',
        why: 'Tells us what success looks like for THIS engagement (not generic "grow the business").' },
      { key: 'goals', label: 'Concrete number: by 90 days from today, what does winning look like?', area: true, clientFacing: true,
        hint: 'A number, not "more leads".',
        example: '12 booked discovery calls with employers in the 100-500 employee range. $50K in committed MRR.',
        why: 'Becomes the yardstick on your dashboard and the pacing for our outreach cadence.' }
    ]
  },
  {
    group: 'Proof & credibility',
    fields: [
      { key: 'client_results', label: 'A specific result you’ve gotten a customer.', area: true, clientFacing: true,
        hint: 'Numbers if you have them. Anonymize if you have to.',
        example: 'A 220-employee specialty pharmacy in Tampa recovered $147K in year-one payroll taxes; renewed in year two.',
        why: 'Becomes proof points in every cold email and a credibility hook in PR pitches.' },
      { key: 'proof_points', label: 'Why should customers believe it works?', area: true, clientFacing: true,
        hint: 'IRS rulings, certifications, audit history, third-party validation.',
        example: 'IRS-approved Section 125 plan structure. 18 years in market. Zero adverse audit outcomes.',
        why: 'Anchors credibility claims so the AI doesn’t invent ones we can’t back up.' },
      { key: 'notable_clients', label: 'Three to five customer names you’d happily reference on a sales call.', clientFacing: true,
        hint: 'If NDAs apply, use generic descriptors like "a Fortune 500 hospitality brand".',
        example: 'State education dept. of New Mexico, a 5,000-employee franchise group, a 300-bed regional hospital',
        why: 'Drops into outreach emails as a name-drop and into call scripts as "names you can mention".' },
      { key: 'press_awards', label: 'Press, awards, certifications, or stage moments.', clientFacing: true,
        hint: 'Trade press counts. Local awards count.',
        example: 'Quoted in BenefitsPRO 2024; Inc. 5000 honoree 2023; SHRM-certified consultant.',
        why: 'Used in PR pitches as proof of credibility, and in audits as a trust signal.' },
      { key: 'message_support', label: 'Your favorite testimonial or result (the one you’d quote on a call).', area: true, clientFacing: true,
        hint: 'A short, real quote or paraphrase.',
        example: '"We thought our CFO knew payroll taxes. Skip’s team found us $87K in our first quarter." — Director, regional logistics co.',
        why: 'Drops directly into outreach drafts and content as supporting proof.' }
    ]
  },
  {
    group: 'PR & authority',
    fields: [
      { key: 'pr_goals', label: 'When you imagine landing visibility, what does it look like?', area: true, clientFacing: true,
        hint: 'A real outlet, a stage, or a milestone.',
        example: 'Quoted in BenefitsPRO; podcast guest on The HR Bartender; speaking slot at SHRM Annual.',
        why: 'Tells our PR engine what kinds of opportunities to prioritize for you.' },
      { key: 'pr_expert_topics', label: 'Five topics you could speak to without prep — a reporter calls tomorrow, what are you the right person for?', area: true, clientFacing: true,
        hint: 'Bullet points are fine. Be specific.',
        example: '1) Section 125 payroll tax recovery for 50-500 employee firms\n2) Why most HR directors misunderstand FICA\n3) The IRS rules that make EHP defensible\n4) How a CFO should evaluate a benefits-tax program\n5) When a payroll-tax program is NOT a fit',
        why: 'Becomes the natural opener in every call script ("you wrote about X — would you weigh in on...?") and the matching key for inbound PR opportunities.' },
      { key: 'pr_dream_outlets', label: 'Three outlets or stages you’d love to land on.', clientFacing: true,
        example: 'BenefitsPRO, SHRM Annual, The HR Bartender podcast',
        why: 'Used to score and rank inbound PR opportunities for you.' },
      { key: 'pr_spokesperson', label: 'Who’s your spokesperson?', clientFacing: true,
        hint: 'Name + title of the person who actually does interviews.',
        example: 'Skip Krause, Founder & Principal Consultant',
        why: 'Used in pitch emails so reporters know who they’re talking to.' },
      { key: 'pr_news_hooks', label: 'In the next 90 days, what’s coming that’s newsworthy?', area: true, clientFacing: true,
        hint: 'Launches, hires, milestones, anniversaries, new locations, big client wins (anonymized).',
        example: 'Q3 launch of a self-serve calculator; 20th anniversary in October; new managing partner joining.',
        why: 'Becomes the timeliness hook in PR pitches.' },
      { key: 'pr_responsive', label: 'Yes / Maybe / Pass — would you take a 24-48hr press request?', clientFacing: true,
        hint: 'If a reporter emails us tomorrow asking for a quote in your domain, do you want it forwarded?',
        example: 'Yes (always send) / Maybe (only if it’s a big outlet) / Pass for now',
        why: 'Bumps your score on time-sensitive PR opportunities so you see them first.' }
    ]
  },
  {
    group: 'Web, content & lead-gen',
    fields: [
      { key: 'has_website',  label: 'Existing website?', hint: 'Yes / No', clientFacing: true,
        example: 'Yes' },
      { key: 'website_url',  label: 'Website URL (if yes)', clientFacing: true,
        example: 'https://yourcompany.com' },
      { key: 'website_goals', label: 'What should your website actually accomplish for visitors?', area: true, clientFacing: true,
        hint: 'One outcome per visitor type.',
        example: 'CFOs: book a 20-min savings estimate. Brokers: download our partner one-pager.',
        why: 'Shapes the calls-to-action in any content we write for your site.' },
      { key: 'content_platforms', label: 'Which platforms do you want content for?', clientFacing: true,
        hint: 'LinkedIn, Instagram, YouTube, podcast, blog…',
        example: 'LinkedIn + blog' },
      { key: 'content_frequency', label: 'How often should content go out?', clientFacing: true,
        example: 'Weekly LinkedIn post, monthly blog' },
      { key: 'preferred_channels', label: 'Where do your customers actually spend their work day?', clientFacing: true,
        hint: 'Where you should show up to be seen.',
        example: 'LinkedIn, email, industry trade pubs (BenefitsPRO, SHRM)',
        why: 'Picks the channels your narrative line and content calendar prioritize.' },
      { key: 'current_leadgen', label: 'What are you ALREADY doing to get leads today?', area: true, clientFacing: true,
        hint: 'Honest list. Includes "nothing systematic" if that’s the truth.',
        example: 'Referrals from accountants, LinkedIn outreach, Chamber of Commerce events',
        why: 'Tells the call script what the prospect is comparing you against so the rep doesn’t fight the wrong objection.' },
      { key: 'ad_budget', label: 'Budget for paid ads?', hint: 'Yes / No / amount if known', clientFacing: true,
        example: 'Yes, ~$2K/mo' }
    ]
  },
  {
    group: 'Logistics',
    fields: [
      { key: 'busy_seasons', label: 'When is your busy season?', clientFacing: true,
        hint: 'Months or events. When timing matters.',
        example: 'Q4 (open-enrollment), tax season (Jan-Apr)',
        why: 'Helps the audit score timing fit for each prospect and paces your outreach cadence.' },
      { key: 'key_dates', label: 'Any key dates or deadlines in the next 12 months?', clientFacing: true,
        example: 'Open enrollment opens Sept 1; SHRM Annual June 17-19',
        why: 'Feeds the content calendar and PR pitch timeliness.' },
      { key: 'timeline', label: 'Project timeline expectations', hint: 'How fast you want to move (different from seasonality).', clientFacing: true,
        example: '90-day sprint; then quarterly reviews' },
      { key: 'budget', label: 'Estimated budget for this engagement', clientFacing: true,
        example: '$3K/mo retained; one-time setup negotiable' },
      { key: 'assets_link', label: 'Link to your logos / photos / brand assets', clientFacing: true,
        example: 'Google Drive link, Dropbox folder, etc.',
        why: 'Lets us brand commercials, social cards, and PDFs in your real visual identity.' },
      { key: 'additional_info', label: 'Anything else worth knowing?', area: true, clientFacing: true,
        hint: 'Rebrands coming, leadership changes, internal politics, legal sensitivities.',
        example: 'Co-founder leaving end of year; we’re changing our DBA in Q3; do not mention our former parent company.',
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
