-- 048_press_release_artifact_type.sql
--
-- Run in the shhdbite_AV database.
--
-- Adds 'press_release' to content_artifacts.artifact_type so an APPROVED press
-- release can be published into the public newsroom (the PR -> newsroom path).
-- Press releases become a first-class public artifact type alongside blogs, so
-- the newsroom fills with real PR — the start of the newsroom-as-TV vision.
--
-- Safe + additive: widening an ENUM does not touch existing rows. Run ONCE.

ALTER TABLE content_artifacts
  MODIFY COLUMN artifact_type
    ENUM('blog_article','seo_article','own_brand_post','client_deliverable','press_release')
    NOT NULL;
