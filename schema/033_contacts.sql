-- 033_contacts.sql
-- People layer: a CONTACT (a person) can be associated with MORE THAN ONE
-- company. Until now a "lead" row WAS the company and carried a single inline
-- contact_name/contact_title/email. That can't express "Skip works with two
-- businesses" or "this company has three contacts."
--
-- Idempotent + additive: CREATE TABLE IF NOT EXISTS only. Does NOT touch leads;
-- the inline contact_name/email on leads stays as-is (primary contact shortcut).
-- Soft references via indexes only (no hard FKs), matching the rest of the schema
-- and the archived_at soft-delete pattern.
--
--   contacts        one row per person (identified by email when present)
--   lead_contacts   join: which people are attached to which companies (leads),
--                   with a per-association role/title and is_primary flag.
--
-- A person on multiple companies = multiple lead_contacts rows sharing contact_id.
-- A company with multiple people = multiple lead_contacts rows sharing lead_id.

USE shhdbite_AV;

CREATE TABLE IF NOT EXISTS contacts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  full_name VARCHAR(255) NULL,
  email VARCHAR(320) NULL,                         -- a person is matched by email when given
  phone VARCHAR(64) NULL,
  notes VARCHAR(2000) NULL,
  archived_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_email (email),
  KEY idx_archived (archived_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS lead_contacts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  lead_id BIGINT UNSIGNED NOT NULL,                -- leads.id (the company)
  contact_id BIGINT UNSIGNED NOT NULL,             -- contacts.id (the person)
  title VARCHAR(255) NULL,                          -- this person's role AT this company
  is_primary TINYINT(1) NOT NULL DEFAULT 0,
  archived_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_lead_contact (lead_id, contact_id),
  KEY idx_lead (lead_id),
  KEY idx_contact (contact_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- End of 033. Run once in phpMyAdmin against shhdbite_AV. Re-runnable.
-- Verify:
--   SHOW TABLES LIKE 'contacts';
--   SHOW TABLES LIKE 'lead_contacts';
