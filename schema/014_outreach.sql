-- =====================================================================
-- Atlantic Hub -- Email Outreach Automation
-- File:    schema/014_outreach.sql
-- Target:  shhdbite_AV
-- Run in:  HostGator phpMyAdmin -> click shhdbite_AV in the sidebar so
--          the top bar reads "Database: shhdbite_AV" -> SQL tab ->
--          paste this entire file -> Go
-- =====================================================================
--
-- WHAT THIS DOES
--   Closes the loop on the lead pipeline: every high-scoring lead gets
--   an AI-drafted email grounded in its own audit_content, the operator
--   approves it in a one-click queue, the platform sends it through a
--   tenant-owned mailbox (HostGator SMTP, Microsoft Graph/Outlook, or
--   Gmail), and inbound replies route back into the dashboard with AI
--   classification + automatic lead_status advancement.
--
--   Architecture intent (per val 2026-05-18): NO third-party cold-email
--   SaaS. Use mailboxes the operator already owns. Multi-driver layer
--   so each tenant can pick HostGator SMTP, Microsoft Graph, or Gmail.
--
-- TABLES
--   outreach_mailboxes  -- per-tenant mailbox configs (encrypted creds)
--   outreach_campaigns  -- one row per ICP / audience / sequence
--   outreach_messages   -- per-lead per-campaign draft + send tracking
--   outreach_replies    -- inbound replies with AI classification
--   outreach_send_log   -- every send attempt (success + failure) audit
--
-- IDEMPOTENT: safe to re-run. Every CREATE uses IF NOT EXISTS.
-- =====================================================================

USE shhdbite_AV;
SET NAMES utf8mb4;

