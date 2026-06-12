-- =====================================================================
-- Atlantic Hub -- Case Management module + Family Wellness wrapper
-- File:    schema/089_case_management.sql
-- Target:  shhdbite_AV
-- Run in:  HostGator phpMyAdmin -> shhdbite_AV -> SQL tab -> paste -> Go
-- =====================================================================
--
-- WHY: Universal case-management module any legal-needs client can use.
-- Reusable by Ron (defense_pr cases), John (political_campaign legal),
-- Adriana's CLDA cases, the Johnson family (the first case), and any
-- future law-firm client. Anchored on the Johnson family elder-advocacy
-- case opened 2026-06-11. NOT elder-specific by design — case_kind
-- distinguishes (trust_dispute, malpractice_defense, campaign_legal,
-- elder_advocacy, general_litigation, etc.).
--
-- WRAPPER: family wellness tables sit on top of the case module to
-- support multi-party visibility into health, financial housekeeping,
-- VA benefits, sibling co-access, and parent approval workflows. Used
-- when case_kind IN ('elder_advocacy','trust_dispute','guardianship')
-- but available to any case.
--
-- ALSO: extends brand_members.engagement_kind enum with 'legal_case'
-- so a client whose primary engagement IS case work has the right
-- dashboard shell (vs a marketing-driven engagement).
--
-- IDEMPOTENT: information_schema guards in 058/085 house style.
-- =====================================================================

USE shhdbite_AV;
SET NAMES utf8mb4;

-- ---------------------------------------------------------------------
-- 1. Extend brand_members.engagement_kind enum with 'legal_case'
-- ---------------------------------------------------------------------
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA='shhdbite_AV'
    AND TABLE_NAME='brand_members'
    AND COLUMN_NAME='engagement_kind'
    AND COLUMN_TYPE LIKE '%legal_case%');
