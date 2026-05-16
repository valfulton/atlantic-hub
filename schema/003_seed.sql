-- =====================================================================
-- Atlantic Hub — Seed Data
-- File: schema/003_seed.sql
-- Target DB: shhdbite_atlantic_hub
-- Run AFTER: 001_platform.sql and 002_hh_detail.sql
-- =====================================================================
--
-- This file seeds:
--   1. The three current tenants (hunterhoney, av, ebw)
--   2. All v1 feature flags with appropriate defaults
--   3. The bootstrap owner admin user
--      → email comes from OWNER_BOOTSTRAP_EMAIL env var
--      → password_hash comes from OWNER_BOOTSTRAP_PASSWORD_HASH env var
--      → Both are placeholder values here; the application will UPSERT
--        the real values from env vars on first request (see
--        lib/auth/bootstrap.ts in the Next.js app).
--
-- Idempotent: re-running this file is safe. INSERT IGNORE for tenants
-- and feature_flags; the admin user is handled by the application layer.
-- =====================================================================

USE shhdbite_atlantic_hub;

-- =====================================================================
-- Tenants — the three current business lines + a placeholder pattern
-- =====================================================================
-- Brand colors are placeholders; tweak in v2 when you finalize themes.
-- =====================================================================
INSERT IGNORE INTO tenants (tenant_id, display_name, db_name, brand_color_hex, is_active) VALUES
  ('hunterhoney', 'HunterHoney Research', 'shhdbite_hunterhoney', '#F59E0B', TRUE),
  ('av',          'Atlantic & Vine',      'shhdbite_AV',          '#7C2D12', TRUE),
  ('ebw',         'Events by Water',      'shhdbite_eventsbywater', '#0E7490', TRUE);

-- =====================================================================
-- Feature flags — kill switches + toggles
-- =====================================================================
-- Default values reflect v1 scope:
--   HH tab ON (we're shipping the HH end-to-end pattern)
--   AV + EBW tabs OFF (v2)
--   Webhook ingestion ON
--   Audit log writes ON (emergency-only kill switch)
--   Admin login ON (global lockout if needed)
--   Cross-sell surfacing OFF (schema-only; v2 UI)
-- =====================================================================
INSERT IGNORE INTO feature_flags (flag_name, enabled, notes) VALUES
  ('tab_hh_enabled',            TRUE,  'HunterHoney tab visible in dashboard'),
  ('tab_av_enabled',            TRUE,  'Atlantic & Vine tab — Phase 1 dashboard'),
  ('tab_ebw_enabled',           TRUE,  'Events by Water tab — operator dashboard for charters/bookings/investors'),
  ('webhook_ingestion_enabled', TRUE,  'Accept inbound Netlify Forms webhooks'),
  ('audit_log_writes_enabled',  TRUE,  'Emergency-only kill switch — disable only if audit table is blocking reads'),
  ('admin_login_enabled',       TRUE,  'Global login kill switch — false = everyone logged out on next request'),
  ('cross_sell_enabled',        FALSE, 'v2 — surface "this person also has X tenant account" hints in detail views');

-- =====================================================================
-- Bootstrap owner admin user — placeholder
-- =====================================================================
-- The application's lib/auth/bootstrap.ts will UPSERT the real row using
-- OWNER_BOOTSTRAP_EMAIL and OWNER_BOOTSTRAP_PASSWORD_HASH env vars on
-- first successful DB connection. This seed row exists so the table is
-- never empty (which would otherwise cause a "no admins exist" error
-- during cold start).
--
-- The placeholder password_hash below is the bcrypt hash of
-- 'INVALID_PLACEHOLDER_PASSWORD_DO_NOT_USE' — even if someone tried to
-- log in with that exact string, it would fail because the application's
-- bootstrap will overwrite this row before the first login attempt
-- completes.
--
-- Run scripts/generate-owner-hash.ts locally to produce the real hash,
-- then paste it into Netlify env var OWNER_BOOTSTRAP_PASSWORD_HASH.
-- =====================================================================
INSERT IGNORE INTO admin_users (email, password_hash, role, is_active, display_name) VALUES
  ('bootstrap-placeholder@atlantic-hub.local',
   '$2b$12$PlaceholderHashPlaceholderHashPlaceholderHashPlaceholder.',
   'owner',
   FALSE,
   'Bootstrap Placeholder — will be replaced on first deploy');

-- =====================================================================
-- Done. Verify with:
--   SELECT * FROM tenants;
--   SELECT * FROM feature_flags;
--   SELECT user_id, email, role, is_active FROM admin_users;
-- Expect: 3 tenants, 7 feature flags, 1 (inactive) bootstrap admin user.
-- =====================================================================
