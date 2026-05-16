-- =====================================================================
-- Atlantic Hub — Events by Water tenant detail
-- File:    schema/005_ebw_detail.sql
-- Target:  shhdbite_eventsbywater  (the live EBW HostGator DB)
-- Run in:  HostGator cPanel → phpMyAdmin → shhdbite_eventsbywater → SQL tab
-- =====================================================================
--
-- WHAT THIS DOES
--   Adds three small Val-facing tables on top of the existing EBW form
--   tables. The EBW website already writes 7 tables via form_handler.php:
--     charter_inquiries, captain_applications, vessel_listings,
--     investor_registrations, ethics_invitations, jet_inquiries,
--     speaker_applications.
--   Those stay untouched and feed the EBW tab in atlantic-hub as
--   read-only views.
--
--   The three new tables below are for things Val logs herself:
--     - bookings:        confirmed charter bookings (closed sales)
--     - revenue_entries: revenue by stream (5 streams from the launch plan)
--     - marketing_activity: cold calls/emails/meetings tied to a prospect
--
-- IDEMPOTENT: uses CREATE TABLE IF NOT EXISTS. Safe to re-run.
-- =====================================================================

USE shhdbite_eventsbywater;
SET NAMES utf8mb4;

-- ---------------------------------------------------------------------
-- bookings — Val logs each confirmed charter booking
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bookings (
  booking_id        BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  booking_uuid      CHAR(36) NOT NULL,
  booked_on         DATE NOT NULL,
  event_date        DATE NULL,
  customer_name     VARCHAR(255) NOT NULL,
  customer_email    VARCHAR(255) NULL,
  customer_phone    VARCHAR(50)  NULL,
  market            VARCHAR(100) NULL
    COMMENT 'St. Croix, Miami, Annapolis, DC/Potomac, SF Bay, other',
  group_size        SMALLINT UNSIGNED NULL,
  event_type        VARCHAR(100) NULL
    COMMENT 'wedding, corporate retreat, charter, party, jet, etc.',
  vessel_partner    VARCHAR(255) NULL,
  event_planner     VARCHAR(255) NULL,
  gross_revenue     DECIMAL(10,2) NULL,
  ebw_commission    DECIMAL(10,2) NULL,
  status            ENUM('booked','deposit_paid','completed','cancelled','refunded') NOT NULL DEFAULT 'booked',
  source_inquiry_id INT UNSIGNED NULL
    COMMENT 'FK to charter_inquiries.id (app-enforced, no MySQL FK constraint to keep the form tables independent)',
  notes             TEXT NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  archived_at       DATETIME NULL,
  UNIQUE KEY uq_booking_uuid (booking_uuid),
  KEY idx_booked_on (booked_on),
  KEY idx_event_date (event_date),
  KEY idx_status (status),
  KEY idx_market (market)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- revenue_entries — manual revenue log per stream
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS revenue_entries (
  revenue_id        BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entry_date        DATE NOT NULL,
  stream            ENUM(
    'charter_commission',
    'vessel_membership',
    'event_planner_subscription',
    'corporate_retreat',
    'vendor_network',
    'atlantic_vine_services',
    'jet_charter',
    'merchandise',
    'investor_capital',
    'other'
  ) NOT NULL,
  amount            DECIMAL(10,2) NOT NULL,
  source            VARCHAR(255) NULL
    COMMENT 'customer name / partner / counter-party',
  booking_id        BIGINT UNSIGNED NULL
    COMMENT 'optional FK to bookings.booking_id (app-enforced)',
  notes             TEXT NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_entry_date (entry_date),
  KEY idx_stream (stream),
  KEY idx_booking_id (booking_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- marketing_activity — calls/emails/meetings Val logs while prospecting
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS marketing_activity (
  activity_id       BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  occurred_on       DATE NOT NULL,
  activity_type     ENUM('cold_call','cold_email','dm','meeting','demo','follow_up','proposal_sent','contract_sent','other') NOT NULL,
  prospect_audit_id CHAR(36) NULL
    COMMENT 'optional cross-DB pointer to shhdbite_AV.leads.audit_id',
  prospect_label    VARCHAR(255) NULL
    COMMENT 'free-text label if the prospect isnt in shhdbite_AV yet',
  outcome           ENUM('no_answer','left_voicemail','interested','not_interested','meeting_scheduled','closed','other') NULL,
  notes             TEXT NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_occurred_on (occurred_on),
  KEY idx_activity_type (activity_type),
  KEY idx_prospect_audit (prospect_audit_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- VERIFICATION (paste each separately to confirm)
-- ---------------------------------------------------------------------
-- SELECT table_name, table_rows FROM information_schema.tables
-- WHERE table_schema='shhdbite_eventsbywater' ORDER BY table_name;
--
-- -- Should now show 10 tables: 7 form tables + bookings + revenue_entries + marketing_activity.