SET @sql := IF(@c=0,
  "ALTER TABLE brand_members
     MODIFY COLUMN engagement_kind ENUM(
       'lead_gen',
       'defense_pr',
       'political_campaign',
       'luxury_hospitality',
       'book_pr',
       'legal_case'
     ) NOT NULL DEFAULT 'lead_gen'
       COMMENT 'Kind of engagement for this brand. Drives dashboard/welcome/intake/brief. legal_case added 2026-06-11 for case-anchored clients (Johnson family first).'",
  "SELECT 'brand_members.engagement_kind already includes legal_case -- skipped' AS info");
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ---------------------------------------------------------------------
-- 2. cases -- top-level case record (one client may have multiple)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cases (
  case_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  client_id BIGINT UNSIGNED NOT NULL,
  case_name VARCHAR(200) NOT NULL,
  case_kind VARCHAR(40) NOT NULL DEFAULT 'general_litigation',
  case_synopsis TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'open',
  opened_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at DATETIME NULL,
  wellness_enabled BOOLEAN NOT NULL DEFAULT FALSE
    COMMENT 'Set true for cases that should surface the family wellness wrapper.',
  metadata JSON
    COMMENT 'Case-specific fields: property address, trust name, court name, opposing party, etc.',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_cases_client_status (client_id, status),
  KEY idx_cases_kind (case_kind),
  CONSTRAINT fk_cases_client FOREIGN KEY (client_id) REFERENCES clients(client_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  COMMENT='Universal case record. case_kind distinguishes trust_dispute / elder_advocacy / malpractice_defense / campaign_legal / etc.';

-- ---------------------------------------------------------------------
-- 3. case_events -- timeline (append-only)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS case_events (
  event_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  case_id BIGINT UNSIGNED NOT NULL,
  event_date DATE NOT NULL,
  event_kind VARCHAR(40)
    COMMENT 'signed / filed / meeting / communication / discovery / milestone / wellness_check / health_event',
  event_title VARCHAR(200) NOT NULL,
  event_detail TEXT,
  source VARCHAR(120)
    COMMENT 'email_forward / manual / recorder_pull / court_filing / etc.',
  source_uri VARCHAR(500),
  created_by_user_id BIGINT UNSIGNED,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_case_events_case_date (case_id, event_date),
  CONSTRAINT fk_case_events_case FOREIGN KEY (case_id) REFERENCES cases(case_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- 4. case_documents -- evidence + correspondence vault
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS case_documents (
  document_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  case_id BIGINT UNSIGNED NOT NULL,
  document_name VARCHAR(300) NOT NULL,
  document_kind VARCHAR(40)
    COMMENT 'trust / will / poa / advance_directive / deed / property_report / court_filing / evidence / correspondence / financial / medical',
  storage_uri VARCHAR(500) NOT NULL
    COMMENT 'durable hot storage URI (Netlify Blobs / S3 / Arweave). Per lib/storage/provenance.ts.',
  content_hash CHAR(64)
    COMMENT 'SHA-256 of file contents (provenance + dedupe).',
  mime_type VARCHAR(80),
  size_bytes BIGINT,
  uploaded_by_user_id BIGINT UNSIGNED,
  uploaded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notes TEXT,
  KEY idx_case_documents_case (case_id, document_kind),
  CONSTRAINT fk_case_documents_case FOREIGN KEY (case_id) REFERENCES cases(case_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- 5. case_parties -- named parties (trustors, trustees, beneficiaries, etc.)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS case_parties (
  party_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  case_id BIGINT UNSIGNED NOT NULL,
  full_name VARCHAR(200) NOT NULL,
  role VARCHAR(60)
    COMMENT 'trustor / trustee / successor_trustee / beneficiary / opposing_party / fiduciary / witness / counsel / patient / caregiver / health_agent / financial_agent',
  contact_email VARCHAR(200),
  contact_phone VARCHAR(40),
  relationship VARCHAR(120)
    COMMENT 'daughter / son / spouse / sister / etc.',
  is_veteran BOOLEAN NOT NULL DEFAULT FALSE
    COMMENT 'Triggers veterans services panel when true.',
  is_parent BOOLEAN NOT NULL DEFAULT FALSE
    COMMENT 'Triggers parent-control approval flow when true.',
  notes TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_case_parties_case (case_id, role),
  CONSTRAINT fk_case_parties_case FOREIGN KEY (case_id) REFERENCES cases(case_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- 6. case_action_items -- open / in-progress / done / blocked tasks
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS case_action_items (
  action_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  case_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(300) NOT NULL,
  detail TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'open'
    COMMENT 'open / in_progress / done / blocked',
  priority VARCHAR(10) NOT NULL DEFAULT 'normal'
    COMMENT 'low / normal / high / urgent',
  assigned_to_user_id BIGINT UNSIGNED NULL,
  due_date DATE NULL,
  completed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_case_actions_case_status (case_id, status, priority),
  CONSTRAINT fk_case_actions_case FOREIGN KEY (case_id) REFERENCES cases(case_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- 7. case_property -- real-property facts (auto-populated from recorder)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS case_property (
  property_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  case_id BIGINT UNSIGNED NOT NULL,
  address_line VARCHAR(300),
  city VARCHAR(120),
  state CHAR(2),
  zip VARCHAR(15),
  county VARCHAR(120),
  apn VARCHAR(60)
    COMMENT 'Assessor parcel number.',
  current_titled_owner VARCHAR(300),
  estimated_value_cents BIGINT
    COMMENT 'Estimated market value in USD cents.',
  known_liens JSON
    COMMENT 'Array of {lien_type, amount_cents, holder, recorded_date}.',
  known_mortgages JSON
    COMMENT 'Array of {lender, balance_cents, originated_date}.',
  equity_cents BIGINT
    COMMENT 'Computed: estimated_value - sum(liens) - sum(mortgages).',
  last_recorder_pull_at DATETIME NULL,
  recorder_source VARCHAR(40)
    COMMENT 'ca_contra_costa_recorder / md_land_rec / etc.',
  notes TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_case_property_case (case_id),
  KEY idx_case_property_address (state, zip, address_line(80)),
  CONSTRAINT fk_case_property_case FOREIGN KEY (case_id) REFERENCES cases(case_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =====================================================================
-- FAMILY WELLNESS WRAPPER (composes with cases above)
-- Activated when cases.wellness_enabled = TRUE
-- =====================================================================

-- ---------------------------------------------------------------------
-- 8. family_health_roster -- current doctors, medications, conditions
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS family_health_roster (
  roster_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  case_id BIGINT UNSIGNED NOT NULL,
  party_id BIGINT UNSIGNED
    COMMENT 'Which party in case_parties this is for (usually a parent).',
  category VARCHAR(40) NOT NULL
    COMMENT 'primary_care / specialist / dentist / pharmacy / insurance / medicare / medicaid / medication / condition / allergy',
  label VARCHAR(200) NOT NULL,
  details TEXT,
  contact_name VARCHAR(200),
  contact_phone VARCHAR(40),
  contact_address VARCHAR(300),
  carrier_number VARCHAR(60),
  last_visit_date DATE NULL,
  next_visit_date DATE NULL,
  notes TEXT,
  added_by_user_id BIGINT UNSIGNED,
  added_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_family_health_case_party_cat (case_id, party_id, category),
  CONSTRAINT fk_family_health_case FOREIGN KEY (case_id) REFERENCES cases(case_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- 9. family_care_appointments -- upcoming + completed appointments
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS family_care_appointments (
  appointment_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  case_id BIGINT UNSIGNED NOT NULL,
  party_id INT,
  appointment_kind VARCHAR(40)
    COMMENT 'doctor / specialist / lab / imaging / therapy / pharmacy_pickup / va / other',
  scheduled_at DATETIME NOT NULL,
  provider_name VARCHAR(200),
  location VARCHAR(300),
  transport_responsible_user_id BIGINT UNSIGNED NULL,
  notes TEXT,
  completed BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at DATETIME NULL,
  outcome_notes TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_family_appts_case_sched (case_id, scheduled_at),
  CONSTRAINT fk_family_appts_case FOREIGN KEY (case_id) REFERENCES cases(case_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- 10. family_veterans_services -- VA benefits + applications
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS family_veterans_services (
  va_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  case_id BIGINT UNSIGNED NOT NULL,
  party_id BIGINT UNSIGNED
    COMMENT 'Which veteran party.',
  service_branch VARCHAR(40)
    COMMENT 'army / navy / air_force / marines / coast_guard / space_force / national_guard',
  service_start_date DATE NULL,
  service_end_date DATE NULL,
  discharge_status VARCHAR(40)
    COMMENT 'honorable / general / other',
  va_case_number VARCHAR(60),
  va_case_worker_name VARCHAR(200),
  va_case_worker_phone VARCHAR(40),
  disability_rating_pct INT NULL
    COMMENT '0-100 service-connected disability percentage.',
  benefits_in_play JSON
    COMMENT 'Array of {benefit_name, status, monthly_amount_cents, since_date}.',
  applications_in_flight JSON
    COMMENT 'Array of {application_kind, status, submitted_date, notes}.',
  notes TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_family_va_case_party (case_id, party_id),
  CONSTRAINT fk_family_va_case FOREIGN KEY (case_id) REFERENCES cases(case_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- 11. family_financial_summary -- monthly running balance + runway
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS family_financial_summary (
  summary_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  case_id BIGINT UNSIGNED NOT NULL,
  reporting_period_start DATE NOT NULL,
  reporting_period_end DATE NOT NULL,
  income_total_cents BIGINT,
  expense_total_cents BIGINT,
  ending_balance_cents BIGINT,
  monthly_burn_estimate_cents BIGINT,
  estimated_runway_months INT
    COMMENT 'How long current balance lasts at current burn rate.',
  notes TEXT,
  prepared_by_user_id BIGINT UNSIGNED,
  prepared_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  approved_by_parent BOOLEAN NOT NULL DEFAULT FALSE,
  approved_at DATETIME NULL,
  approved_by_user_id BIGINT UNSIGNED NULL,
  KEY idx_family_finsum_case_period (case_id, reporting_period_start),
  CONSTRAINT fk_family_finsum_case FOREIGN KEY (case_id) REFERENCES cases(case_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- 12. family_meeting_notes -- housekeeping meeting log
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS family_meeting_notes (
  meeting_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  case_id BIGINT UNSIGNED NOT NULL,
  meeting_date DATE NOT NULL,
  meeting_kind VARCHAR(40)
    COMMENT 'financial_housekeeping / care_coordination / all_hands / parents_only',
  attendees JSON
    COMMENT 'Array of {user_id, name, relationship_to_family}.',
  agenda TEXT,
  notes TEXT,
  decisions JSON
    COMMENT 'Array of {decision_text, decided_by, requires_parent_approval}.',
  parents_approved BOOLEAN NOT NULL DEFAULT FALSE,
  parents_approved_at DATETIME NULL,
  follow_up_actions JSON
    COMMENT 'Array of {action, owner_user_id, due_date}.',
  led_by_user_id BIGINT UNSIGNED,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_family_meetings_case_date (case_id, meeting_date),
  CONSTRAINT fk_family_meetings_case FOREIGN KEY (case_id) REFERENCES cases(case_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- 13. family_wellness_checks -- periodic observations
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS family_wellness_checks (
  check_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  case_id BIGINT UNSIGNED NOT NULL,
  party_observed_id BIGINT UNSIGNED
    COMMENT 'Which party was observed.',
  observed_at DATETIME NOT NULL,
  observed_by_user_id BIGINT UNSIGNED NOT NULL,
  observation_kind VARCHAR(40)
    COMMENT 'in_person / phone / video / reported_by_third_party',
  cognition_note TEXT,
  mood_note TEXT,
  physical_note TEXT,
  unusual_contacts_note TEXT
    COMMENT 'Did anyone unusual call / visit / try to influence them.',
  concerns TEXT,
  positive_observations TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_family_wellness_case_obs (case_id, observed_at),
  CONSTRAINT fk_family_wellness_case FOREIGN KEY (case_id) REFERENCES cases(case_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- 14. family_case_collaborators -- per-case sibling/family co-access
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS family_case_collaborators (
  collaborator_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  case_id BIGINT UNSIGNED NOT NULL,
  client_user_id BIGINT UNSIGNED NOT NULL
    COMMENT 'The client_user login that has access to this case.',
  role VARCHAR(40) NOT NULL
    COMMENT 'parent / primary_caregiver / sibling_reader / sibling_commenter / sibling_admin / advisor / attorney',
  invited_by_user_id BIGINT UNSIGNED NOT NULL,
  invited_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  invitation_accepted BOOLEAN NOT NULL DEFAULT FALSE,
  accepted_at DATETIME NULL,
  parent_approved BOOLEAN NOT NULL DEFAULT FALSE
    COMMENT 'Per parent-control rule: invites in pending state until a parent approves.',
  parent_approved_at DATETIME NULL,
  parent_approved_by_user_id BIGINT UNSIGNED NULL,
  revoked_at DATETIME NULL,
  permissions JSON
    COMMENT '{can_view, can_comment, can_upload, can_invite, can_log_wellness, can_log_financials, can_view_health_detail}.',
  UNIQUE KEY uq_family_collab_case_user (case_id, client_user_id),
  KEY idx_family_collab_case (case_id),
  CONSTRAINT fk_family_collab_case FOREIGN KEY (case_id) REFERENCES cases(case_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =====================================================================
-- VERIFY (run these manually to confirm install):
--
--   SELECT TABLE_NAME, TABLE_ROWS, TABLE_COMMENT
--     FROM information_schema.TABLES
--    WHERE TABLE_SCHEMA = 'shhdbite_AV'
--      AND TABLE_NAME IN (
--        'cases','case_events','case_documents','case_parties',
--        'case_action_items','case_property',
--        'family_health_roster','family_care_appointments',
--        'family_veterans_services','family_financial_summary',
--        'family_meeting_notes','family_wellness_checks',
--        'family_case_collaborators'
--      )
--    ORDER BY TABLE_NAME;
--
--   SELECT COLUMN_TYPE FROM information_schema.COLUMNS
--    WHERE TABLE_SCHEMA='shhdbite_AV' AND TABLE_NAME='brand_members'
--      AND COLUMN_NAME='engagement_kind';
--   -- Should include 'legal_case' in the enum.
-- =====================================================================
-- END 089_case_management.sql
-- =====================================================================
