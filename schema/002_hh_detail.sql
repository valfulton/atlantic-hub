-- =====================================================================
-- Atlantic Hub — HunterHoney Tenant Detail Tables
-- File: schema/002_hh_detail.sql
-- Target DB: shhdbite_hunterhoney  (ADDS to existing DB, does not drop it)
-- Run in: HostGator cPanel → phpMyAdmin → shhdbite_hunterhoney → SQL tab
-- =====================================================================
--
-- These are the per-tenant detail tables for HunterHoney. Each row has
-- an `account_id` that joins back to shhdbite_atlantic_hub.accounts.
--
-- IMPORTANT: account_id is NOT a SQL foreign key here, because MySQL
-- cannot enforce FKs across databases. The application layer enforces
-- the relationship — every detail-row INSERT happens inside the same
-- transaction-of-thought as the account upsert and the
-- tenant_account_link insert. If you ever need to verify integrity,
-- the query is:
--   SELECT s.subscriber_id, s.account_id
--   FROM shhdbite_hunterhoney.subscribers s
--   LEFT JOIN shhdbite_atlantic_hub.accounts a ON a.account_id = s.account_id
--   WHERE a.account_id IS NULL;
-- Should return zero rows.
-- =====================================================================

USE shhdbite_hunterhoney;

SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- =====================================================================
-- subscribers: HH newsletter signups + paid Member tier
-- =====================================================================
-- Source forms (Netlify):
--   hh_subscribe          → tier='free'
--   hh_paid_signup        → tier='member' or 'cohort' (set by application logic)
--
-- mrr_cents is the canonical MRR. Stored in cents to avoid floating-point.
-- =====================================================================
DROP TABLE IF EXISTS subscribers;
CREATE TABLE subscribers (
  subscriber_id     BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  account_id        CHAR(26) NOT NULL,
  tier              ENUM('free','member','cohort') NOT NULL DEFAULT 'free',
  signup_source     VARCHAR(80) NULL,
  mrr_cents         INT NOT NULL DEFAULT 0,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_account (account_id),
  KEY idx_tier_active (tier, is_active),
  KEY idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
-- fap_applications: Founding Advisor Partner applications
-- =====================================================================
-- Source form: hh_fap_apply
--
-- These are registered investment advisers (RIAs) applying to become
-- design partners. The CRD number lets us verify against the SEC's
-- Investment Adviser Public Disclosure (IAPD) website manually in v1.
--
-- application_notes is operator-facing only; never surfaced to the
-- applicant.
-- =====================================================================
DROP TABLE IF EXISTS fap_applications;
CREATE TABLE fap_applications (
  fap_app_id        BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  account_id        CHAR(26) NOT NULL,
  firm_name         VARCHAR(200) NULL,
  aum_range         VARCHAR(40) NULL,
  crd_number        VARCHAR(40) NULL,
  state_registered  VARCHAR(40) NULL,
  application_notes TEXT NULL,
  status            ENUM('submitted','in_review','approved','rejected','withdrawn') NOT NULL DEFAULT 'submitted',
  submitted_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at       DATETIME NULL,
  KEY idx_account (account_id),
  KEY idx_status (status),
  KEY idx_submitted (submitted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
-- cohort_waitlist: Cohort program waitlist signups
-- =====================================================================
-- Source form: hh_cohort_waitlist
--
-- cohort_target is the target start window (e.g., 'q3_2026'). Operator
-- assigns the actual cohort in v2 when running batches.
-- =====================================================================
DROP TABLE IF EXISTS cohort_waitlist;
CREATE TABLE cohort_waitlist (
  waitlist_id       BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  account_id        CHAR(26) NOT NULL,
  cohort_target     VARCHAR(40) NULL,
  experience_level  VARCHAR(40) NULL,
  added_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_account (account_id),
  KEY idx_added (added_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
-- research_api_customers: B2B Research API inquiries + active customers
-- =====================================================================
-- Source form: hh_research_api_inquiry (later: self-serve signup)
--
-- status progresses: inquiry → pilot → active → churned
-- =====================================================================
DROP TABLE IF EXISTS research_api_customers;
CREATE TABLE research_api_customers (
  customer_id       BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  account_id        CHAR(26) NOT NULL,
  organization_name VARCHAR(200) NULL,
  use_case          TEXT NULL,
  estimated_volume  VARCHAR(40) NULL,
  status            ENUM('inquiry','pilot','active','churned') NOT NULL DEFAULT 'inquiry',
  mrr_cents         INT NOT NULL DEFAULT 0,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_account (account_id),
  KEY idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
-- Done. Verify with:
--   USE shhdbite_hunterhoney;
--   SHOW TABLES LIKE 'subscribers';
--   SHOW TABLES LIKE 'fap_applications';
--   SHOW TABLES LIKE 'cohort_waitlist';
--   SHOW TABLES LIKE 'research_api_customers';
-- Expect: 4 rows total.
-- =====================================================================
