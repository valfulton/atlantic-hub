-- 086_client_notes.sql  (#489, val 2026-06-09)
--
-- Two-way notes channel — the half that was missing. We already push
-- operator -> client messages; this table adds client -> operator replies
-- from inside the app, so John can answer val without leaving the Hub.
--
-- Design rules (per val):
--   - DIRECTION-TYPED: every note records who-said-what to whom, so we never
--     confuse operator and client voices (direction enum).
--   - CREDENTIALED: every note carries author_email + created_at. No anon.
--   - APPEND-ONLY / "version-controlled in spirit": notes are immutable.
--     There are no edits — a correction posts as a NEW note. read_at is the
--     only mutable field (marking a note read does not change its content).
--
-- attachment_key is an optional Netlify blob key for file attachments
-- (provenance-stamped on upload). Text-only notes leave it NULL.

CREATE TABLE IF NOT EXISTS client_notes (
  note_id        BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  client_id      BIGINT UNSIGNED NOT NULL,
  direction      ENUM('operator_to_client','client_to_operator') NOT NULL
    COMMENT 'Who sent it. operator = val/owner; client = the client_user.',
  author_email   VARCHAR(320) NOT NULL
    COMMENT 'Credential — the val operator or the client_user who wrote it.',
  body           TEXT NOT NULL,
  attachment_key VARCHAR(500) NULL
    COMMENT 'Optional Netlify blob key for an attached file; NULL for text-only.',
  read_at        DATETIME NULL
    COMMENT 'When the OTHER side first read it. NULL = unread. Only mutable field.',
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_client_notes (client_id, created_at),
  KEY idx_unread (client_id, read_at, direction),
  CONSTRAINT fk_client_notes_client FOREIGN KEY (client_id)
    REFERENCES clients(client_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
