-- 046_ai_prompt_overrides.sql
--
-- One place to view + edit the AI prompts the platform sends. Each known prompt
-- has a stable prompt_key (e.g. 'av_lead_audit'); the CODE owns the default text,
-- the DB stores an optional operator override. getSystemPrompt(key) returns the
-- override when present, else the code default — so val can tune a prompt and make
-- it more intelligent without a deploy, and reset to the built-in default anytime.
--
-- This is the foundation for "prompt visibility site-wide" (#80): the audit is the
-- first consumer; thesis / PR / discovery wire into the same table next.
--
-- Run ONCE.

CREATE TABLE IF NOT EXISTS ai_prompt_overrides (
  prompt_key    VARCHAR(64)  NOT NULL
    COMMENT 'stable key matching a PROMPT_DEFS entry in lib/ai/prompt_registry.ts',
  system_text   MEDIUMTEXT   NULL
    COMMENT 'operator-edited system prompt; NULL/empty falls back to the code default',
  updated_by    VARCHAR(255) NULL
    COMMENT 'email of the operator who last saved this override',
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (prompt_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
