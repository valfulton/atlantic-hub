/*
  #408 popup_copy — operator-editable text for the WelcomePopover slides.
  Single row keyed by `popup_id`. Payload is JSON array of slide objects.
  WelcomePopover.tsx reads via getWelcomePopupSlides(); falls back to
  hardcoded defaults if no row.

  Apply once in phpMyAdmin:
*/
CREATE TABLE IF NOT EXISTS popup_copy (
  popup_id    VARCHAR(64)   NOT NULL,
  payload     TEXT          NOT NULL,
  updated_by  VARCHAR(255)  NULL,
  updated_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (popup_id)
);
