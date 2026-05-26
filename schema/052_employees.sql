-- 052_employees.sql
-- Employee / sales-rep system. An "employee" is an admin_users row with
-- role='staff'. This adds: (1) a self-serve set-password invite flow for staff
-- (admin_users currently REQUIRE a password at creation and have no invite
-- token, unlike client_users), (2) an employee_profiles table for onboarding
-- application data + contract signature, (3) employee_documents for uploaded
-- files (W-9, IDs, signed agreements — sensitive data lives here as files, NOT
-- as columns).
--
-- MySQL: run ONCE, in order, in shhdbite_AV. Plain ADD COLUMN / CREATE TABLE.

USE shhdbite_AV;

-- (1) Staff set-password invite. password_hash is NOT NULL on admin_users, so
-- create-employee seeds an unusable placeholder hash and issues this token; the
-- employee sets their real password via the invite link (mirrors client flow).
ALTER TABLE admin_users
  ADD COLUMN set_password_token       CHAR(64) NULL AFTER password_hash,
  ADD COLUMN set_password_expires_at  DATETIME NULL AFTER set_password_token;

ALTER TABLE admin_users
  ADD KEY idx_set_password_token (set_password_token);

-- (2) Employee onboarding profile. One row per staff user. Non-sensitive
-- application fields are structured; everything else the form sends is kept in
-- application_payload (JSON), same shape idea as the client brief payload.
CREATE TABLE IF NOT EXISTS employee_profiles (
  profile_id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id               BIGINT UNSIGNED NOT NULL,            -- admin_users.user_id
  status                ENUM('invited','applied','active','inactive') NOT NULL DEFAULT 'invited',
  title                 VARCHAR(160) NULL,                   -- role / job title
  phone                 VARCHAR(40) NULL,
  location              VARCHAR(200) NULL,                   -- city/state (NOT full home address)
  start_date            DATE NULL,
  comp_basis            VARCHAR(255) NULL,                   -- e.g. "commission + residual"
  emergency_contact     VARCHAR(255) NULL,
  application_payload    JSON NULL,                          -- full form answers (non-sensitive)
  application_completed_at DATETIME NULL,
  contract_signed_name  VARCHAR(160) NULL,                   -- typed signature
  contract_signed_at    DATETIME NULL,
  contract_doc_url      VARCHAR(500) NULL,                   -- the contract they signed
  created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_employee_user (user_id),
  KEY idx_status (status)
);

-- (3) Documents attached to an employee (application, contract, W-9, IDs, etc.).
-- Sensitive personal docs belong HERE as files, never as profile columns.
CREATE TABLE IF NOT EXISTS employee_documents (
  doc_id        BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id       BIGINT UNSIGNED NOT NULL,                   -- admin_users.user_id
  label         VARCHAR(200) NOT NULL,
  file_url      VARCHAR(700) NOT NULL,
  content_type  VARCHAR(120) NULL,
  uploaded_by   BIGINT UNSIGNED NULL,                       -- admin_users.user_id of operator
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_emp_docs_user (user_id)
);
