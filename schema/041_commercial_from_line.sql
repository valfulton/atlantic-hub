-- 041_commercial_from_line.sql
-- Let a commercial be born from a NARRATIVE LINE, not only a lead.
--   * narrative_line_id: the line this commercial advances (soft ref narrative_lanes.id)
--   * lead_id becomes NULLable: a brand/line commercial has no prospect
-- A commercial may still carry a lead_id when it IS for a specific prospect;
-- it just no longer REQUIRES one. This is the "stop cockblocking me" fix.
--
-- MySQL: run ONCE, in order (after 040).

USE shhdbite_AV;

ALTER TABLE grok_imagine_assets
  MODIFY COLUMN lead_id BIGINT UNSIGNED NULL;

ALTER TABLE grok_imagine_assets
  ADD COLUMN narrative_line_id BIGINT UNSIGNED NULL AFTER lead_id;

ALTER TABLE grok_imagine_assets
  ADD KEY idx_narrative_line (narrative_line_id);

-- Verify:
--   SHOW COLUMNS FROM grok_imagine_assets LIKE 'lead_id';          -- Null = YES
--   SHOW COLUMNS FROM grok_imagine_assets LIKE 'narrative_line_id';-- 1 row
