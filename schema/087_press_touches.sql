-- ===============================================================
-- Atlantic Hub -- Press Touches log (#550 v2)
-- File:    schema/087_press_touches.sql
-- Target:  shhdbite_AV   (joins clients via client_id)
-- Run in:  HostGator phpMyAdmin -> shhdbite_AV -> SQL tab -> paste -> Go
-- ===============================================================
--
-- Every journalist outreach we make on behalf of a client lands as one row
-- here: who pitched, who we pitched to, what outlet, what status, what
-- (eventually) URL when published. Status moves drafted -> pitched -> replied
-- -> published | declined | no_response. The client sees the live count of
-- this-week press touches + a short list on their dashboard
-- (PressTouchesPanel); the operator logs touches via the per-client press
-- surface at /admin/av/clients/[id]/press.
--
-- Why a dedicated table (vs reusing outbox): outbox is for social/scheduled
-- platform posts; press touches are 1:1 journalist outreach with status that
-- evolves over weeks. Different shape, different lifecycle, different reads.
--
-- IDEMPOTENT: CREATE TABLE IF NOT EXISTS. Safe to re-run.
-- ===============================================================

USE shhdbite_AV;
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS press_touches (
  touch_id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  client_id           BIGINT UNSIGNED NOT NULL
    COMMENT 'FK to clients.client_id. Press touches are scoped per brand.',
  journalist_name     VARCHAR(255) NOT NULL,
  journalist_email    VARCHAR(320) NULL,
  outlet              VARCHAR(255) NOT NULL,
  beat                VARCHAR(120) NULL
    COMMENT 'Reporter beat — healthcare, district politics, hospitality, etc.',
  channel             ENUM('email','phone','social_dm','event','other')
                      NOT NULL DEFAULT 'email',
  status              ENUM('drafted','pitched','replied','published','declined','no_response')
                      NOT NULL DEFAULT 'drafted'
    COMMENT 'Lifecycle. drafted -> pitched -> (replied | declined | no_response) -> published?',
  subject_line        VARCHAR(255) NULL,
  notes               TEXT NULL
    COMMENT 'Operator notes — context, response excerpts, follow-up plans.',
  related_lead_id     BIGINT UNSIGNED NULL
    COMMENT 'Optional link to a leads row when the touch was driven by a specific lead.',
  related_brief_key   VARCHAR(120) NULL
    COMMENT 'Optional brief key or narrative-angle slug this touch supports (e.g. "angle_a", "q5_message").',
  url                 VARCHAR(500) NULL
    COMMENT 'Published URL once status=published.',
  created_by_user_id  BIGINT UNSIGNED NULL
    COMMENT 'FK to admin_users / client_users — whoever logged the touch.',
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  pitched_at          DATETIME NULL,
  replied_at          DATETIME NULL,
  published_at        DATETIME NULL,
  KEY idx_press_touches_client       (client_id, created_at),
  KEY idx_press_touches_client_status (client_id, status, created_at),
  KEY idx_press_touches_published    (client_id, published_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ===============================================================
-- VERIFY:
--   SELECT client_id, COUNT(*) AS total,
--          SUM(status='pitched')   AS pitched,
--          SUM(status='replied')   AS replied,
--          SUM(status='published') AS published
--     FROM press_touches
--    GROUP BY client_id
--    ORDER BY total DESC;
-- ===============================================================
-- END 087_press_touches.sql
-- ===============================================================
