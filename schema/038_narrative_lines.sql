-- 038_narrative_lines.sql
-- Evolve narrative_lanes (editorial pillars) into NARRATIVE LINES (strategic
-- market theses). We deliberately REUSE the existing narrative_lanes table and
-- the campaigns/content_artifacts chain rather than creating a parallel table —
-- a narrative line is the same row, just carrying its reusable intelligence
-- object + a lifecycle. This is the anti-bloat move.
--
-- A narrative line is NOT a content category. It is a believable market thesis
-- that orchestrates all downstream assets. (See Atlantic_Hub_Playbook/01.)
--
-- MySQL: plain ADD COLUMN (no IF NOT EXISTS). Run ONCE. All columns nullable so
-- existing rows are untouched; existing lanes default to state='active'.

USE shhdbite_AV;

-- Lifecycle: candidate (proposed, not steering anything) -> active (steering
-- content now; HARD CAP 2-4 per tenant, enforced in app code) ->
-- reinforcing (proven, doubling down) -> retiring (winding down).
ALTER TABLE narrative_lanes
  ADD COLUMN state ENUM('candidate','active','reinforcing','retiring')
    NOT NULL DEFAULT 'active' AFTER is_active;

-- The reusable intelligence object (the thing that makes a line learnable,
-- not a slogan). Scalars for the spine; JSON for the lists.
ALTER TABLE narrative_lanes ADD COLUMN thesis           VARCHAR(500) NULL AFTER description;
ALTER TABLE narrative_lanes ADD COLUMN audience         VARCHAR(300) NULL AFTER thesis;
ALTER TABLE narrative_lanes ADD COLUMN emotional_driver VARCHAR(200) NULL AFTER audience;
ALTER TABLE narrative_lanes ADD COLUMN authority_angle  VARCHAR(200) NULL AFTER emotional_driver;
ALTER TABLE narrative_lanes ADD COLUMN seasonality      VARCHAR(160) NULL AFTER authority_angle;
ALTER TABLE narrative_lanes ADD COLUMN conversion_signal VARCHAR(300) NULL AFTER seasonality;

-- JSON lists. proof_points = stats/quotes/results backing the thesis.
-- best_channels = ["LinkedIn","PR","short-form video"].
-- do_say / dont_say = voice guardrails (on/off thesis).
-- evidence = PR signals + engagement + conversions that justify the line.
-- performance = system-written rollups (best format, best channel, lift).
ALTER TABLE narrative_lanes ADD COLUMN proof_points  JSON NULL;
ALTER TABLE narrative_lanes ADD COLUMN best_channels JSON NULL;
ALTER TABLE narrative_lanes ADD COLUMN do_say        JSON NULL;
ALTER TABLE narrative_lanes ADD COLUMN dont_say      JSON NULL;
ALTER TABLE narrative_lanes ADD COLUMN evidence      JSON NULL;
ALTER TABLE narrative_lanes ADD COLUMN performance   JSON NULL;

ALTER TABLE narrative_lanes ADD KEY idx_tenant_state (tenant_id, state);

-- Verify:
--   SHOW COLUMNS FROM narrative_lanes;
--   SELECT name, state, thesis FROM narrative_lanes WHERE tenant_id='av' ORDER BY sort_order;
--
-- NOTE: the 7 seeded lanes are still generic content pillars. Reframe them into
-- real theses (or set state='candidate'/'retiring') via the operator UI — no
-- destructive delete needed. The 2-4 ACTIVE cap is enforced in lib/campaigns/store.ts.
