-- schema/070_worker_run_log.sql  (#380, val 2026-06-03)
--
-- The audit trail for HostGator-driven cron runs of the Revenue Intelligence
-- engine. Each task (adapter sweep, cascade sweep, distress rescore) writes
-- one row. Operator dashboard reads this to render "last refreshed Xh ago"
-- per client.

CREATE TABLE IF NOT EXISTS worker_run_log (
  log_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  task VARCHAR(64) NOT NULL,
  client_id INT UNSIGNED NULL,
  started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at DATETIME NULL,
  status ENUM('running', 'ok', 'error', 'partial') NOT NULL DEFAULT 'running',
  adapter_count INT NOT NULL DEFAULT 0,
  cascade_recipes_fired INT NOT NULL DEFAULT 0,
  entities_scored INT NOT NULL DEFAULT 0,
  detail VARCHAR(500) NULL,
  PRIMARY KEY (log_id),
  KEY idx_task (task),
  KEY idx_client (client_id),
  KEY idx_started (started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
