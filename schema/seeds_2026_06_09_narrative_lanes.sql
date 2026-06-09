-- ============================================================================
-- seeds_2026_06_09_narrative_lanes.sql  (#572, Tier 2.2)
-- ============================================================================
-- Seeds 3 narrative lines for Ron + John + 2 for Lyons so:
--   - The "Narratives running" cockpit metric shows a real number (not 0)
--   - Every cockpit angle has a real narrative_line_id it can link to
--     when val green-lights / edits a draft
--   - The /admin/av/campaigns page shows these clients have active spines
--
-- Idempotent: uses INSERT IGNORE keyed on (tenant_id, client_id, name)
-- with a uniqueness check via name; safe to re-run.
--
-- WHY THESE LINES (grounded in each brief):
--   Ron  → defense_pr: 3 lines = the press push (Court Record Speaks),
--          the legal community angle (Procedural Justice), the rally engine
--          (Free Dr Ron coverage)
--   John → political_campaign: 3 lines = District Stress Read (HMDA + WARN),
--          Procedural Justice (medical community case), Doctor-I-Know
--   Lyons→ luxury_hospitality: 2 lines = Each Port a Chapter (itinerary
--          stories) + The Captains' Way (Captain Kevin + Captain Maile)
--
-- After running, verify:
--   SELECT tenant_id, client_id, name, state FROM narrative_lanes
--    WHERE client_id IN (5, 16, 17) ORDER BY client_id;
-- ============================================================================

USE shhdbite_AV;

-- ─────────────────────────────────────────────────────────────────────────────
-- Ron Elfenbein (client_id = 17, defense_pr)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT IGNORE INTO narrative_lanes
  (tenant_id, client_id, name, description, state, thesis, audience, emotional_driver, authority_angle, sort_order, is_active)
VALUES
  ('av', 17, 'The Court Record Speaks',
   'Press push grounded in the 93-page Bredar opinion + Fourth Circuit reversal. Two-DOJ framing (Biden + Trump) gives bipartisan reach.',
   'active',
   'When a federal judge writes a 93-page acquittal opinion, the press should listen — and so should the next jury pool.',
   'Maryland local press + medical community + procedural-justice independents',
   'Procedural fairness · the record vs. the prosecution',
   'Counsel-grounded; never inflammatory. Lets the opinion do the heavy lifting.',
   1, 1),
  ('av', 17, 'The Doctor Who Said Yes',
   'Humanizes Ron via the 5,000+ COVID infusions performed at federal request at FedEx Field. The pandemic-era doctor who served, then was prosecuted.',
   'active',
   'A frontline COVID physician answered the federal call. He should not be prosecuted by the federal government that called him.',
   'Healthcare workers + voters with a doctor at home',
   'Recognition + protection of those who served',
   'Public-record + human-story. Names FedEx Field, names the federal partner agency.',
   2, 1),
  ('av', 17, 'Free Dr Ron · The Rally Cycle',
   'Coverage of dropthecase.com mobilization. Conservative press + rally-aware journalists. Earns coverage in cycles around major case dates.',
   'reinforcing',
   'Public attention compounds with each major case date. Press list grows; press touches build the muscle for the retrial press window.',
   'Conservative + libertarian press, rally-aware journalists, OANN / Free Press readers',
   'Civic engagement · the case becomes a movement',
   'Movement voice; quotes the rally organizers, not just counsel.',
   3, 1);

-- ─────────────────────────────────────────────────────────────────────────────
-- John White (client_id = 5, political_campaign · MD-3)
-- Publish gate active — these are seed lines val will pull from once Ron's
-- case resolves. Setting state='candidate' for now so they're tracked but
-- not yet driving publishable content.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT IGNORE INTO narrative_lanes
  (tenant_id, client_id, name, description, state, thesis, audience, emotional_driver, authority_angle, sort_order, is_active)
VALUES
  ('av', 5, 'District Stress Read',
   'HMDA mortgage-stress + WARN-notice + code-violation cascade across MD-3 zips (Anne Arundel + Howard + Carroll). Numbers his neighbors recognize.',
   'candidate',
   'A candidate who reads district-level data — and tells you what it actually says — earns the district''s trust.',
   'MD-3 R primary voters, suburban Anne Arundel + Annapolis + Glen Burnie',
   'Recognition · "someone is finally paying attention to my street"',
   'Data-anchored. Names the cascade. District-data-driven messaging is the differentiator.',
   1, 1),
  ('av', 5, 'Procedural Justice · A Doctor I Know',
   'Connects the Elfenbein case to district medical voters. Bipartisan tent because both DOJs pursued it. Medical-community-as-voter-bloc framing.',
   'candidate',
   'When a federal judge writes 93 pages explaining why the case fails, a member of Congress should ask why two administrations kept prosecuting.',
   'Healthcare-adjacent voters (high concentration in MD-3), procedural-justice independents',
   'Protective indignation · the medical community as voter bloc',
   'Procedural-justice frame > partisan-tribal frame. Anchored in the Bredar opinion.',
   2, 1),
  ('av', 5, 'I Read the 93 Pages',
   'Signature one-line message — "I read the 93 pages. The federal government should listen when a judge does." Op-ed + LinkedIn long-form anchor.',
   'candidate',
   'The case that shows what kind of representative he will be: substantive, calm, factual, anchored in records not rhetoric.',
   'Newspaper-reading primary voters; long-form (Free Press, Reason) readers',
   'Authority through depth · the candidate who actually does the homework',
   'Plural voice ("our district," "our doctors"). Never partisan-tribal.',
   3, 1);

-- ─────────────────────────────────────────────────────────────────────────────
-- The Flame · Kevin + Mary Lyons (client_id = 16, luxury_hospitality)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT IGNORE INTO narrative_lanes
  (tenant_id, client_id, name, description, state, thesis, audience, emotional_driver, authority_angle, sort_order, is_active)
VALUES
  ('av', 16, 'Each Port · A Chapter',
   'Each port arrival is a story — local press lined up in advance, photos that match the hull livery (International Orange + Super Jet Black), and a short post about what makes this stop matter.',
   'active',
   'The Flame doesn''t do destinations — she writes chapters. Each port is a story, captured, told, and remembered.',
   'Couples + very small groups seeking private captain-led sailing · biohacker-luxury · slow travel · story-collectors',
   'Anticipation · the next chapter',
   'Insider voice. Sea-stories, not boat-specs. Never salesy.',
   1, 1),
  ('av', 16, 'The Captains'' Way',
   'Captain Kevin + Captain Maile — the couple who built this boat the way they wanted to sail. The HH44 #29 as a love letter to performance + privacy.',
   'active',
   'Two captains. One boat. Built the way they wanted to live. That''s the story behind every charter.',
   'Story-collectors who already love boats. Press for high-end sail magazines + Annapolis-region coverage.',
   'Identification · the couple who lived the dream',
   'Plural voice ("our boat," "our season"). Warm, nautical, private.',
   2, 1);

-- Sanity check
SELECT tenant_id, client_id, name, state, sort_order
  FROM narrative_lanes
 WHERE client_id IN (5, 16, 17)
 ORDER BY client_id, sort_order;
