CREATE TABLE cloudflare_registrar_inventory_scans (
    workspace_id TEXT NOT NULL,
    scan_id TEXT NOT NULL,
    observation_run_id TEXT,
    connection_id TEXT NOT NULL,
    connection_incarnation_id TEXT NOT NULL,
    credential_generation INTEGER NOT NULL,
    account_scope_digest TEXT NOT NULL CHECK (
      length(account_scope_digest) = 64 AND account_scope_digest NOT GLOB '*[^0-9a-f]*'
    ),
    observed_count INTEGER NOT NULL CHECK (observed_count BETWEEN 0 AND 10000),
    imported_count INTEGER NOT NULL CHECK (imported_count >= 0),
    skipped_count INTEGER NOT NULL CHECK (skipped_count >= 0),
    completed_at TEXT NOT NULL,
    PRIMARY KEY (workspace_id, scan_id),
    UNIQUE (workspace_id, observation_run_id),
    FOREIGN KEY (workspace_id, connection_id)
      REFERENCES local_provider_connections(workspace_id, connection_id) ON DELETE RESTRICT,
    FOREIGN KEY (workspace_id, observation_run_id)
      REFERENCES provider_observation_runs(workspace_id, observation_run_id) ON DELETE RESTRICT,
    FOREIGN KEY (workspace_id, connection_incarnation_id, credential_generation)
      REFERENCES cloudflare_credential_generation_ledger(workspace_id, connection_incarnation_id, generation)
      ON DELETE RESTRICT,
    CHECK (imported_count + skipped_count <= observed_count),
    CHECK ((observation_run_id IS NULL) = (observed_count = skipped_count))
) STRICT;
CREATE INDEX cloudflare_registrar_inventory_current
ON cloudflare_registrar_inventory_scans(workspace_id, connection_incarnation_id, credential_generation);

CREATE TRIGGER cloudflare_registrar_inventory_scan_insert_shape
BEFORE INSERT ON cloudflare_registrar_inventory_scans
WHEN NOT EXISTS (
  SELECT 1 FROM cloudflare_credential_roots root
  JOIN local_provider_connections connection
    ON connection.workspace_id = root.workspace_id AND connection.connection_id = root.logical_connection_id
  WHERE root.workspace_id = NEW.workspace_id AND root.logical_connection_id = NEW.connection_id
    AND root.connection_incarnation_id = NEW.connection_incarnation_id
    AND root.known_envelope_kind = 'active' AND root.known_envelope_generation = NEW.credential_generation
    AND root.retirement_requested_at IS NULL AND root.retired_at IS NULL
    AND connection.provider_kind = 'cloudflare' AND connection.lifecycle_status = 'active'
    AND connection.credential_use_state = 'active' AND connection.validation_status = 'valid'
    AND connection.active_credential_generation = NEW.credential_generation
    AND json(connection.capabilities_json) = '["dns","registrar"]'
) OR (NEW.observation_run_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM provider_observation_runs run
  WHERE run.workspace_id = NEW.workspace_id AND run.observation_run_id = NEW.observation_run_id
    AND run.connection_id = NEW.connection_id AND run.completed_at = NEW.completed_at
    AND run.observation_capability = 'registrar' AND run.status = 'succeeded'
    AND run.connector_version = 'cloudflare-registrar-v4'
)
) OR EXISTS (
  SELECT 1 FROM cloudflare_registrar_inventory_scans scan
  WHERE scan.workspace_id = NEW.workspace_id
    AND scan.connection_incarnation_id = NEW.connection_incarnation_id
    AND scan.credential_generation = NEW.credential_generation
    AND scan.account_scope_digest != NEW.account_scope_digest
) OR NEW.observed_count - NEW.skipped_count != (
  SELECT count(*) FROM registrar_observations observation
  WHERE observation.workspace_id = NEW.workspace_id AND observation.observation_run_id = NEW.observation_run_id
)
BEGIN SELECT RAISE(ABORT, 'registrar inventory requires the current Cloudflare credential and complete run'); END;

CREATE TRIGGER cloudflare_registrar_inventory_scan_no_update
BEFORE UPDATE ON cloudflare_registrar_inventory_scans
BEGIN SELECT RAISE(ABORT, 'registrar inventory scans are append-only'); END;

CREATE TRIGGER cloudflare_registrar_inventory_scan_no_delete
BEFORE DELETE ON cloudflare_registrar_inventory_scans
BEGIN SELECT RAISE(ABORT, 'registrar inventory scans are append-only'); END;
