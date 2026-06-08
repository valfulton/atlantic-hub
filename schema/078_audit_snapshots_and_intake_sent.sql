-- 078_audit_snapshots_and_intake_sent.sql (#509 + #511 + #512, val 2026-06-08)
--
-- Two tightly-related additions, bundled because they ship together.
--
-- (A) website_audit_snapshots  (#512)
--     Persist every website audit run with its parsed scores so we can:
--       - render a KPI strip on the client page ("last audit · hero 4/10 · CTA 3/10")
--       - track whether their site is improving over time (later)
--       - roll up cross-client weakness ("4 of 12 clients score < 5 on Hero")
--     The full markdown is kept verbatim; the parsed scores live alongside as
--     a JSON column so the UI can build a strip without re-parsing.
--
-- (B) client_users.intake_link_sent_at  (#511)
--     Today the onboarding "Intake sent · magic link live" badge lights up
--     just because a magic_token exists in client_users. That's wrong — auto-
--     created tokens don't mean val actually sent anything. New column captures
--     an explicit "I sent it" timestamp. The send-password + magic-link routes
--     set it when they fire. The badge logic in lib/av/onboarding_status.ts
--     becomes: done if (intake_link_sent_at IS NOT NULL OR last_login_at IS
--     NOT NULL).

-- ----------------------------------------------------------------------------
-- (A) website_audit_snapshots
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS website_audit_snapshots (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id       VARCHAR(64) NOT NULL DEFAULT 'av',
  client_id       INT UNSIGNED NULL,
  homepage_url    VARCHAR(1024) NOT NULL,
  industry_hint   VARCHAR(255) NULL,
  -- Parsed scores (0-10 each). Shape:
  --   { "hero": 4, "cta": 3, "social_proof": 6, "contact": 8,
  --     "trust": 2, "seo": 5, "industry_fit": 4, "overall_avg": 4.6 }
  -- Any axis can be null if the parser couldn't read that row.
  scores          JSON NULL,
  -- The raw markdown audit text (operator-readable). Kept so val can re-read
  -- the latest audit without re-running the LLM.
  audit_markdown  MEDIUMTEXT NULL,
  -- Page health summary at audit time.
  pages_reached   INT UNSIGNED NULL,
  pages_flagged   INT UNSIGNED NULL,
  discovery_mode  VARCHAR(16) NULL,
  -- LLM accounting (so cross-client cost reports tally correctly).
  cost_microcents INT UNSIGNED NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_client_created (client_id, created_at),
  KEY idx_tenant_created (tenant_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- (B) client_users.intake_link_sent_at
-- ----------------------------------------------------------------------------
-- MySQL doesn't have IF NOT EXISTS for ADD COLUMN; the migration runner
-- swallows duplicate-column errors so re-running is safe.
ALTER TABLE client_users
  ADD COLUMN intake_link_sent_at DATETIME NULL AFTER magic_token_expires_at;
