-- Write-time rules for values the reads would otherwise have to reject row by row. Rows written
-- before this migration are not rewritten; the reads keep failing closed on them.

-- A binding names the platform of the connection it was made through.
CREATE TRIGGER domain_asset_provider_bindings_platform_matches_connection
BEFORE INSERT ON domain_asset_provider_bindings
WHEN NEW.provider_kind IS NOT (
  SELECT c.provider_kind FROM local_provider_connections c
  WHERE c.workspace_id = NEW.workspace_id AND c.connection_id = NEW.connection_id
)
BEGIN
  SELECT RAISE(ABORT, 'provider binding platform must match its connection');
END;

-- A binding's platform is immutable, so its connection's platform is too while it is bound.
CREATE TRIGGER local_provider_connections_bound_platform_immutable
BEFORE UPDATE OF provider_kind ON local_provider_connections
WHEN NEW.provider_kind IS NOT OLD.provider_kind AND EXISTS (
  SELECT 1 FROM domain_asset_provider_bindings b
  WHERE b.workspace_id = OLD.workspace_id AND b.connection_id = OLD.connection_id
)
BEGIN
  SELECT RAISE(ABORT, 'a bound connection platform is immutable');
END;

-- A recorded expiry is a real `YYYY-MM-DD` calendar date: `date()` returns exactly those unchanged.
-- The expiring window compares it as text, so any other value would sort into or out of it.
CREATE TRIGGER domain_assets_expires_on_insert_is_date
BEFORE INSERT ON domain_assets
WHEN NEW.expires_on IS NOT date(NEW.expires_on)
BEGIN
  SELECT RAISE(ABORT, 'expires_on must be a YYYY-MM-DD date');
END;

CREATE TRIGGER domain_assets_expires_on_update_is_date
BEFORE UPDATE OF expires_on ON domain_assets
WHEN NEW.expires_on IS NOT date(NEW.expires_on)
BEGIN
  SELECT RAISE(ABORT, 'expires_on must be a YYYY-MM-DD date');
END;
