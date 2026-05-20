# Patch / Course-correction for the Social Posting Session (mid-flight)

**Status of the build:** A "social bridge, integrations stub" was shipped
earlier today in commit `52963e2`. The full schema 017 + OAuth flow is
still outstanding. This document tells the in-flight social session
what's true in the database right now and how to ship cleanly.

**Paste this entire file into the running social Claude Code chat.**

---

## DATABASE REALITY (verified 2026-05-19, 33 tables in shhdbite_AV)

The following tables already exist in `shhdbite_AV` from schema
`004_av_detail_v4.sql` (created 2026-05-12). They are EMPTY (0 rows
each) and were part of an older content-engine design that has since
been superseded by the new OAuth-based architecture in this session.

- `social_channels` (0 rows) -- old "destinations Val owns" table
- `social_posts` (0 rows) -- old generation-log table, DIFFERENT shape than schema 017
- `social_post_approvals` (0 rows) -- old approval audit

The new schema 017 plans to create a table also called `social_posts`
with a completely different shape (tenant_id, connection_id, asset_id,
status enum, etc.). MariaDB's `CREATE TABLE IF NOT EXISTS social_posts`
WILL SILENTLY SKIP because the table name already exists, and then the
new application code will write to the old (wrong-shape) table and
fail at runtime.

This is the single biggest risk in the session. Fix it before writing
any code.

---

## REQUIRED MIGRATION CHANGE (schema 017)

Open the new migration file `schema/017_social_posting.sql` you are
about to author. Add this block at the very top, BEFORE the three
`CREATE TABLE` statements:

```sql
USE shhdbite_AV;
SET NAMES utf8mb4;

-- =====================================================================
-- 017 PRELUDE: drop the three legacy v4 content-engine tables that
-- collide with this migration. All three are empty (verified
-- 2026-05-19 in phpMyAdmin) and the codebase has no live readers of
-- them. Confirm zero rows + zero foreign key references before dropping.
-- =====================================================================

-- Sanity check: refuse to drop if any of the three tables has rows.
SET @rows_channels := (SELECT IFNULL((SELECT COUNT(*) FROM social_channels), 0));
SET @rows_posts    := (SELECT IFNULL((SELECT COUNT(*) FROM social_posts), 0));
SET @rows_appr     := (SELECT IFNULL((SELECT COUNT(*) FROM social_post_approvals), 0));
SET @total_legacy  := @rows_channels + @rows_posts + @rows_appr;

SET @sql := IF(@total_legacy = 0,
  'SELECT "legacy social_* tables are empty -- safe to drop" AS info',
  'SELECT "ABORT: legacy social_* tables have rows -- DO NOT RUN 017" AS error');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Drop the three legacy v4 tables (only after the sanity check above).
SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS social_post_approvals;
DROP TABLE IF EXISTS social_posts;
DROP TABLE IF EXISTS social_channels;
SET FOREIGN_KEY_CHECKS = 1;

-- ===== End of prelude. CREATE TABLE statements follow. =====
```

Then the three CREATE TABLE statements from the kickoff doc (social_connections, social_posts, social_publish_log) follow unchanged.

The migration MUST remain idempotent: re-running it must be safe. The
`DROP TABLE IF EXISTS` + `CREATE TABLE IF NOT EXISTS` combination
achieves this.

---

## CODE-SIDE REFERENCE CHECK

Before dropping, grep the repo to confirm zero live references to the
three legacy tables:

```bash
cd "$HOME/Library/CloudStorage/OneDrive-atlanticandvine.com/HunterHoney/_organized/atlantic-hub"
grep -rn "social_channels\|social_post_approvals" --include="*.ts" --include="*.tsx" lib/ app/
grep -rn "FROM social_posts\|INTO social_posts\|UPDATE social_posts" --include="*.ts" --include="*.tsx" lib/ app/
```

