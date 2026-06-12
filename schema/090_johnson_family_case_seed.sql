-- =====================================================================
-- Atlantic Hub -- Johnson Family case seed (THE FIRST CASE)
-- File:    schema/090_johnson_family_case_seed.sql
-- Target:  shhdbite_AV
-- Run AFTER: schema/089_case_management.sql
-- =====================================================================
--
-- Seeds the Johnson family Home-Ranch Trust case so val + Adriana can
-- see the case-management module standing up in production with real
-- data from the actual trust documents val forwarded 2026-06-11.
--
-- NOT IDEMPOTENT in the same way migrations are: this seed assumes the
-- Johnson family client doesn't exist yet. If you've already created
-- the client manually, change the @client_id assignment below to point
-- at the existing row instead of running the INSERT.
--
-- READ FIRST:
--   1. The Johnson family draft package at /AtlanticandVine/ATLANTIC AND
--      VINE management/Clients/Johnson Family/ has the legal analysis +
--      five plain-English options for the parents.
--   2. The Outlook email thread from 2026-06-11 has the source PDFs
--      (Home-Ranch Trust Draft003-FINAL + Property Report).
--
-- WHAT THIS DOES:
--   1. Creates a new client row "Johnson Family · Home-Ranch Trust"
--   2. Creates the case (case_kind=trust_dispute, wellness_enabled=TRUE)
--   3. Seeds the 8 children as case_parties (Cecilia as Trustee, Rebecca
--      as Successor Trustee, Gordon + Maria Angelina as Trustors/parents)
--   4. Seeds the case_property for 1657 Kingsly Dr, Pittsburg, CA
--   5. Seeds the timeline (trust signing, property report, family emails)
--   6. Seeds Adriana's 5 confirm-questions as URGENT/HIGH action items
--   7. Sets a case_synopsis grounded in the actual trust read
-- =====================================================================

USE shhdbite_AV;
SET NAMES utf8mb4;