-- ---------------------------------------------------------------------
-- 1. outreach_mailboxes
--
-- Per-tenant connected mailboxes. Each row holds one sending identity.
-- Credentials (SMTP password OR OAuth refresh token + access token) are
-- stored encrypted in credentials_encrypted using AES-256-GCM with
-- EMAIL_ENCRYPTION_KEY (same key already used elsewhere in the app).
--
-- driver values:
--   hostgator_smtp   -- standard SMTP over TLS to mail.<domain>
--   microsoft_graph  -- OAuth2; sends via Microsoft Graph API
--   gmail_api        -- OAuth2; sends via Gmail API
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS outreach_mailboxes (
  id                    BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  organization_id       BIGINT UNSIGNED NULL
    COMMENT 'Tenant scope; NULL = operator-internal (val) until multi-tenant lands',
  display_name          VARCHAR(255) NOT NULL
    COMMENT 'Human-readable label shown in the UI (e.g. "Val - Outreach")',
  from_address          VARCHAR(255) NOT NULL
    COMMENT 'The actual From: email address (e.g. outreach@atlanticandvine.com)',
  from_name             VARCHAR(255) NULL
    COMMENT 'Display name in the From: header (e.g. "Val from Atlantic and Vine")',
  reply_to_address      VARCHAR(255) NULL
    COMMENT 'Optional Reply-To override; defaults to from_address',
  driver                ENUM('hostgator_smtp','microsoft_graph','gmail_api') NOT NULL,
  credentials_encrypted MEDIUMTEXT NULL
    COMMENT 'AES-256-GCM ciphertext of the driver-specific credential JSON',
  status                ENUM('active','pending_oauth','disconnected','error') NOT NULL DEFAULT 'pending_oauth',
  daily_send_count      INT UNSIGNED NOT NULL DEFAULT 0
    COMMENT 'Sends today; reset to 0 by the daily reset cron',
  daily_send_reset_at   DATE NULL
    COMMENT 'Last date the counter was reset (NULL means never sent)',
  last_test_at          DATETIME NULL,
  last_test_outcome     ENUM('success','auth_error','connection_error','other_error') NULL,
  last_error            VARCHAR(500) NULL,
  created_by_user_id    BIGINT UNSIGNED NULL,
  created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  archived_at           DATETIME NULL,
  KEY idx_outreach_mb_org      (organization_id),
  KEY idx_outreach_mb_status   (status),
  KEY idx_outreach_mb_driver   (driver),
  KEY idx_outreach_mb_archived (archived_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 2. outreach_campaigns
--
-- One row per ICP/audience/sequence. A campaign points at a mailbox
-- (the sending identity) and holds the AI prompt overrides + send caps.
-- daily_send_limit is per-campaign and applied on top of the tier-wide
-- daily cap (see lib/email/limits.ts).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS outreach_campaigns (
  id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  organization_id     BIGINT UNSIGNED NULL,
  mailbox_id          BIGINT UNSIGNED NOT NULL,
  name                VARCHAR(255) NOT NULL,
  description         TEXT NULL,
  target_business     ENUM('av','ebw','both') NOT NULL DEFAULT 'av',
  status              ENUM('draft','active','paused','archived') NOT NULL DEFAULT 'draft',
  ai_offer_summary    TEXT NULL
    COMMENT 'One-paragraph hint of what we are pitching (used in the AI prompt)',
  ai_cta              VARCHAR(500) NULL
    COMMENT 'Desired call-to-action language (e.g. "15 min on the calendar")',
  ai_signature        VARCHAR(500) NULL
    COMMENT 'Sender signoff used in drafts (plural voice, no founder name on customer surfaces)',
  daily_send_limit    INT UNSIGNED NOT NULL DEFAULT 5
    COMMENT 'Per-campaign daily cap; honored alongside the tier cap',
  require_approval    TINYINT(1) NOT NULL DEFAULT 1
    COMMENT 'If 1, drafts wait in pending_approval. If 0, auto-send after generation.',
  auto_advance_stage  TINYINT(1) NOT NULL DEFAULT 1
    COMMENT 'If 1, lead_status auto-advances on send/reply/bounce',
  created_by_user_id  BIGINT UNSIGNED NULL,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  archived_at         DATETIME NULL,
  KEY idx_outreach_camp_org      (organization_id),
  KEY idx_outreach_camp_mailbox  (mailbox_id),
  KEY idx_outreach_camp_status   (status),
  KEY idx_outreach_camp_target   (target_business),
  KEY idx_outreach_camp_archived (archived_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 3. outreach_messages
--
-- Per-lead per-campaign draft + send tracking. The "approval queue"
-- view is SELECT ... WHERE status='pending_approval' ORDER BY created_at.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS outreach_messages (
  id                    BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  campaign_id           BIGINT UNSIGNED NOT NULL,
  lead_id               BIGINT UNSIGNED NOT NULL,
  mailbox_id            BIGINT UNSIGNED NOT NULL
    COMMENT 'Snapshot of the mailbox at send time; campaign.mailbox_id may change later',
  sequence_step         TINYINT UNSIGNED NOT NULL DEFAULT 1
    COMMENT 'For future drip sequences. v1 always 1.',
  subject               VARCHAR(500) NOT NULL,
  body                  MEDIUMTEXT NOT NULL,
  body_format           ENUM('plaintext','html') NOT NULL DEFAULT 'plaintext',
  ai_model              VARCHAR(64) NULL,
  ai_tokens_used        INT UNSIGNED NULL,
  ai_temperature        DECIMAL(3,2) NULL,
  ai_grounded_on_audit  TINYINT(1) NOT NULL DEFAULT 1
    COMMENT 'Did this draft use audit_content as its hook? Audit drives quality.',
  status                ENUM(
                          'draft',
                          'pending_approval',
                          'approved',
                          'queued',
                          'sent',
                          'bounced',
                          'replied',
                          'rejected',
                          'failed'
                        ) NOT NULL DEFAULT 'pending_approval',
  rejection_reason      VARCHAR(500) NULL,
  approved_by_user_id   BIGINT UNSIGNED NULL,
  approved_at           DATETIME NULL,
  scheduled_send_at     DATETIME NULL,
  sent_at               DATETIME NULL,
  provider_message_id   VARCHAR(255) NULL
    COMMENT 'Driver-specific message id (Microsoft, Gmail, or RFC822 Message-ID for SMTP)',
  opened_at             DATETIME NULL,
  clicked_at            DATETIME NULL,
  replied_at            DATETIME NULL,
  bounced_at            DATETIME NULL,
  error_message         VARCHAR(500) NULL,
  created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_outreach_msg_lead_step (campaign_id, lead_id, sequence_step),
  KEY idx_outreach_msg_status   (status),
  KEY idx_outreach_msg_lead     (lead_id),
  KEY idx_outreach_msg_campaign (campaign_id),
  KEY idx_outreach_msg_sent     (sent_at),
  KEY idx_outreach_msg_provider (provider_message_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 4. outreach_replies
--
-- Inbound replies (raw + AI classification). For SMTP-driver mailboxes
-- we poll IMAP on a cron; for Microsoft Graph and Gmail we either poll
-- the API or set up a webhook subscription (subscription setup is
-- per-mailbox and lives in lib/email/drivers/<driver>.ts).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS outreach_replies (
  id                       BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  message_id               BIGINT UNSIGNED NULL
    COMMENT 'FK conceptually -- the outreach_messages row this is replying to (NULL if unmatched)',
  lead_id                  BIGINT UNSIGNED NULL,
  campaign_id              BIGINT UNSIGNED NULL,
  mailbox_id               BIGINT UNSIGNED NULL,
  reply_from               VARCHAR(255) NULL,
  reply_subject            VARCHAR(500) NULL,
  reply_body               MEDIUMTEXT NULL,
  in_reply_to_header       VARCHAR(255) NULL
    COMMENT 'RFC822 In-Reply-To header (matches a provider_message_id on outreach_messages)',
  classification           ENUM(
                             'positive',
                             'interested',
                             'neutral',
                             'negative',
                             'autoresponder',
                             'unsubscribe',
                             'unknown'
                           ) NOT NULL DEFAULT 'unknown',
  classification_confidence DECIMAL(4,3) NULL,
  classifier_model         VARCHAR(64) NULL,
  received_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at             DATETIME NULL
    COMMENT 'When stage-advancement + event-logging completed for this reply',
  raw_payload              JSON NULL,
  KEY idx_outreach_reply_msg     (message_id),
  KEY idx_outreach_reply_lead    (lead_id),
  KEY idx_outreach_reply_camp    (campaign_id),
  KEY idx_outreach_reply_class   (classification),
  KEY idx_outreach_reply_received (received_at),
  KEY idx_outreach_reply_in_reply (in_reply_to_header)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 5. outreach_send_log
--
-- Audit row per send attempt (success or failure). Mirrors the
-- grok_imagine_log shape so /admin/events can render it consistently.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS outreach_send_log (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  attempted_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  message_id        BIGINT UNSIGNED NULL,
  mailbox_id        BIGINT UNSIGNED NULL,
  driver            ENUM('hostgator_smtp','microsoft_graph','gmail_api') NOT NULL,
  outcome           ENUM(
                      'success',
                      'auth_error',
                      'connection_error',
                      'rate_limited',
                      'quota_exceeded',
                      'invalid_recipient',
                      'other_error'
                    ) NOT NULL DEFAULT 'success',
  provider_response TEXT NULL,
  latency_ms        INT UNSIGNED NULL,
  error_message     VARCHAR(500) NULL,
  actor_user_id     BIGINT UNSIGNED NULL,
  KEY idx_outreach_log_attempted (attempted_at),
  KEY idx_outreach_log_outcome   (outcome),
  KEY idx_outreach_log_message   (message_id),
  KEY idx_outreach_log_mailbox   (mailbox_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
-- VERIFICATION (paste each separately)
-- =====================================================================
-- 1. Confirm all five tables exist:
--    SHOW TABLES LIKE 'outreach_%';
--
-- 2. Confirm schemas:
--    SHOW CREATE TABLE outreach_mailboxes;
--    SHOW CREATE TABLE outreach_campaigns;
--    SHOW CREATE TABLE outreach_messages;
--    SHOW CREATE TABLE outreach_replies;
--    SHOW CREATE TABLE outreach_send_log;
--
-- 3. After connecting a mailbox in the UI:
--    SELECT id, display_name, driver, status, daily_send_count
--      FROM outreach_mailboxes ORDER BY created_at DESC;
--
-- 4. After approving + sending a first message:
--    SELECT m.id, m.subject, m.status, m.sent_at, l.company, l.email
--      FROM outreach_messages m
--      JOIN leads l ON l.id = m.lead_id
--      ORDER BY m.created_at DESC LIMIT 25;
-- =====================================================================
-- END 014_outreach.sql
-- =====================================================================
