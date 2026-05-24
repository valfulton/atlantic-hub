-- 042_client_access.sql
-- Client access window for trials / comped periods. Combined with the existing
-- clients.enabled flag, this lets the operator grant a full-package trial for a
-- time window, extend it, or revoke access.
--
-- Access logic (enforced in lib/av/client_access.ts):
--   active = enabled = 1 AND (access_until IS NULL OR access_until >= today)
--   access_until IS NULL  -> no expiry (a paying / permanent account)
--   access_until in past  -> trial lapsed -> "access paused" screen
--   enabled = 0           -> manually revoked -> "access paused" screen
--
-- MySQL: run ONCE (after 041).

USE shhdbite_AV;

ALTER TABLE clients
  ADD COLUMN access_until DATE NULL
    COMMENT 'Trial/comp expiry. NULL = no expiry (paying). Past = paused.' AFTER enabled;

ALTER TABLE clients
  ADD KEY idx_access_until (access_until);

-- Verify:
--   SHOW COLUMNS FROM clients LIKE 'access_until';
--   SELECT client_id, client_name, enabled, access_until, plan_tier FROM clients;
