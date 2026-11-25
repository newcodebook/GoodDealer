-- Spaceship API keys are replaced by a new connection incarnation and immutable Native slot.
-- These tables contain only Host-issued identities and complete, sanitized scan receipts.
CREATE TABLE spaceship_registrar_connections (
    workspace_id TEXT NOT NULL,
    connection_id TEXT NOT NULL,
    incarnation_id TEXT NOT NULL,
    credential_proof TEXT NOT NULL CHECK (
      length(credential_proof) = 64 AND credential_proof NOT GLOB '*[^0-9a-f]*'
    ),
    state TEXT NOT NULL CHECK (state IN ('prepared','active','revoked')),
    scan_pending INTEGER NOT NULL CHECK (
      scan_pending IN (0,1)
      AND (state!='prepared' OR scan_pending=1)
      AND (state!='revoked' OR scan_pending=0)
    ),
    created_at TEXT NOT NULL,
    purged_at TEXT CHECK (purged_at IS NULL OR (state='revoked' AND purged_at >= created_at)),
    PRIMARY KEY (workspace_id, connection_id),
    UNIQUE (workspace_id, incarnation_id),
    FOREIGN KEY (workspace_id, connection_id)
      REFERENCES local_provider_connections(workspace_id, connection_id) ON DELETE RESTRICT
) STRICT;

CREATE TRIGGER spaceship_registrar_connection_insert_shape
BEFORE INSERT ON spaceship_registrar_connections
WHEN NEW.state != 'prepared' OR NEW.purged_at IS NOT NULL OR NOT EXISTS (
  SELECT 1 FROM local_provider_connections c
  WHERE c.workspace_id=NEW.workspace_id AND c.connection_id=NEW.connection_id
    AND c.provider_kind='spaceship' AND c.connection_incarnation_id=NEW.incarnation_id
    AND json(c.capabilities_json)='["registrar"]' AND c.credential_use_state='inactive'
    AND c.lifecycle_status='invalid' AND c.deleted_at IS NULL AND c.revoked_at IS NULL
)
BEGIN SELECT RAISE(ABORT, 'Spaceship slot must start prepared'); END;

CREATE TRIGGER spaceship_registrar_connection_immutable
BEFORE UPDATE ON spaceship_registrar_connections
WHEN NEW.workspace_id IS NOT OLD.workspace_id OR NEW.connection_id IS NOT OLD.connection_id
  OR NEW.incarnation_id IS NOT OLD.incarnation_id OR NEW.credential_proof IS NOT OLD.credential_proof
  OR NEW.created_at IS NOT OLD.created_at
  OR (OLD.purged_at IS NOT NULL AND NEW.purged_at IS NOT OLD.purged_at)
  OR NOT (NEW.state=OLD.state OR NEW.state='revoked' OR (OLD.state='prepared' AND NEW.state='active'))
BEGIN SELECT RAISE(ABORT, 'Spaceship slot identity and retirement are permanent'); END;

CREATE TRIGGER spaceship_registrar_connection_no_delete
BEFORE DELETE ON spaceship_registrar_connections
BEGIN SELECT RAISE(ABORT, 'Spaceship slot history is permanent'); END;

CREATE TRIGGER spaceship_registrar_connection_deny_revoked
AFTER UPDATE OF state ON spaceship_registrar_connections
WHEN NEW.state='revoked' AND OLD.state!='revoked'
BEGIN
  UPDATE local_provider_connections SET credential_use_state='revoked'
   WHERE workspace_id=NEW.workspace_id AND connection_id=NEW.connection_id;
END;

CREATE TRIGGER spaceship_registrar_connection_identity_immutable
BEFORE UPDATE ON local_provider_connections
WHEN EXISTS (
  SELECT 1 FROM spaceship_registrar_connections s
  WHERE s.workspace_id=OLD.workspace_id AND s.connection_id=OLD.connection_id
) AND (
  NEW.workspace_id IS NOT OLD.workspace_id OR NEW.connection_id IS NOT OLD.connection_id
  OR NEW.provider_kind IS NOT OLD.provider_kind OR NEW.connection_incarnation_id IS NOT OLD.connection_incarnation_id
  OR NEW.capabilities_json IS NOT OLD.capabilities_json
)
BEGIN SELECT RAISE(ABORT, 'Spaceship slot owns its connection identity'); END;

