-- 081_client_dossier.sql (#521, val 2026-06-08)
--
-- Operator-only "Due Diligence" file per client. Holds personal/PII fields
-- that val needs to be safe + get paid, but that should NEVER appear on the
-- creative brief, the client portal, or anywhere previewable as the client.
--
-- Why this exists (val 2026-06-08): she's asking herself before each new
-- client — "do I get paid? are they litigious? bankruptcy history? where
-- do they live so I can find them if things go sideways?" The brief is
-- client-readable and PII-sensitive; this file is operator-readable only.
--
-- The "red_flags_json" array holds entries the operator added manually OR
-- entries that get auto-added when a future "Run personal risk screen"
-- button (#522) fires the distress engine against the client themselves.
-- Each entry: { label, source, severity, surfaced_at, dossier_url? }.
--
-- Schema 081 only lands the TABLE. The panel + API route ship in the next
-- bundle. Land the schema first so future code can write against a stable
-- shape.

CREATE TABLE IF NOT EXISTS client_dossier (
  client_id        INT UNSIGNED NOT NULL PRIMARY KEY,
  -- All PII as plain TEXT so val can paste freely without dropdown lock-in.
  personal_address TEXT             NULL  COMMENT 'home/mailing addr — operator only, never shown to client',
  dob_year         SMALLINT UNSIGNED NULL  COMMENT 'birth year only (no full DOB) — for record matching, less sensitive',
  prior_entities   TEXT             NULL  COMMENT 'comma list of prior LLC/DBA names the operator should screen against',
  spouse_or_cosigner_name TEXT      NULL  COMMENT 'often the actual decision-maker / co-signer',
  notes_md         MEDIUMTEXT       NULL  COMMENT 'free-form markdown notes — operator scratchpad',
  -- JSON array of red-flag entries. See doc-comment above for shape.
  red_flags_json   JSON             NULL,
  -- When the last automated personal-risk screen ran. NULL = never.
  last_screened_at DATETIME         NULL,
  -- The operator who last touched the dossier (for accountability/audit log).
  updated_by       VARCHAR(128)     NULL,
  created_at       TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_last_screened (last_screened_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
