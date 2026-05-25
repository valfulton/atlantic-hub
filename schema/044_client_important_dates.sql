-- 044_client_important_dates.sql
-- Structured "important dates" that layer onto the calendar's holiday grid:
-- client birthdays, anniversaries, busy seasons, launch dates, etc. Supports
-- both annually-recurring (recur_month + recur_day) and one-off (event_date)
-- entries. Owner-scoped by tenant + client_id (NULL = house/operator).
-- Plain CREATE TABLE — run ONCE in phpMyAdmin.

CREATE TABLE IF NOT EXISTS client_important_dates (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id   VARCHAR(16)  NOT NULL DEFAULT 'av',
  client_id   INT          NULL,                 -- NULL = house, >0 = a client account
  label       VARCHAR(160) NOT NULL,
  kind        VARCHAR(32)  NOT NULL DEFAULT 'date', -- birthday|anniversary|busy_season|launch|date
  event_date  DATE         NULL,                 -- one-off (exact date incl. year)
  recur_month TINYINT      NULL,                 -- 1-12 for annually recurring
  recur_day   TINYINT      NULL,                 -- 1-31 for annually recurring
  source      VARCHAR(32)  NOT NULL DEFAULT 'manual', -- manual|intake|csv
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archived_at DATETIME     NULL,
  KEY idx_owner (tenant_id, client_id, archived_at)
);