CREATE TRIGGER spaceship_registrar_connection_publication_insert
BEFORE INSERT ON local_provider_connections
WHEN NEW.provider_kind='spaceship' AND NEW.credential_use_state='active'
BEGIN SELECT RAISE(ABORT, 'Spaceship must prepare a Native slot first'); END;

CREATE TRIGGER spaceship_registrar_connection_publication_update
BEFORE UPDATE ON local_provider_connections
WHEN NEW.provider_kind='spaceship' AND NEW.credential_use_state='active' AND NOT EXISTS (
  SELECT 1 FROM spaceship_registrar_connections s
  WHERE s.workspace_id=NEW.workspace_id AND s.connection_id=NEW.connection_id
    AND s.incarnation_id=NEW.connection_incarnation_id AND s.state='active'
    AND s.purged_at IS NULL AND NEW.revoked_at IS NULL AND NEW.deleted_at IS NULL
    AND NEW.lifecycle_status='active' AND NEW.validation_status='valid'
)
BEGIN SELECT RAISE(ABORT, 'Spaceship requires a published Native slot'); END;

CREATE TABLE spaceship_registrar_scans (
    workspace_id TEXT NOT NULL,
    scan_id TEXT NOT NULL,
    connection_id TEXT NOT NULL,
    observation_run_id TEXT,
    observed_count INTEGER NOT NULL CHECK (observed_count BETWEEN 0 AND 10000),
    imported_count INTEGER NOT NULL CHECK (imported_count >= 0),
    skipped_count INTEGER NOT NULL CHECK (skipped_count >= 0),
    completed_at TEXT NOT NULL,
    PRIMARY KEY (workspace_id, scan_id),
    UNIQUE (workspace_id, observation_run_id),
    FOREIGN KEY (workspace_id, connection_id)
      REFERENCES spaceship_registrar_connections(workspace_id, connection_id) ON DELETE RESTRICT,
    FOREIGN KEY (workspace_id, observation_run_id)
      REFERENCES provider_observation_runs(workspace_id, observation_run_id) ON DELETE RESTRICT,
    CHECK (imported_count + skipped_count <= observed_count),
    CHECK ((observation_run_id IS NULL) = (observed_count = skipped_count))
) STRICT;
CREATE INDEX spaceship_registrar_scan_connection
ON spaceship_registrar_scans(workspace_id, connection_id);

CREATE TRIGGER spaceship_registrar_scan_insert_shape
BEFORE INSERT ON spaceship_registrar_scans
WHEN NOT EXISTS (
  SELECT 1 FROM spaceship_registrar_connections s JOIN local_provider_connections c USING(workspace_id, connection_id)
  WHERE s.workspace_id=NEW.workspace_id AND s.connection_id=NEW.connection_id
    AND s.state='active' AND s.scan_pending=1 AND s.purged_at IS NULL AND c.credential_use_state='active'
    AND c.lifecycle_status='active' AND c.validation_status='valid'
) OR (NEW.observation_run_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM provider_observation_runs r
  WHERE r.workspace_id=NEW.workspace_id AND r.observation_run_id=NEW.observation_run_id
    AND r.connection_id=NEW.connection_id AND r.status='succeeded' AND r.completed_at=NEW.completed_at
    AND r.observation_capability='registrar' AND r.connector_version='spaceship-registrar-v1'
)) OR NEW.observed_count - NEW.skipped_count != (
  SELECT count(*) FROM registrar_observations o
  WHERE o.workspace_id=NEW.workspace_id AND o.observation_run_id=NEW.observation_run_id
    AND o.registrar_name='Spaceship'
)
BEGIN SELECT RAISE(ABORT, 'Spaceship requires an active slot and complete observation'); END;

CREATE TRIGGER spaceship_registrar_scan_no_update BEFORE UPDATE ON spaceship_registrar_scans
BEGIN SELECT RAISE(ABORT, 'Spaceship scan receipts are append-only'); END;

CREATE TRIGGER spaceship_registrar_scan_no_delete BEFORE DELETE ON spaceship_registrar_scans
BEGIN SELECT RAISE(ABORT, 'Spaceship scan receipts are append-only'); END;
