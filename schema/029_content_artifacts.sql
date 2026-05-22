-- 029_content_artifacts.sql
-- Broader artifact types for the PR / narrative engine. See P4 in
-- docs/CLAUDE_KICKOFF_PR_PHASE3_HANDOFF.md.
--
-- Idempotent + additive: safe to re-run. CREATE TABLE IF NOT EXISTS only.
-- Does NOT drop/rename/recreate anything.
--
-- WHY A NEW TABLE (and why ONLY one):
-- The 025 engine has pr_pitches (a pitch TO a journalist) and press_releases (a
-- release about a win). Those two shapes do not fit the longer-form / owned
-- content the operator wants: blog/SEO articles, own-brand social posts, and
-- per-client deliverables. Rather than overload pr_pitches with a grab-bag of
-- nullable columns, content_artifacts is the single home for "drafted owned
-- content of some type." Pitches + releases STAY where they are; do not migrate
-- them in here.
--
-- INTELLIGENCE-GRAPH FIT (this is the point, not the table):
-- A content_artifact is NOT free-typed. The drafter (mirror lib/pr/drafter.ts)
-- must build every artifact by READING the shared graph:
--   - leads.pain_point_profile + audit_content (per-lead intelligence)
--   - matching intelligence_objects (schema 025): authority_topics,
--     media_friendly_topics, preferred_narrative_angles, founder_story, etc.
-- and must UPSERT what it learns BACK into intelligence_objects (e.g. a new
-- authority_topic or seo_keyword_cluster) so the next artifact is smarter.
-- That read-then-strengthen loop is what makes this compounding intelligence
-- rather than a content dump. Every state change emits a content.* event into
-- system_events (schema 010): content.artifact.drafted / .edited / .approved /
-- .published / .queued. Do not add an action the event stream cannot see.
--
-- VOICE (carried from the lead-never-client fix, commit 1092030/ac6ec82):
--   - blog_article / seo_article for a LEAD/prospect -> advisory voice (A&V's
--     voice, written for/about the topic; never assert claims AS the prospect).
--   - own_brand_post -> client_voice is legitimate HERE: the brand (A&V /
--     HunterHoney / Events by Water) is publishing on its OWN channel.
--   - client_deliverable -> client_voice, but only when client_id is set / the
--     lead is a converted client. Default to advisory otherwise.
--
-- WHEN QUEUED TO SOCIAL: an own_brand_post that gets scheduled writes a
-- social_outbox row (schema 017) and stores its id in linked_outbox_id (mirrors
-- pr_opportunities.linked_outbox_id from 027). The publisher cron (schema 028)
-- then fires it like any other scheduled row -- no separate publish path.

USE shhdbite_AV;

CREATE TABLE IF NOT EXISTS content_artifacts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,                 -- av | ebw | hh | client:<id>
  artifact_type ENUM('blog_article','seo_article','own_brand_post','client_deliverable') NOT NULL,
  lead_id BIGINT UNSIGNED NULL,                   -- prospect/client this is for (NULL = pure own-brand)
  opportunity_id BIGINT UNSIGNED NULL,            -- pr_opportunities.id, if it originated from one
  voice_mode ENUM('advisory','congratulatory','client_voice') NOT NULL DEFAULT 'advisory',
  title VARCHAR(300) NULL,
  body_text MEDIUMTEXT NULL,                      -- long-form: articles can be large
  meta_json JSON NULL,                            -- SEO: slug, meta_description, target_query, keyword_cluster, article-schema fields
  model VARCHAR(64) NULL,                         -- model that drafted it (observability; never a per-unit COST surface)
  status ENUM('draft','approved','published','passed') NOT NULL DEFAULT 'draft',
  linked_outbox_id BIGINT UNSIGNED NULL,          -- social_outbox.id when an own_brand_post is queued
  created_by_user_id BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_tenant_type_status (tenant_id, artifact_type, status),
  KEY idx_lead (lead_id),
  KEY idx_opportunity (opportunity_id),
  KEY idx_linked_outbox (linked_outbox_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- End of 029. Run once in phpMyAdmin against shhdbite_AV. Re-runnable.
-- Verify:
--   SHOW TABLES LIKE 'content_artifacts';
--   SHOW CREATE TABLE content_artifacts;
