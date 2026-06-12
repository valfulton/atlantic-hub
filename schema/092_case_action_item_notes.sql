-- =====================================================================
-- Atlantic Hub — case_action_item_notes
-- File: schema/092_case_action_item_notes.sql
-- Target: shhdbite_AV
-- Run in: HostGator phpMyAdmin -> shhdbite_AV -> SQL tab -> paste -> Go
-- =====================================================================
-- WHY: action items are the working surface where val + Adriana + Rebecca
-- coordinate on each open question. They need a notes history so anyone
-- can drop a comment ("asked Mom 6/15, confirmed §6.G(2) was intentional")
-- and the rest of the family/counsel can see it.
--
-- Authored by client_user OR admin_user — we don't FK either since both
-- live in different tables; we just store a user_id + author_role enum.
-- =====================================================================

CREATE TABLE IF NOT EXISTS case_action_item_notes (
  note_id           BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  action_id         BIGINT UNSIGNED NOT NULL,
  body              TEXT NOT NULL,
  author_role       ENUM('owner', 'staff', 'client_user') NOT NULL,
  author_user_id    INT NOT NULL,
  author_display_name VARCHAR(120) NULL COMMENT 'Snapshot of name at write time so deleted users still attribute.',
  created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (action_id) REFERENCES case_action_items(action_id) ON DELETE CASCADE,
  INDEX idx_action (action_id, created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
