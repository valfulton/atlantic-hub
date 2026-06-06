-- CLEANUP_2026_06_06_courtlistener_junk.sql
--
-- Wipes the junk CourtListener parse-failure rows from CBB's distress
-- watchlist + intelligence feed. After 2026-06-06 distress_engine.ts ships
-- with the junk-label filter, these labels will stop appearing — but rows
-- already in entity_distress_scores need to be cleared once.
--
-- Safe scope: only client_id=9 (Central Business Bureau), only the known
-- junk labels. Does NOT touch real entities like "Ronald Lawrence Le Gros".
-- Re-runnable.

USE shhdbite_AV;

-- 1. Show what will be deleted (sanity check before running #2).
SELECT score_id, entity_key, entity_label, score, region_code
  FROM entity_distress_scores
 WHERE client_id = 9
   AND (
     entity_label = 'v.'
     OR entity_label = 'v'
     OR entity_label LIKE 'Miscellaneous Entry%'
     OR entity_label LIKE 'Unknown Case Title%'
     OR entity_label LIKE 'In re:%'
     OR CHAR_LENGTH(TRIM(entity_label)) < 3
   );

-- 2. Delete them.
DELETE FROM entity_distress_scores
 WHERE client_id = 9
   AND (
     entity_label = 'v.'
     OR entity_label = 'v'
     OR entity_label LIKE 'Miscellaneous Entry%'
     OR entity_label LIKE 'Unknown Case Title%'
     OR entity_label LIKE 'In re:%'
     OR CHAR_LENGTH(TRIM(entity_label)) < 3
   );

-- 3. (Optional) clear the raw public_intel_records that fed them, so the
--    Intelligence Feed stops showing them too. ONLY safe to run after #2.
DELETE FROM public_intel_records
 WHERE client_id = 9
   AND source_kind = 'courtlistener'
   AND (
     summary_label LIKE 'Miscellaneous Entry%'
     OR summary_label LIKE 'Unknown Case Title%'
     OR summary_label LIKE 'v. %'
     OR summary_label LIKE '% v. %' AND CHAR_LENGTH(TRIM(SUBSTRING_INDEX(summary_label, ' · ', 1))) < 3
   );

-- 4. Show what survived (should be the real entities only).
SELECT entity_key, entity_label, score, region_code, last_acted_at
  FROM entity_distress_scores
 WHERE client_id = 9
 ORDER BY score DESC;
