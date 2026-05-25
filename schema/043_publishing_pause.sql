-- 043_publishing_pause.sql
-- "Stop the presses": a single-row global kill-switch for ALL social publishing
-- (manual single, bulk, and the scheduled cron). When paused = 1, the publisher
-- does nothing and scheduled rows stay put until it is lifted.
-- Plain CREATE TABLE — run ONCE in phpMyAdmin.

CREATE TABLE IF NOT EXISTS publishing_control (
  id         TINYINT      NOT NULL DEFAULT 1,
  paused     TINYINT(1)   NOT NULL DEFAULT 0,
  reason     VARCHAR(280) NULL,
  updated_by VARCHAR(190) NULL,
  updated_at DATETIME     NULL,
  PRIMARY KEY (id)
);

-- Seed the single control row (id is always 1).
INSERT IGNORE INTO publishing_control (id, paused) VALUES (1, 0);
