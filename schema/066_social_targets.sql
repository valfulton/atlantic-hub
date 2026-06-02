-- 066_social_targets.sql (#45, val 2026-06-02)
--
-- Post-target rails. social_connections is the OAuth-token holder (one row per
-- authenticated account). social_targets is the POSTABLE IDENTITY layer:
-- one row per identity we can post AS — personal profile, company page, etc.
--
-- One connection can authorize multiple targets:
--   - Adriana connects her personal LinkedIn -> 1 connection row
--   - Her account has admin rights on CBB + CLDA company pages
--   - Callback fetches org ACLs and creates 2 ADDITIONAL target rows
--     (target_type='organization', target_account_urn=urn:li:organization:NNN)
--     both attached to the SAME connection_id
--
-- Per-brand scoping: social_targets.client_id maps each target to a BRAND. The
-- publisher consults targets WHERE client_id=? when posting for that brand.
-- Multi-brand owners (Adriana CBB+CLDA) end up with one set of targets per
-- brand, including the personal profile shared across brands (same source_url
-- on both rows; UNIQUE key on (client_id, provider, source_url) allows it).
--
-- 'suggested' = val pasted a URL or scraper found one; not yet confirmed
-- 'confirmed' = client said "yes, that's me" but not yet OAuth-connected
-- 'connected' = OAuth token attached via connection_id; ready to post
-- 'rejected'  = client said "not me, don't use this"
-- 'error'     = OAuth or fetch failed; last_error has detail

CREATE TABLE IF NOT EXISTS social_targets (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,
  client_id INT UNSIGNED NULL,
  connection_id BIGINT UNSIGNED NULL,
  provider ENUM('linkedin','x','instagram','facebook','threads','tiktok','youtube') NOT NULL,
  target_type ENUM('personal','organization','page') NOT NULL DEFAULT 'personal',
  target_account_urn VARCHAR(255) NULL,
  target_account_id VARCHAR(255) NULL,
  source_url VARCHAR(1024) NOT NULL,
  source_url_hash CHAR(40) NOT NULL,
  display_name VARCHAR(255) NULL,
  avatar_url VARCHAR(1024) NULL,
  og_title VARCHAR(255) NULL,
  og_fetched_at DATETIME NULL,
  status ENUM('suggested','confirmed','connected','rejected','error') NOT NULL DEFAULT 'suggested',
  source ENUM('val_intake','client_intake','scraper','manual_add') NOT NULL,
  added_by_user_id BIGINT UNSIGNED NULL,
  added_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  confirmed_at DATETIME NULL,
  connected_at DATETIME NULL,
  rejected_at DATETIME NULL,
  last_error VARCHAR(500) NULL,
  -- (client_id, provider, source_url_hash) is the dedup key. URL hashed because
  -- MySQL key lengths are capped and full URLs blow past it. NULL client_id is
  -- allowed only for tenant-wide targets (e.g. tenant='av' personal) -- those
  -- use the partial unique index workaround below (one row per tenant+url).
  UNIQUE KEY uq_brand_provider_url (client_id, provider, source_url_hash),
  KEY idx_tenant (tenant_id),
  KEY idx_client (client_id),
  KEY idx_connection (connection_id),
  KEY idx_provider_status (provider, status),
  KEY idx_status_added (status, added_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- social_outbox.target_id: when set, publisher posts as the target's URN
-- (person OR organization). When NULL, falls back to existing connection-based
-- posting (legacy behavior; backward compatible with queued posts).
ALTER TABLE social_outbox
  ADD COLUMN target_id BIGINT UNSIGNED NULL AFTER connection_id,
  ADD KEY idx_target (target_id);
