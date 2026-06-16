-- =====================================================================
-- schema/103_inbound_emails.sql  (val 2026-06-16, #707)
--
-- Audit table for every email pulled in by /api/admin/inbox/imap-poll.
-- One row per delivered message regardless of where it routed (case_notes,
-- case_inbound_messages, PR pipeline) or whether it was unroutable.
--
-- We keep raw_envelope so val can see exactly what arrived and why it
-- routed where it did — debug-friendly without having to dig through IMAP.
--
-- Idempotent. Safe to run repeatedly.
-- =====================================================================

USE shhdbite_AV;

CREATE TABLE IF NOT EXISTS inbound_emails (
  email_id        BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  -- Server-side unique identifier so we never double-process a message.
  -- imapflow gives us the Message-ID header; we fall back to a sha1 of
  -- (mailbox + uid + date) when the header is missing.
  message_uid     VARCHAR(255) NOT NULL,
  source_mailbox  VARCHAR(120) NOT NULL
    COMMENT 'inbox@case.atlanticandvine.com OR inbox@pr.atlanticandvine.com',
  envelope_to     VARCHAR(500) NULL
    COMMENT 'Original To: header local-part + domain (e.g. johnson@case.atlanticandvine.com)',
  envelope_from   VARCHAR(500) NULL,
  subject         VARCHAR(500) NULL,
  body_text       MEDIUMTEXT NULL,
  body_html       LONGTEXT NULL,
  attachment_count INT NOT NULL DEFAULT 0,
  -- Routing decision: where did this email end up?
  routed_to       ENUM('case_note','case_inbound','pr_inbox','unroutable','error')
                  NOT NULL DEFAULT 'unroutable',
  routed_case_id  BIGINT UNSIGNED NULL,
  routed_client_id BIGINT UNSIGNED NULL,
  routed_note_id  BIGINT UNSIGNED NULL
    COMMENT 'When routed_to = case_note, the case_notes.note_id we created.',
  route_reason    VARCHAR(500) NULL
    COMMENT 'Human-readable why this email went where it did (or why it did not).',
  received_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_inbound_message_uid (message_uid, source_mailbox),
  KEY idx_inbound_received (received_at),
  KEY idx_inbound_routed   (routed_to, processed_at),
  KEY idx_inbound_case     (routed_case_id),
  KEY idx_inbound_client   (routed_client_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
