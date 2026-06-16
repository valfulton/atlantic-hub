-- =====================================================================
-- schema/102 — Independent Contractor applications (#701, val 2026-06-16)
--
-- Every client_user can apply for an A&V Independent Contractor role from
-- their /client/dashboard "Earn with A&V" card. Application lands here;
-- val reviews + approves on /admin/av/ic-applications. Approval links
-- client_user → admin_user (existing employee row or new) so they can
-- pick up leads in the inventory + earn commission.
--
-- This table is universal. Future kinds (caller, manager, referrer)
-- flagged via the `tier_pref` column. Idempotent.
-- =====================================================================

USE shhdbite_AV;

CREATE TABLE IF NOT EXISTS ic_applications (
  application_id      BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  client_user_id      BIGINT UNSIGNED NOT NULL,
  -- Snapshot identity at apply-time so the application is readable even if
  -- the client_user row is later renamed.
  display_name        VARCHAR(180) NULL,
  email               VARCHAR(180) NULL,
  phone               VARCHAR(40)  NULL,
  -- What they're applying for. Free-form so val can sort later.
  tier_pref           ENUM('caller','manager','referrer','any') DEFAULT 'any',
  -- Their pitch — why they want to work with A&V.
  pitch               TEXT NULL,
  -- Optional: which client account they came from (CBB, CLDA, Johnson,
  -- Ron, etc.) so val knows the path. Resolved from their active brand.
  applied_from_client_id BIGINT UNSIGNED NULL,
  -- Lifecycle
  status              ENUM('pending','approved','declined','revoked') DEFAULT 'pending',
  status_at           DATETIME NULL,
  status_by_user_id   BIGINT UNSIGNED NULL,
  reviewer_notes      TEXT NULL,
  -- When approved, the admin_user row they're linked to (existing or new).
  linked_admin_user_id BIGINT UNSIGNED NULL,
  -- Audit
  created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY ic_apps_client_user (client_user_id),
  KEY ic_apps_status (status),
  KEY ic_apps_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
