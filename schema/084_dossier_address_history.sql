-- 084_dossier_address_history.sql  (#524, val 2026-06-08)
--
-- Adds an `address_history` JSON array to client_dossier so val never loses
-- a known-good address for a client. Each adapter that learns an address
-- (GA SOS, CA SOS, Apollo, Google Places, manual entry, etc.) APPENDS a
-- new entry instead of overwriting.
--
-- Shape per entry:
--   {
--     "id": "addr_<rand>",        // client-generated id for delete targeting
--     "address": "6105 Polo Club Drive, Cumming, GA, 30040, USA",
--     "source": "ga_sos" | "manual" | "ca_sos" | "apollo" | "google_places" | ...,
--     "captured_at": "2026-06-08T...",
--     "label": "Principal office" | "Mailing" | "Registered agent" | null,
--     "notes": "From NDVIP Inc Control #19042271" | null
--   }
--
-- The legacy `personal_address` TEXT column stays — first/primary address
-- still lives there for backward compat with the existing UI binding. Going
-- forward the panel writes the new entry to BOTH places (top of history +
-- personal_address), but reads the array as the source of truth for display.
--
-- Per val 2026-06-08: "I want the intelligence to populate new info
-- everywhere... What if he has other companies he is spinning up in
-- parallel that would mean his focus is diminished on this product." This
-- table now captures that history.

ALTER TABLE client_dossier
  ADD COLUMN address_history JSON NULL
    COMMENT 'Append-only array of addresses learned for this client. Each entry: {id, address, source, captured_at, label?, notes?}'
    AFTER personal_address;

-- Backfill: for any client_dossier rows that already have a personal_address
-- populated, seed the address_history with that single entry tagged as
-- 'manual' so we don't lose what's already there.
UPDATE client_dossier
   SET address_history = JSON_ARRAY(
         JSON_OBJECT(
           'id', CONCAT('addr_', LOWER(HEX(RANDOM_BYTES(4)))),
           'address', personal_address,
           'source', 'manual',
           'captured_at', DATE_FORMAT(COALESCE(updated_at, NOW()), '%Y-%m-%dT%H:%i:%sZ'),
           'label', NULL,
           'notes', 'Seeded from personal_address on schema 084 migration'
         )
       )
 WHERE personal_address IS NOT NULL
   AND personal_address <> ''
   AND address_history IS NULL;
