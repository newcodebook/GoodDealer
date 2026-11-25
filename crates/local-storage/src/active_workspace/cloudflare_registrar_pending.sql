CREATE TABLE cloudflare_registrar_pending_scans (
    workspace_id TEXT NOT NULL,
    connection_id TEXT NOT NULL,
    connection_incarnation_id TEXT NOT NULL,
    credential_generation INTEGER NOT NULL,
    device_id TEXT NOT NULL,
    lease_epoch INTEGER NOT NULL CHECK (lease_epoch BETWEEN 1 AND 9007199254740991),
    request_id TEXT NOT NULL,
    PRIMARY KEY (workspace_id, connection_id),
    UNIQUE (workspace_id, request_id),
    FOREIGN KEY (workspace_id, connection_id)
      REFERENCES local_provider_connections(workspace_id, connection_id) ON DELETE RESTRICT,
    FOREIGN KEY (workspace_id, connection_incarnation_id, credential_generation)
      REFERENCES cloudflare_credential_generation_ledger(workspace_id, connection_incarnation_id, generation)
      ON DELETE RESTRICT
) STRICT;

CREATE TRIGGER cloudflare_registrar_pending_requires_active_credential
BEFORE INSERT ON cloudflare_registrar_pending_scans
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
    AND connection.deleted_at IS NULL
    AND connection.active_credential_generation = NEW.credential_generation
)
OR EXISTS (SELECT 1 FROM device_handoff_barriers barrier WHERE barrier.workspace_id = NEW.workspace_id)
BEGIN SELECT RAISE(ABORT, 'registrar scan requires the current Cloudflare credential'); END;

CREATE TRIGGER cloudflare_registrar_pending_immutable
BEFORE UPDATE ON cloudflare_registrar_pending_scans
BEGIN SELECT RAISE(ABORT, 'registrar scan request scope is immutable'); END;

CREATE TRIGGER cloudflare_registrar_pending_withdraw
AFTER UPDATE OF active_credential_generation, credential_use_state, lifecycle_status,
  validation_status, deleted_at ON local_provider_connections
WHEN OLD.provider_kind = 'cloudflare' AND (
  NEW.active_credential_generation IS NOT OLD.active_credential_generation
  OR NEW.credential_use_state != 'active' OR NEW.lifecycle_status != 'active'
  OR NEW.validation_status != 'valid' OR NEW.deleted_at IS NOT NULL
)
BEGIN
  DELETE FROM cloudflare_registrar_pending_scans
  WHERE workspace_id = OLD.workspace_id AND connection_id = OLD.connection_id;
END;
