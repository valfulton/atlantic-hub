-- 049_client_lead_cap.sql
-- Rails, not blockers: a PER-ACCOUNT monthly lead-discovery cap that the
-- operator (val) can raise (or lower) for any client at any time.
--
-- Today the monthly discovery ceiling is decided purely by tier (hardcoded in
-- app/api/client/discover/route.ts: TIER_MONTHLY_CAP). That's a sensible
-- default, but free / comped accounts (e.g. Skip & Mike at EHP) need a cap that
-- controls cost AND that val can bump up on a whim without changing their tier.
--
-- Semantics (enforced in lib/av/client_access.ts + the discover route):
--   lead_monthly_cap IS NULL  -> use the tier default (the rail everyone gets)
--   lead_monthly_cap = N      -> per-account override; effective cap = N
--   The override never silently blocks: when reached the client sees a calm
--   "this month's limit" message, and val can raise the number to free them.
--
-- MySQL: run ONCE (after 048), in shhdbite_AV.

USE shhdbite_AV;

ALTER TABLE clients
  ADD COLUMN lead_monthly_cap INT NULL
    COMMENT 'Per-account monthly lead-discovery cap. NULL = use tier default. Operator-raisable.' AFTER plan_tier;

-- Verify:
--   SHOW COLUMNS FROM clients LIKE 'lead_monthly_cap';
--   SELECT client_id, client_name, plan_tier, lead_monthly_cap FROM clients;
