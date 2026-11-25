-- Existing scan_pending bits did not retain execution authority. Only these new,
-- exactly scoped requests can be recovered automatically.
CREATE TABLE atom_marketplace_pending_scans (
    workspace_id TEXT NOT NULL,
    connection_id TEXT NOT NULL,
    incarnation_id TEXT NOT NULL,
    device_id TEXT NOT NULL CHECK (
      length(device_id) BETWEEN 1 AND 160 AND device_id NOT GLOB '*[^!-~]*'
    ),
    lease_epoch INTEGER NOT NULL CHECK (lease_epoch BETWEEN 1 AND 9007199254740991),
    request_id TEXT NOT NULL,
    PRIMARY KEY (workspace_id, connection_id),
    UNIQUE (workspace_id, request_id),
    FOREIGN KEY (workspace_id, connection_id)
      REFERENCES atom_marketplace_connections(workspace_id, connection_id) ON DELETE RESTRICT
) STRICT;

CREATE TRIGGER atom_marketplace_pending_requires_slot
BEFORE INSERT ON atom_marketplace_pending_scans
WHEN NOT EXISTS (
  SELECT 1 FROM atom_marketplace_connections s JOIN local_provider_connections c USING(workspace_id,connection_id)
  WHERE s.workspace_id=NEW.workspace_id AND s.connection_id=NEW.connection_id
    AND s.incarnation_id=NEW.incarnation_id AND c.connection_incarnation_id=s.incarnation_id
    AND c.provider_kind='atom' AND c.deleted_at IS NULL AND c.revoked_at IS NULL
    AND s.purged_at IS NULL AND s.scan_pending=1 AND (
      (s.state='prepared' AND c.credential_use_state='inactive' AND c.lifecycle_status='invalid')
      OR (s.state='active' AND c.credential_use_state='active'
          AND c.lifecycle_status='active' AND c.validation_status='valid')
    )
) OR EXISTS (
  SELECT 1 FROM device_handoff_barriers WHERE workspace_id=NEW.workspace_id
) OR EXISTS (
  SELECT 1 FROM atom_marketplace_scans WHERE workspace_id=NEW.workspace_id AND scan_id=NEW.request_id
)
BEGIN SELECT RAISE(ABORT, 'Atom scan requires a current slot and fresh request'); END;

CREATE TRIGGER atom_marketplace_pending_immutable
BEFORE UPDATE ON atom_marketplace_pending_scans
BEGIN SELECT RAISE(ABORT, 'Atom scan scope is immutable'); END;

CREATE TRIGGER atom_marketplace_pending_withdraw
AFTER UPDATE OF state ON atom_marketplace_connections WHEN NEW.state='revoked'
BEGIN
  DELETE FROM atom_marketplace_pending_scans
  WHERE workspace_id=OLD.workspace_id AND connection_id=OLD.connection_id;
END;

CREATE TRIGGER atom_marketplace_scan_requires_request
BEFORE INSERT ON atom_marketplace_scans
WHEN NOT EXISTS (
  SELECT 1 FROM atom_marketplace_pending_scans p JOIN atom_marketplace_connections s
    USING(workspace_id,connection_id,incarnation_id)
  WHERE p.workspace_id=NEW.workspace_id AND p.connection_id=NEW.connection_id AND p.request_id=NEW.scan_id
) OR EXISTS (
  SELECT 1 FROM device_handoff_barriers WHERE workspace_id=NEW.workspace_id
)
BEGIN SELECT RAISE(ABORT, 'Atom completion requires the durable request'); END;

CREATE TRIGGER atom_marketplace_scan_consumes_request
AFTER INSERT ON atom_marketplace_scans
BEGIN
  DELETE FROM atom_marketplace_pending_scans
  WHERE workspace_id=NEW.workspace_id AND connection_id=NEW.connection_id AND request_id=NEW.scan_id;
END;
