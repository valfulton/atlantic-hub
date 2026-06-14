-- =====================================================================
-- schema/091_trust_faq_library.sql  (val 2026-06-13, #638 starter)
--
-- Library of commonly asked questions about trusts, elder care, and the
-- fiduciary process, with answer templates that the family_tutorial
-- narrative-line kind (#638) consumes to generate plain-English videos
-- for beneficiaries, trustees, and family members.
--
-- The library is UNIVERSAL — not Johnson-specific. Any future family-care
-- case (or estate-litigation, or guardianship) pulls from this same
-- library and renders client-specific video tutorials by substituting
-- the case context.
--
-- Idempotent. Safe to run repeatedly.
-- =====================================================================

USE shhdbite_AV;

-- ---------------------------------------------------------------------
-- 1. trust_faq_library — the question + answer-template + video plan.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trust_faq_library (
  faq_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  category ENUM(
    'trust_basics',
    'trustee_duties',
    'beneficiary_rights',
    'amendment_and_revocation',
    'incapacity_and_succession',
    'real_property',
    'finances_and_reporting',
    'taxes',
    'care_directives',
    'family_communication',
    'dispute_and_protection',
    'after_death'
  ) NOT NULL,
  audience ENUM('beneficiary','trustee','any_family_member','professional')
    NOT NULL DEFAULT 'any_family_member'
    COMMENT 'Who this question is FOR. Drives video pacing + vocabulary.',
  question_short VARCHAR(300) NOT NULL
    COMMENT 'The question as a beneficiary or trustee would ask it.',
  question_long TEXT
    COMMENT 'Expanded framing if the short form leaves out context.',
  answer_template TEXT NOT NULL
    COMMENT 'Plain-English answer with {placeholder} variables for case-specific substitution (e.g. {trust_name}, {trustee_name}, {state_law_cite}).',
  legal_cites VARCHAR(500)
    COMMENT 'CA Probate Code / W&I Code sections relevant to the answer.',
  video_runtime_seconds INT DEFAULT 90
    COMMENT 'Target runtime of the generated tutorial video.',
  video_voice ENUM('warm_documentary','calm_explainer','plain_announcer')
    NOT NULL DEFAULT 'warm_documentary',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_faq_category (category, audience, is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- 2. case_faq_responses — per-case answers Rebecca/Adriana record.
--    When a family asks a question that's NOT in the library, Rebecca
--    answers it once, the response gets attached to a video, and it's
--    searchable on the case dashboard. Optionally promoted into the
--    universal library if it's broadly applicable.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS case_faq_responses (
  response_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  case_id BIGINT UNSIGNED NOT NULL,
  faq_id BIGINT UNSIGNED NULL
    COMMENT 'NULL = case-specific question not yet in the universal library.',
  asked_by_party_id BIGINT UNSIGNED NULL,
  question_text VARCHAR(500) NOT NULL,
  answer_text TEXT NOT NULL,
  video_url VARCHAR(500),
  video_runtime_seconds INT,
  video_provenance_hash VARCHAR(128)
    COMMENT 'C2PA / SHA-256 of the rendered video for tamper detection.',
  recorded_by_user_id BIGINT UNSIGNED NOT NULL
    COMMENT 'client_user_id of Rebecca or Adriana who authored the response.',
  visibility ENUM('parents_safe','operator_only') NOT NULL DEFAULT 'parents_safe',
  status ENUM('draft','reviewed','published','archived') NOT NULL DEFAULT 'draft',
  promoted_to_library_at DATETIME NULL
    COMMENT 'When this response was promoted into trust_faq_library as a universal Q&A.',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_case_faq_case (case_id, status, visibility),
  KEY idx_case_faq_library (faq_id),
  CONSTRAINT fk_case_faq_case FOREIGN KEY (case_id) REFERENCES cases(case_id) ON DELETE CASCADE,
  CONSTRAINT fk_case_faq_library FOREIGN KEY (faq_id) REFERENCES trust_faq_library(faq_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- 3. Seed the starter library — universal questions every family case
--    can pull from. Twelve to start; intentionally short list so val
--    can shape the library shape before bulk-seeding. Categories cover
--    the 90% of what trustees and beneficiaries ask.
-- ---------------------------------------------------------------------

INSERT INTO trust_faq_library
  (category, audience, question_short, answer_template, legal_cites, video_runtime_seconds, video_voice)
VALUES
-- Trust basics
('trust_basics','beneficiary',
 'What is a revocable trust and what does it mean for me?',
 'A revocable trust is a legal arrangement where the people who created it (the Trustors) move their property into a trust they continue to control during their lifetime. They can change it, revoke it, or take property back out at any time. As a beneficiary, what matters most is that until both Trustors have passed, the trust is theirs to shape. Your interest is honored — but it does not vest in the same way until that time.',
 'CA Probate Code §15400, §15401',
 90, 'warm_documentary'),

-- Trustee duties
('trustee_duties','trustee',
 'What does it mean to be a fiduciary?',
 'Being a fiduciary means you are legally bound to act in another person''s best interest before your own. As trustee, you owe the beneficiaries — and the Trustors during their lifetime — a duty of loyalty, a duty of care, and a duty of transparency. Every decision you make should be documented, defensible, and made for the right reasons. When in doubt, you ask a professional and you put the question in writing.',
 'CA Probate Code §16000, §16002, §16003, §16004',
 105, 'calm_explainer'),

-- Beneficiary rights
('beneficiary_rights','beneficiary',
 'Am I entitled to see the trust document and the accounting?',
 'Once the trust becomes irrevocable — typically when both Trustors have passed — yes, you have a statutory right to receive a copy of the trust and a true accounting of how trust property has been managed. While the trust is still revocable, the Trustors control who sees what. Your trustee should still be transparent with you, but the legal trigger for documents and accounting is irrevocability.',
 'CA Probate Code §16060, §16061.5, §16061.7, §16062',
 90, 'calm_explainer'),

-- Amendment and revocation
('amendment_and_revocation','any_family_member',
 'Can the trust be changed after it is signed?',
 'In most revocable trusts, yes. The Trustors who created it can usually amend the trust (change specific provisions) or revoke it entirely (collapse it back into their personal ownership). The trust document itself specifies HOW changes can be made — sometimes either Trustor alone, sometimes both Trustors together, sometimes with a notary, sometimes without. Read your trust''s amendment provisions before making any change.',
 'CA Probate Code §15401, §15402',
 75, 'plain_announcer'),

-- Incapacity and succession
('incapacity_and_succession','any_family_member',
 'What happens if a Trustor becomes incapacitated?',
 'A well-drafted trust includes incapacity provisions: a Successor Trustee steps in to manage the trust property when the Trustor is no longer able to. The trust typically requires a written determination from one or two licensed physicians before the Successor Trustee takes over. This is one of the most important reasons to have a trust — it keeps your loved one''s wishes in motion even if they cannot make decisions themselves.',
 'CA Probate Code §15800, §15802',
 105, 'warm_documentary'),

-- Real property
('real_property','any_family_member',
 'Does the trust own our home, or do we still own it?',
 'When property is "titled to" a trust, the trust is the legal owner of record. But for a revocable trust where the Trustors are also the beneficiaries during their lifetime, the practical control stays with the Trustors — they live there, they pay the mortgage, they decide. Titling to the trust mostly affects what happens at death (it avoids probate) and during incapacity (the Successor Trustee can act). For all the day-to-day purposes of being in your home, nothing changes.',
 'CA Probate Code §15403, §16002',
 90, 'warm_documentary'),

-- Finances and reporting
('finances_and_reporting','trustee',
 'How often do I need to provide a financial accounting?',
 'For a revocable trust during the Trustors'' lifetime, the legal accounting requirement is usually waived. But best practice — and your duty of transparency — is to provide a clear summary at least annually, more often if family members ask. After the trust becomes irrevocable, formal accountings are required at least annually unless waived by the trust document and all beneficiaries in writing.',
 'CA Probate Code §16060, §16062, §16063',
 90, 'calm_explainer'),

-- Care directives
('care_directives','any_family_member',
 'How does the trust work with healthcare and care directives?',
 'The trust handles financial decisions and property. A separate document — usually called an Advance Health Care Directive or a Healthcare Power of Attorney — handles medical decisions. The two are coordinated but separate. Make sure both exist, both name the right people, and both are accessible to the family before they are needed.',
 'CA Probate Code §4670 et seq (Healthcare Decisions Law)',
 75, 'warm_documentary'),

-- Family communication
('family_communication','any_family_member',
 'What if family members disagree about something the trustee is doing?',
 'The trustee''s duty is to the trust and its purposes — not to any one family member''s wishes. When disagreements come up, the trustee documents the concern, considers it, and explains the decision. If the disagreement is serious, the family member has the right to petition the probate court for review. The best protection against disputes is transparency from the trustee BEFORE family members feel they have to ask.',
 'CA Probate Code §17200, §17202',
 90, 'calm_explainer'),

-- Dispute and protection (sensitive)
('dispute_and_protection','any_family_member',
 'What protections exist if a family member is being financially mistreated?',
 'California law treats financial mistreatment of an elder seriously. Welfare and Institutions Code §15610.30 defines financial elder abuse as taking, secreting, or appropriating property from someone 65 or older for wrongful use or with intent to defraud. §15610.43 addresses isolation. Probate Code §86 addresses undue influence. The protections include both civil remedies (recovery of property, attorney fees) and criminal penalties. Document concerns carefully and consult counsel early.',
 'CA W&I Code §15610.30, §15610.43; CA Probate Code §86; CA Civil Code §3345',
 120, 'calm_explainer'),

-- After death
('after_death','any_family_member',
 'What happens to the trust when one of the Trustors passes away?',
 'In most joint revocable trusts, when the first Trustor passes, the trust continues — usually with the surviving Trustor retaining most or all of the same powers, depending on what the trust says. After the SECOND Trustor passes, the trust typically becomes irrevocable and the distribution provisions take effect. Read your trust carefully — what happens after the first death is one of the most important provisions, and not all trusts work the same way.',
 'CA Probate Code §15401, §16061.7',
 105, 'warm_documentary'),

-- Taxes (light overview)
('taxes','any_family_member',
 'Are there tax consequences when property is in a trust?',
 'For a revocable trust during the Trustors'' lifetime, the trust is generally tax-transparent — the Trustors report income on their own returns as if they owned the property directly. No separate trust tax return is typically required. The picture changes when the trust becomes irrevocable: a separate trust EIN, a separate tax return, and different rate brackets may apply. Talk to a CPA familiar with trusts before assuming any tax outcome.',
 'IRC §671-678 (grantor trust rules); CA Rev. & Tax. Code §17745',
 90, 'plain_announcer');

-- ---------------------------------------------------------------------
-- 4. Verify — show the seeded library.
-- ---------------------------------------------------------------------
SELECT
  faq_id, category, audience, question_short, video_runtime_seconds
FROM trust_faq_library
ORDER BY category, faq_id;