-- ---------------------------------------------------------------------
-- 1. Create the client row
--
-- NOTE: the clients table is intentionally lean (id, uuid, name, slug,
-- industry, plan_tier, enabled, timestamps + short_name from #073).
-- Address / owner_name / state / city live in the BRIEF payload (#553)
-- and on case_parties + case_property, NOT on clients. Don't try to add
-- them here — that's the field-parity-for-FORM work (#567), not schema.
-- ---------------------------------------------------------------------
INSERT INTO clients (
  client_uuid, client_name, short_name, client_slug,
  industry, plan_tier, created_at
) VALUES (
  UUID(),
  'Johnson Family · Home-Ranch Trust',
  'Johnson',
  'johnson-family',
  'Elder advocacy / Trust dispute',
  'sprint',
  NOW()
);
SET @client_id := LAST_INSERT_ID();

-- ---------------------------------------------------------------------
-- 2. Create the case (wellness_enabled = TRUE — the family wellness
--    wrapper activates per spec)
-- ---------------------------------------------------------------------
INSERT INTO cases (
  client_id, case_name, case_kind, case_synopsis,
  status, wellness_enabled, metadata
) VALUES (
  @client_id,
  'Johnson Family · Home-Ranch Trust',
  'trust_dispute',
  'The Home-Ranch Trust was executed June 28, 2025 in Contra Costa County, naming Gordon Johnson and Maria Angelina Johnson as Trustors (lifetime beneficiaries) and their daughter Cecilia M. Truman as Trustee. Successor Trustee is Rebecca E. Johnson. The Pittsburg residence at 1657 Kingsly Drive is gifted outright to Cecilia after the death of the surviving spouse (§6.G(2)). Cecilia is currently moving to force the sale of the home while the parents are still living in it. Per §5.A the trust is revocable by either parent alone; per §5.B it is amendable by both parents jointly. Per §5.F the parents have complete and unlimited possession of the residence while alive. Adriana / CLDA Services delivered a plain-English legal read 2026-06-11 with five confirm-questions (see action items).',
  'open',
  TRUE,
  JSON_OBJECT(
    'trust_name', 'The Home-Ranch Trust',
    'trust_executed_date', '2025-06-28',
    'trust_county', 'Contra Costa',
    'drafted_by', 'Legacy Counselors at Law, P.C.',
    'trust_kind', 'revocable_living',
    'notary', 'Rafaniel Jimerson'
  )
);
SET @case_id := LAST_INSERT_ID();

-- ---------------------------------------------------------------------
-- 3. Seed the parties (Trustors, Trustee, Successor, beneficiaries)
-- ---------------------------------------------------------------------

-- Parents (Trustors / lifetime beneficiaries)
INSERT INTO case_parties (case_id, full_name, role, relationship, is_parent, is_veteran, notes) VALUES
  (@case_id, 'Gordon Johnson', 'trustor', 'father', TRUE, FALSE, 'Lifetime beneficiary. Per Rebecca, currently being relocated to Southern CA without knowledge of pending home sale. VETERAN STATUS: to confirm — if served, Veterans Services panel activates.'),
  (@case_id, 'Maria Angelina Johnson', 'trustor', 'mother', TRUE, FALSE, 'Lifetime beneficiary. Cecilia is currently her POA agent (financial + healthcare). Per Rebecca, may have misunderstood Cecilia''s role — confirm whether she said TRUSTEE or TRUSTOR on the page she didn''t recognize.');

-- Trustee + Successor
INSERT INTO case_parties (case_id, full_name, role, relationship, notes) VALUES
  (@case_id, 'Cecilia M. Truman', 'trustee', 'daughter', 'Initial Trustee under §2.C(1). Also gifted 1657 Kingsly Dr outright after death of surviving spouse (§6.G(2)). Currently forcing sale of residence over parents'' interests.'),
  (@case_id, 'Rebecca E. Johnson', 'successor_trustee', 'daughter', 'Successor Trustee under §2.C(1) if Cecilia ceases to act. Primary family contact for AV / CLDA Services engagement. Caregiver-leader for family.');

-- Other beneficiaries (residue, by right of representation per §6.G(3))
INSERT INTO case_parties (case_id, full_name, role, relationship) VALUES
  (@case_id, 'Raquel M. Rubio', 'beneficiary', 'daughter'),
  (@case_id, 'Gabriel N. Johnson', 'beneficiary', 'son'),
  (@case_id, 'Reuben E. Johnson', 'beneficiary', 'son'),
  (@case_id, 'Gregory G. Johnson', 'beneficiary', 'son'),
  (@case_id, 'Theresa V. Conteb', 'beneficiary', 'daughter'),
  (@case_id, 'Ramon L. Johnson', 'beneficiary', 'son');

-- ---------------------------------------------------------------------
-- 4. Seed the property
-- ---------------------------------------------------------------------
INSERT INTO case_property (
  case_id, address_line, city, state, zip, county,
  current_titled_owner, recorder_source, notes
) VALUES (
  @case_id,
  '1657 Kingsly Drive',
  'Pittsburg',
  'CA',
  '94565',
  'Contra Costa',
  'The Home-Ranch Trust (per Schedule A; verify deed)',
  'ca_contra_costa_recorder',
  'Per Schedule A of the trust the residence is intended to be a trust asset. Adriana flagged: verify the deed is actually titled into the trust per Probate Code §5.F treatment. Estimated value and equity to be populated from Contra Costa County recorder pull.'
);

-- ---------------------------------------------------------------------
-- 5. Seed the timeline
-- ---------------------------------------------------------------------
INSERT INTO case_events (case_id, event_date, event_kind, event_title, event_detail, source) VALUES
  (@case_id, '2025-06-28', 'signed',
   'The Home-Ranch Trust executed',
   'Executed June 28, 2025 in Contra Costa County, California. Gordon Johnson and Maria Angelina Johnson signed as Trustors. Cecilia M. Truman signed as Trustee. Notarized by Rafaniel Jimerson. Drafted by Legacy Counselors at Law, P.C.',
   'trust_document'),
  (@case_id, '2026-05-28', 'discovery',
   'Property Report pulled for 1657 Kingsly Drive',
   'Public-data property report obtained for the parents'' residence at 1657 Kingsly Dr, Pittsburg, CA 94565.',
   'property_report'),
  (@case_id, '2026-06-11', 'communication',
   'Rebecca forwards trust packet to val',
   'Rebecca E. Johnson (beckajay@gmail.com) emailed val at Atlantic & Vine the full estate planning portfolio + Property Report for review. Subject: "Johnson trust".',
   'email_forward'),
  (@case_id, '2026-06-11', 'discovery',
   'CLDA Services / Adriana plain-English read of trust delivered',
   'Adriana Candelaria (cldaservices@gmail.com) returned a complete plain-English read of THE HOME-RANCH TRUST. Identified 14 substantive points + 5 confirm-questions requiring family + counsel attention. CC: val@atlanticandvine.com.',
   'email_forward');

-- ---------------------------------------------------------------------
-- 6. Seed Adriana's 5 confirm-questions as action items (per her email)
-- ---------------------------------------------------------------------
INSERT INTO case_action_items (case_id, title, detail, priority) VALUES
  (@case_id,
   'Confirm Cecilia receiving 1657 Kingsly Dr outright was intentional',
   'Adriana''s analysis Q1: Do Gordon and Maria Angelina truly intend Cecilia to receive the Pittsburg home outright (§6.G(2)) AND share equally in the residue (§6.G(3))? This is a major unequal distribution. Confirm with parents in person.',
   'urgent'),
  (@case_id,
   'Confirm surviving spouse should retain unrestricted change power',
   'Adriana''s analysis Q2: Do parents truly intend the surviving spouse to have unrestricted power to amend, revoke, or terminate the entire trust after the first death (§5.C(1))? This means the estate plan is NOT locked in after the first spouse dies.',
   'urgent'),
  (@case_id,
   'Confirm Cecilia as initial Trustee NOW (not parents acting as own trustees) was intentional',
   'Adriana''s analysis Q3: Do parents truly intend for Cecilia to serve as initial Trustee NOW (per §2.C), rather than Gordon and Maria Angelina acting as their own trustees during life? Adriana called this "unusual enough that I would confirm it was intentional."',
   'high'),
  (@case_id,
   'Clarify co-trustee authority — single-signature vs unilateral-decision conflict',
   'Adriana''s analysis Q4: §2.C(2) says co-Trustees can transact with one signature, but §3.J(5) says no one co-Trustee may make unilateral decisions other than ministerial acts. These can be reconciled (one signature = execution; unilateral decision = strategy), but the ambiguity should be clarified to prevent Cecilia from claiming unilateral sale authority.',
   'normal'),
  (@case_id,
   'Verify deed to 1657 Kingsly Dr + accounts are actually titled into the trust',
   'Adriana''s analysis Q5: Schedule A lists the residence + bank accounts + business interest, but title and beneficiary designations must be verified separately. Deeds and account titling matter. Specifically: business interest listed as "American Contractors Indemnity Company, a Sole Proprietorship" — clarify the entity form.',
   'urgent'),

  -- AV-added action items beyond Adriana's 5
  (@case_id,
   'Get email addresses for Gordon and Maria Angelina to add them as client_users',
   'AV: parents need their own client_user logins so they can see the case dashboard and approve sibling invites + financial summaries directly. Rebecca holds primary access until parents'' emails are provisioned.',
   'high'),
  (@case_id,
   'Confirm whether Gordon served in the military',
   'AV: if Gordon is a veteran, the Veterans Services panel activates and we can track Aid & Attendance eligibility + any benefits already in play.',
   'normal'),
  (@case_id,
   'Confirm whether mom said "TRUSTOR" or "TRUSTEE" on the unrecognized page',
   'AV: Per val 2026-06-11 — Maria Angelina mentioned a page she did not recognize that added Cecilia. The word matters. If TRUSTOR, that would be a forged amendment (§5.B requires both Trustors'' signatures). If TRUSTEE, that''s already in the trust as drafted and is part of Q3 above.',
   'high');

-- =====================================================================
-- VERIFY:
--   SELECT case_id, client_id, case_name, case_kind, status, wellness_enabled
--     FROM cases WHERE client_id = @client_id;
--   SELECT COUNT(*) AS parties FROM case_parties WHERE case_id = @case_id;
--   SELECT COUNT(*) AS events FROM case_events WHERE case_id = @case_id;
--   SELECT COUNT(*) AS actions FROM case_action_items WHERE case_id = @case_id;
--   SELECT * FROM case_property WHERE case_id = @case_id;
-- =====================================================================
-- END 090_johnson_family_case_seed.sql
-- =====================================================================
