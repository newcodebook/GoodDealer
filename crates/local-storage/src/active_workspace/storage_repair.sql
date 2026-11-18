/* ADR-0031: repairs of stored rows that reads reject. One immutable receipt per repaired row is both
   the audit record and the mark reads honour:
   - `asset_expiry`: the asset's local, unreplicated expiry was set to NULL (unknown);
   - `registrar_observation`, `dns_zone_observation`, `listing_observation`: an immutable Provider
     observation is quarantined and reads as no usable observation;
   - `dns_binding`: the asset's Zone binding is quarantined and reads as no binding.
   The receipt keeps only a SHA-256 of the prior value, never the value itself. */
CREATE TABLE storage_repair_receipts (
    workspace_id TEXT NOT NULL,
    repair_kind TEXT NOT NULL CHECK (repair_kind IN (
      'asset_expiry', 'registrar_observation', 'dns_binding', 'dns_zone_observation',
      'listing_observation'
    )),
    row_key TEXT NOT NULL CHECK (length(row_key) BETWEEN 1 AND 512),
    prior_value_sha256 TEXT NOT NULL CHECK (
      length(prior_value_sha256) = 64 AND prior_value_sha256 NOT GLOB '*[^0-9a-f]*'
    ),
    repaired_at TEXT NOT NULL CHECK (repaired_at = strftime('%Y-%m-%dT%H:%M:%SZ', repaired_at)),
    PRIMARY KEY (workspace_id, repair_kind, row_key),
    FOREIGN KEY (workspace_id) REFERENCES active_workspace_metadata(workspace_id) ON DELETE CASCADE
  ) STRICT;

CREATE TRIGGER storage_repair_receipts_immutable_update
BEFORE UPDATE ON storage_repair_receipts
BEGIN
  SELECT RAISE(ABORT, 'a storage repair receipt is immutable');
END;

CREATE TRIGGER storage_repair_receipts_immutable_delete
BEFORE DELETE ON storage_repair_receipts
BEGIN
  SELECT RAISE(ABORT, 'a storage repair receipt is immutable');
END;

/* A receipt names a row that exists, so a mark cannot be planted ahead of a future row. */
CREATE TRIGGER storage_repair_receipts_name_an_existing_row
BEFORE INSERT ON storage_repair_receipts
WHEN NOT (
  (NEW.repair_kind IN ('asset_expiry', 'dns_binding') AND EXISTS (
    SELECT 1 FROM domain_assets
    WHERE workspace_id = NEW.workspace_id AND entity_id = NEW.row_key AND deleted_at IS NULL
  ))
  OR (NEW.repair_kind = 'registrar_observation' AND EXISTS (
    SELECT 1 FROM registrar_observations
    WHERE workspace_id = NEW.workspace_id AND observation_id = NEW.row_key
  ))
  OR (NEW.repair_kind = 'dns_zone_observation' AND EXISTS (
    SELECT 1 FROM dns_zone_observations
    WHERE workspace_id = NEW.workspace_id AND zone_observation_id = NEW.row_key
  ))
  OR (NEW.repair_kind = 'listing_observation' AND EXISTS (
    SELECT 1 FROM marketplace_listing_observations
    WHERE workspace_id = NEW.workspace_id AND listing_observation_id = NEW.row_key
  ))
)
BEGIN
  SELECT RAISE(ABORT, 'a storage repair receipt must name an existing row');
END;

/* The cached sales desk is keyed on this generation; a quarantined listing changes the desk. */
CREATE TRIGGER sales_listing_generation_listing_repair
AFTER INSERT ON storage_repair_receipts
WHEN NEW.repair_kind = 'listing_observation'
BEGIN UPDATE sales_listing_generation SET generation = generation + 1 WHERE singleton = 1; END;
