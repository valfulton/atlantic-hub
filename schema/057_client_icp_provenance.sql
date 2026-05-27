-- 057_client_icp_provenance.sql
--
-- Track WHO authored each ICP item: the operator (val) vs the client (their
-- intake). Lets the ICP editor color-code items so val can see at a glance what
-- a client added/changed and prune anything they intentionally edited out —
-- instead of trusting a silent merge.
--
-- Shape (JSON), keyed by lowercased item value per field:
--   {
--     "industries":         { "construction": "operator", "city governments": "client" },
--     "geographies":        { "florida": "client" },
--     "excludeGeographies": { ... },
--     "excludedIndustries": { "hospitals": "operator" },
--     "description":        "client" | "operator" | null
--   }
--
-- NULL = legacy row with no provenance recorded yet (treated as operator-authored
-- in the UI, since val set up every existing ICP by hand).

ALTER TABLE client_icps
  ADD COLUMN provenance JSON NULL AFTER description;
