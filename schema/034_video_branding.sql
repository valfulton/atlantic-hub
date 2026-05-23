-- 034_video_branding.sql
-- Phase 2 of logo branding: VIDEO. Images composite on-the-fly (sharp), but a
-- branded video must be rendered once (ffmpeg) and stored, so we track its state
-- + storage key on the asset. The branded bytes live in Netlify Blobs (free,
-- built-in); branded_storage_key is the blob key.
--
-- NOTE: this DB is MySQL, which does NOT support `ADD COLUMN IF NOT EXISTS`
-- (that's MariaDB-only). Plain ADD COLUMN. Run ONCE. If you ever need to re-run
-- after a partial apply, drop the columns that already exist from the list.

USE shhdbite_AV;

ALTER TABLE grok_imagine_assets
  ADD COLUMN branded_status ENUM('none','processing','ready','failed') NOT NULL DEFAULT 'none',
  ADD COLUMN branded_storage_key VARCHAR(512) NULL,
  ADD COLUMN branded_error VARCHAR(500) NULL,
  ADD COLUMN branded_at DATETIME NULL;

-- Verify:
--   SHOW COLUMNS FROM grok_imagine_assets LIKE 'branded_%';