Expected result: zero application-code matches. Only matches should be
in `schema/004_av_detail_v4.sql` (the file that created them) and
`schema/HANDOFF_*.md` archive docs.

If grep finds live code references, STOP and report back to the
conductor. Do not drop. We will rename the new tables instead.

---

## STILL APPLIES FROM THE ORIGINAL KICKOFF

Everything in `docs/CLAUDE_KICKOFF_SOCIAL_POSTING.md` still applies:

- File ownership unchanged
- Schema number is 017 (reserve in `docs/SESSION_COORDINATION.md` registry)
- OAuth flow architecture (LinkedIn + X first, Meta + TikTok deferred)
- Token encryption via dedicated `SOCIAL_TOKEN_ENCRYPTION_KEY` env var
- Client-facing guardrails per `docs/CLIENT_FACING_GUARDRAILS.md`
- Multi-tenancy: tenant_id is `'av' | 'ebw' | 'hh' | 'client:<id>'`
- Auto-publish cron at `netlify/functions/social-publish-cron.mts`
- Add a "Social" entry to `components/Sidebar.tsx` (NOTE: the file is
  `components/Sidebar.tsx`, not `app/admin/_components/Sidebar.tsx`)

---

## INTEGRATION WITH WHAT JUST SHIPPED TODAY

- The Email Outreach Automation session shipped schema 014 + the
  `lib/email/` driver layer + `/admin/av/outreach` UI. Do NOT touch
  any file under `lib/email/` or `app/admin/av/outreach/`.
- The Grok Imagine session already shipped per-lead asset generation
  (schema 011 + 016) and a "social bridge stub" in commit 52963e2.
  Reuse that stub if it exists at `lib/social/` -- read first, do not
  recreate. Build on top.
- The slug collision fix landed in commit 57d08ae. All dynamic route
  segments are snake_case-only. Use `[connection_id]`, `[post_id]`,
  `[provider]` -- never camelCase.

---

## DELIVERABLES CHECKLIST

1. Add the schema-017 prelude block above
2. Reserve 017 in `docs/SESSION_COORDINATION.md` schema registry
3. Build the OAuth flow for LinkedIn + X (v1 scope)
4. Wire `social_publish_cron.mts` into `netlify.toml`
5. Add Sidebar "Social" link in `components/Sidebar.tsx`
6. Document new env vars in `docs/ENV_VARS_REFERENCE.md`
7. `npx tsc --noEmit` returns exit 0
8. `npm run build` returns "Compiled successfully"
9. Commit + push -- one bundled commit, ASCII-only message
10. Append to `docs/CHANGELOG.md` with commit hash
11. Hand back a one-paragraph summary to Val with the exact paths
    and full URLs (Val is moving between many files -- full URLs
    every time, no relative paths in the summary)

---

## WHAT TO HAND BACK TO VAL

Use this template for the summary message:

```
Social Posting Connectors shipped. Schema 017 created social_connections
+ social_posts + social_publish_log and cleanly dropped the three empty
legacy v4 tables.

To finish go-live:

1. Run schema 017 in phpMyAdmin:
   /Users/atlanticandvine/Library/CloudStorage/OneDrive-atlanticandvine.com/HunterHoney/_organized/atlantic-hub/schema/017_social_posting.sql

2. Set these env vars in Netlify
   (https://app.netlify.com/sites/atlantic-hub/configuration/env):
   - SOCIAL_TOKEN_ENCRYPTION_KEY (generate with openssl rand -hex 32)
   - LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET
   - X_CLIENT_ID, X_CLIENT_SECRET (paid X Basic plan required)

3. Visit https://atlantic-hub.netlify.app/admin/social to connect
   your first account.

Full instructions:
/Users/atlanticandvine/Library/CloudStorage/OneDrive-atlanticandvine.com/HunterHoney/_organized/atlantic-hub/docs/SOCIAL_GOLIVE_RUNBOOK.md
```

End of patch document.
