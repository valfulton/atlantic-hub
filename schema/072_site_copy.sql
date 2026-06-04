/*
  072_site_copy — operator-editable copy for every client-facing surface.
  The general-purpose version of 070_popup_copy: one row per
  (copy_key, client_id, stage). lib/copy/store.ts reads with a 4-level
  fallback (exact → per-client → per-stage → global) and finally the
  hardcoded DEFAULTS map, so a fresh/empty DB still renders sane copy.

  IMPORTANT — NULL-in-PK fix: the original spec keyed the PK on nullable
  client_id/stage. MySQL forbids NULL in a PRIMARY KEY (and a UNIQUE index
  treats NULLs as distinct, which would allow duplicate "global" rows and
  break upserts). So we use sentinels instead:
      client_id = 0   -> global default (all clients)
      stage     = ''  -> any stage
  The store layer maps undefined/null context to these sentinels, and the
  API maps them back to null on the way out. Real client_ids are > 0.

  Apply once in phpMyAdmin (idempotent):
*/
CREATE TABLE IF NOT EXISTS site_copy (
  copy_key    VARCHAR(120)    NOT NULL,
  client_id   BIGINT UNSIGNED NOT NULL DEFAULT 0,   -- 0 = global default
  stage       VARCHAR(40)     NOT NULL DEFAULT '',   -- '' = any stage
  value_text  TEXT            NOT NULL,
  updated_by  VARCHAR(255)    NULL,
  updated_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (copy_key, client_id, stage),
  KEY idx_client (client_id),
  KEY idx_stage (stage),
  KEY idx_updated (updated_at)
);
