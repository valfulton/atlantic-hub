-- 067_llm_infra.sql  (#361, val 2026-06-02)
--
-- Two tables that together turn LLM use from a black box into accountable
-- infrastructure:
--
--   1. llm_call_log -- every single LLM call: model, prompt+output token counts,
--      estimated cost (in cents), task kind, optional client scope. Lets val
--      answer "what did I spend on Adriana this month?" or "is the brand-kit
--      step cheaper than the ICP step on average?"
--
--   2. llm_response_cache -- content-hash keyed cache. Same prompt + same
--      model = no second charge. Web-source rows live 7 days; brief/intake
--      rows are invalidated EXPLICITLY when the source updates (cache lookup
--      includes the source's updated_at, so a brief edit invalidates without
--      any DELETE).
--
-- Both are local to shhdbite_AV; both are append-mostly (TTL eviction on cache).

CREATE TABLE IF NOT EXISTS llm_call_log (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ts DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  /** 'av' for operator-side · 'client:<id>' for per-client scoped work. */
  tenant_id VARCHAR(64) NOT NULL,
  /** When set, the brand this call was made FOR (e.g. brand-kit-extract for client 11). */
  client_id INT UNSIGNED NULL,
  /** Task kind tag — drives reporting + future routing decisions. */
  task_kind VARCHAR(64) NOT NULL,
  /** Provider + model identifier, e.g. 'openai:gpt-4o-mini' or 'anthropic:claude-haiku-3-5'. */
  model VARCHAR(120) NOT NULL,
  /** Token counts as reported by the provider. */
  input_tokens INT UNSIGNED NOT NULL DEFAULT 0,
  output_tokens INT UNSIGNED NOT NULL DEFAULT 0,
  /** Estimated cost in MICRO-CENTS (1/1000 of a cent) — integer math, no floats. */
  cost_microcents BIGINT UNSIGNED NOT NULL DEFAULT 0,
  /** 'live' for a real provider call · 'cache' for a cache hit (still logged for visibility). */
  source ENUM('live','cache') NOT NULL DEFAULT 'live',
  /** Optional human-readable hint for what this call did. */
  note VARCHAR(255) NULL,
  KEY idx_tenant_ts (tenant_id, ts),
  KEY idx_client_ts (client_id, ts),
  KEY idx_task_ts (task_kind, ts)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS llm_response_cache (
  /** SHA-256 of (model + canonical prompt JSON). Truncated for index efficiency. */
  cache_key CHAR(64) NOT NULL PRIMARY KEY,
  /** Provider:model identifier (mirrors llm_call_log.model). */
  model VARCHAR(120) NOT NULL,
  task_kind VARCHAR(64) NOT NULL,
  /** The stored response text (assistant message body). */
  response_text MEDIUMTEXT NOT NULL,
  /** Token counts at time of original generation (for cost-saved reporting). */
  input_tokens INT UNSIGNED NOT NULL DEFAULT 0,
  output_tokens INT UNSIGNED NOT NULL DEFAULT 0,
  cost_microcents BIGINT UNSIGNED NOT NULL DEFAULT 0,
  /** When this entry was first generated AND when it was last served. */
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_hit_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  hit_count INT UNSIGNED NOT NULL DEFAULT 0,
  /** Hard TTL for time-based eviction (web fetches: 7 days · null = "no time TTL,
   *  invalidated by upstream key change instead"). */
  expires_at DATETIME NULL,
  KEY idx_task (task_kind),
  KEY idx_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
