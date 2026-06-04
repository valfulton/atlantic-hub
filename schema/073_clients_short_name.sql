/*
  073_clients_short_name — operator-set nickname per client.

  Problem this fixes: the dashboard label logic computed a brand abbreviation
  from clients.client_name (e.g. "Central Bottle Brunch" → "CB" or "Central")
  but val wants control: CBB, CLDA, EBW, HH, etc. Adding a dedicated short_name
  column means the loader can prefer val's nickname and fall back to the
  computed initials only when she hasn't set one.

  Also covers the case where a person's display_name was set to the BRAND name
  on intake (e.g. Adriana's account got "Central Bottle Brunch" as display_name
  instead of "Adriana"), which made the dashboard greeting render
  "Good morning, Central." — short_name now decouples brand label from greeting.

  Idempotent — paste in phpMyAdmin once.
*/
ALTER TABLE clients
  ADD COLUMN short_name VARCHAR(20) NULL
    COMMENT 'Operator-set brand nickname (e.g. CBB, CLDA, EBW). NULL = derive from client_name. Renders in brand chips, watchlist label, and dashboard pill.'
    AFTER client_name;
