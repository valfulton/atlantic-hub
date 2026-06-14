-- =====================================================================
-- schema/090_case_email_bridge.sql  (val 2026-06-13, #645)
--
-- Per-case email forwarding inbox so anyone who can access the case can
-- forward a text message, a photo of a bill, a recorded deed, etc. to
-- the case's email address and have it land in the case_documents vault
-- (or a parallel inbox table for triage).
--
-- Pattern follows the existing per-client PR inbox (clients.pr_inbox_slug,
-- #226). Same shape: a random URL-safe slug becomes the local-part of an
-- email address routed through inbound-parse → app handler → attachments
-- saved + audit row written.
--
-- Idempotent. Safe to run repeatedly.
-- =====================================================================

USE shhdbite_AV;

-- ---------------------------------------------------------------------
-- 1. cases.email_slug — the random local-part for the per-case inbox.
--    e.g. "case-johnson-7a3b9c2f" → 7a3b9c2f@cases.api.atlanticandvine.com
--    Slugs are random 16-hex chars — guessability is the only auth.
-- ---------------------------------------------------------------------
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = 'shhdbite_AV'
     AND TABLE_NAME = 'cases'
     AND COLUMN_NAME = 'email_slug'
);
SET @ddl := IF(
  @col_exists = 0,
  'ALTER TABLE cases
     ADD COLUMN email_slug VARCHAR(40) DEFAULT NULL
       COMMENT "Random URL-safe slug used as the local-part of the case email inbox. NULL until provisioned.",
     ADD UNIQUE KEY uq_cases_email_slug (email_slug)',
  'SELECT "email_slug column already present — skipped" AS info'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------
-- 2. case_inbound_messages — landing pad for forwarded emails/texts
--    before they get triaged into case_documents or notes.
--
-- One row per inbound email. Attachments are stored separately in the
-- existing asset/blob path and linked by attachment_url JSON array.
-- Status flow: received → parsed → attached_to_case / dismissed.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS case_inbound_messages (
  message_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  case_id BIGINT UNSIGNED NOT NULL,
  received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sender_address VARCHAR(255) NULL
    COMMENT 'Email From: header. For SMS-via-email this is the carrier wrapper (e.g. 5105551234@vzwpix.com).',
  sender_phone VARCHAR(40) NULL
    COMMENT 'Phone number extracted from carrier wrapper, when present. Used to match case_parties.contact_phone for attribution.',
  matched_party_id BIGINT UNSIGNED NULL
    COMMENT 'case_parties.party_id when sender_phone or sender_address matched a known party.',
  subject VARCHAR(500) NULL,
  body_text TEXT NULL,
  body_html LONGTEXT NULL,
  attachments JSON NULL
    COMMENT 'Array of {filename, contentType, sizeBytes, storedUrl}.',
  status ENUM('received','parsed','attached_to_case','dismissed','spam')
    NOT NULL DEFAULT 'received'
    COMMENT 'Triage state — receivers see attached_to_case in the case vault.',
  triaged_by_user_id BIGINT UNSIGNED NULL,
  triaged_at DATETIME NULL,
  triage_notes TEXT NULL,
  raw_payload JSON NULL
    COMMENT 'Full inbound webhook payload kept for forensic audit + reprocessing.',
  KEY idx_case_inbound_case (case_id, status, received_at),
  KEY idx_case_inbound_party (matched_party_id),
  CONSTRAINT fk_case_inbound_case
    FOREIGN KEY (case_id) REFERENCES cases(case_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- 3. Backfill: generate email_slug for every existing case so the
--    forwarding addresses are ready to use immediately. Random 16-hex.
-- ---------------------------------------------------------------------
UPDATE cases
SET email_slug = SUBSTRING(
  CONCAT(
    LOWER(REPLACE(UUID(), '-', '')),
    LOWER(REPLACE(UUID(), '-', ''))
  ),
  1, 16
)
WHERE email_slug IS NULL;

-- ---------------------------------------------------------------------
-- 4. Verify — show every case's forwarding address.
-- ---------------------------------------------------------------------
SELECT
  case_id,
  case_name,
  email_slug,
  CONCAT(email_slug, '@cases.api.atlanticandvine.com') AS forwarding_address
FROM cases
ORDER BY case_id;
