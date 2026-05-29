-- =====================================================================
-- 059_apply_website_status_penalty.sql
--
-- One-shot retroactive penalty for the leads that ALREADY scored hot/warm
-- on synthetic websites. New scoring runs apply this penalty automatically
-- (lib/ai/score_and_audit.ts #195), so this only catches the existing
-- pipeline.
--
-- Rules — same as the code:
--   website_status = 'placeholder' -> ai_score capped at 60
--                                      ai_combined_score capped at 60
--                                      band becomes 'warm' (or 'cool' if below 50)
--   website_status = 'dead'        -> ai_score capped at 45 (cool only)
--                                      ai_combined_score capped at 45
--                                      band becomes 'cool'
--
-- Reasoning is appended to ai_score_reason so val can see why this fired.
-- Safe to re-run (the LEAST() conditions are idempotent).
-- Run AFTER 059_backfill_address_from_source_payload.sql.
-- =====================================================================

USE shhdbite_AV;

-- ─── 1. PLACEHOLDER websites: cap at 60 / warm ──────────────────────
UPDATE leads
   SET ai_score          = LEAST(IFNULL(ai_score, 0), 60),
       ai_combined_score = LEAST(IFNULL(ai_combined_score, ai_score), 60),
       ai_score_band     = CASE
                              WHEN LEAST(IFNULL(ai_score, 0), 60) >= 50 THEN 'warm'
                              ELSE 'cool'
                           END,
       ai_score_reason   = CONCAT(
         IFNULL(ai_score_reason, ''),
         CASE WHEN ai_score_reason IS NOT NULL AND ai_score_reason <> '' THEN ' ' ELSE '' END,
         '(Website is a synthetic placeholder -- reachability + intent capped, score capped at warm.)'
       )
 WHERE website_status = 'placeholder'
   AND (ai_score > 60 OR ai_combined_score > 60 OR ai_score_band = 'hot');

-- ─── 2. DEAD websites: cap at 45 / cool ─────────────────────────────
UPDATE leads
   SET ai_score          = LEAST(IFNULL(ai_score, 0), 45),
       ai_combined_score = LEAST(IFNULL(ai_combined_score, ai_score), 45),
       ai_score_band     = 'cool',
       ai_score_reason   = CONCAT(
         IFNULL(ai_score_reason, ''),
         CASE WHEN ai_score_reason IS NOT NULL AND ai_score_reason <> '' THEN ' ' ELSE '' END,
         '(Website is unreachable -- reachability + intent capped, score floored at cool.)'
       )
 WHERE website_status = 'dead'
   AND (ai_score > 45 OR ai_combined_score > 45 OR ai_score_band <> 'cool');

-- ─── 3. Verify ──────────────────────────────────────────────────────
-- How many leads got dropped? What's the new distribution?

SELECT website_status,
       ai_score_band,
       COUNT(*) AS lead_count,
       MIN(ai_score) AS min_score,
       MAX(ai_score) AS max_score,
       AVG(ai_score) AS avg_score
  FROM leads
 WHERE archived_at IS NULL
   AND website_status IN ('placeholder', 'dead', 'valid')
 GROUP BY website_status, ai_score_band
 ORDER BY website_status, ai_score_band;

-- Sample 5 of the leads that just got demoted, for sanity:
SELECT id, company, website, website_status,
       ai_score, ai_combined_score, ai_score_band,
       LEFT(ai_score_reason, 240) AS reason_head
  FROM leads
 WHERE archived_at IS NULL
   AND website_status IN ('placeholder', 'dead')
 ORDER BY ai_score DESC, id DESC
 LIMIT 5;

-- =====================================================================
-- END 059_apply_website_status_penalty.sql
-- =====================================================================
