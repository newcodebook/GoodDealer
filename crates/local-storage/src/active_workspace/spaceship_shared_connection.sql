-- One Spaceship API key serves Registrar (`domains:read`) and SellerHub (`sellerhub:*`). A
-- connection therefore declares the role set its key proved at connect time: `["registrar"]`,
-- `["marketplace"]` or `["marketplace","registrar"]`. Each declared role keeps its own slot row,
-- scan receipts and state, but both rows share the connection incarnation and credential proof,
-- so the Native slot holds the key once. The role set stays immutable (identity triggers are
-- unchanged); adding a role later needs a new connection incarnation.
--
-- The applied single-role migrations stay byte-identical (migration checksums). The triggers
-- they pinned to one exact role are recreated here. Existing single-role rows remain valid.

DROP TRIGGER spaceship_registrar_connection_insert_shape;
CREATE TRIGGER spaceship_registrar_connection_insert_shape
BEFORE INSERT ON spaceship_registrar_connections
WHEN NEW.state != 'prepared' OR NEW.purged_at IS NOT NULL OR NOT EXISTS (
  SELECT 1 FROM local_provider_connections c
  WHERE c.workspace_id=NEW.workspace_id AND c.connection_id=NEW.connection_id
    AND c.provider_kind='spaceship' AND c.connection_incarnation_id=NEW.incarnation_id
    AND json(c.capabilities_json) IN ('["registrar"]','["marketplace","registrar"]')
    AND c.credential_use_state='inactive'
    AND c.lifecycle_status='invalid' AND c.deleted_at IS NULL AND c.revoked_at IS NULL
) OR EXISTS (
  SELECT 1 FROM spaceship_sellerhub_connections s
  WHERE s.workspace_id=NEW.workspace_id AND s.connection_id=NEW.connection_id
    AND (s.incarnation_id!=NEW.incarnation_id OR s.credential_proof!=NEW.credential_proof)
)
BEGIN SELECT RAISE(ABORT, 'Spaceship slot must start prepared'); END;

DROP TRIGGER spaceship_sellerhub_connection_insert_shape;
CREATE TRIGGER spaceship_sellerhub_connection_insert_shape
BEFORE INSERT ON spaceship_sellerhub_connections
WHEN NEW.state!='prepared' OR NEW.purged_at IS NOT NULL OR NOT EXISTS (
  SELECT 1 FROM local_provider_connections c
  WHERE c.workspace_id=NEW.workspace_id AND c.connection_id=NEW.connection_id
    AND c.provider_kind='spaceship' AND c.connection_incarnation_id=NEW.incarnation_id
    AND json(c.capabilities_json) IN ('["marketplace"]','["marketplace","registrar"]')
    AND c.credential_use_state='inactive'
    AND c.lifecycle_status='invalid' AND c.revoked_at IS NULL AND c.deleted_at IS NULL
) OR EXISTS (
  SELECT 1 FROM spaceship_registrar_connections s
  WHERE s.workspace_id=NEW.workspace_id AND s.connection_id=NEW.connection_id
    AND (s.incarnation_id!=NEW.incarnation_id OR s.credential_proof!=NEW.credential_proof)
)
BEGIN SELECT RAISE(ABORT, 'SellerHub slot must start prepared'); END;

-- A connection becomes usable once one declared role has published a complete scan. Every
-- declared role must still own a current, unretired row; a retired role retires the connection.
DROP TRIGGER spaceship_connection_publication_update;
CREATE TRIGGER spaceship_connection_publication_update
BEFORE UPDATE ON local_provider_connections
WHEN NEW.provider_kind='spaceship' AND NEW.credential_use_state='active' AND (
  NEW.revoked_at IS NOT NULL OR NEW.deleted_at IS NOT NULL
  OR NEW.lifecycle_status!='active' OR NEW.validation_status!='valid'
  OR json(NEW.capabilities_json) NOT IN ('["registrar"]','["marketplace"]','["marketplace","registrar"]')
  OR (json(NEW.capabilities_json) IN ('["registrar"]','["marketplace","registrar"]') AND NOT EXISTS (
    SELECT 1 FROM spaceship_registrar_connections s
    WHERE s.workspace_id=NEW.workspace_id AND s.connection_id=NEW.connection_id
      AND s.incarnation_id=NEW.connection_incarnation_id AND s.state IN ('prepared','active')
      AND s.purged_at IS NULL
  ))
  OR (json(NEW.capabilities_json) IN ('["marketplace"]','["marketplace","registrar"]') AND NOT EXISTS (
    SELECT 1 FROM spaceship_sellerhub_connections s
    WHERE s.workspace_id=NEW.workspace_id AND s.connection_id=NEW.connection_id
      AND s.incarnation_id=NEW.connection_incarnation_id AND s.state IN ('prepared','active')
      AND s.purged_at IS NULL
  ))
  OR NOT (
    EXISTS (
      SELECT 1 FROM spaceship_registrar_connections s
      WHERE s.workspace_id=NEW.workspace_id AND s.connection_id=NEW.connection_id
        AND s.incarnation_id=NEW.connection_incarnation_id AND s.state='active' AND s.purged_at IS NULL
    ) OR EXISTS (
      SELECT 1 FROM spaceship_sellerhub_connections s
      WHERE s.workspace_id=NEW.workspace_id AND s.connection_id=NEW.connection_id
        AND s.incarnation_id=NEW.connection_incarnation_id AND s.state='active' AND s.purged_at IS NULL
    )
  )
)
BEGIN SELECT RAISE(ABORT, 'Spaceship requires a published Native slot for the exact role'); END;

-- A role still preparing may queue its first scan after its sibling role activated the shared
-- connection. Both role triggers accept that state alongside their original ones.
DROP TRIGGER spaceship_registrar_pending_requires_slot;
CREATE TRIGGER spaceship_registrar_pending_requires_slot
BEFORE INSERT ON spaceship_registrar_pending_scans
WHEN NOT EXISTS (
  SELECT 1 FROM spaceship_registrar_connections s JOIN local_provider_connections c USING(workspace_id,connection_id)
  WHERE s.workspace_id=NEW.workspace_id AND s.connection_id=NEW.connection_id
    AND s.incarnation_id=NEW.incarnation_id AND c.connection_incarnation_id=s.incarnation_id
    AND c.provider_kind='spaceship' AND c.deleted_at IS NULL AND c.revoked_at IS NULL
    AND s.purged_at IS NULL AND s.scan_pending=1 AND (
      (s.state='prepared' AND c.credential_use_state='inactive' AND c.lifecycle_status='invalid')
      OR (s.state IN ('prepared','active') AND c.credential_use_state='active'
          AND c.lifecycle_status='active' AND c.validation_status='valid')
    )
) OR EXISTS (
  SELECT 1 FROM device_handoff_barriers WHERE workspace_id=NEW.workspace_id
) OR EXISTS (
  SELECT 1 FROM spaceship_registrar_scans WHERE workspace_id=NEW.workspace_id AND scan_id=NEW.request_id
)
BEGIN SELECT RAISE(ABORT, 'Spaceship scan requires a current slot and fresh request'); END;

DROP TRIGGER spaceship_sellerhub_pending_scope;
CREATE TRIGGER spaceship_sellerhub_pending_scope
BEFORE INSERT ON spaceship_sellerhub_pending_scans
WHEN NOT EXISTS (
  SELECT 1 FROM spaceship_sellerhub_connections s JOIN local_provider_connections c
    USING(workspace_id,connection_id)
  WHERE s.workspace_id=NEW.workspace_id AND s.connection_id=NEW.connection_id
    AND s.incarnation_id=NEW.incarnation_id AND c.connection_incarnation_id=s.incarnation_id
    AND c.provider_kind='spaceship'
    AND json(c.capabilities_json) IN ('["marketplace"]','["marketplace","registrar"]')
    AND s.purged_at IS NULL AND c.revoked_at IS NULL AND c.deleted_at IS NULL AND (
      (s.state='prepared' AND c.credential_use_state='inactive' AND c.lifecycle_status='invalid')
      OR (s.state IN ('prepared','active') AND c.credential_use_state='active'
          AND c.lifecycle_status='active' AND c.validation_status='valid')
    )
) OR EXISTS (
  SELECT 1 FROM device_handoff_barriers WHERE workspace_id=NEW.workspace_id
) OR EXISTS (
  SELECT 1 FROM spaceship_sellerhub_scans WHERE workspace_id=NEW.workspace_id AND scan_id=NEW.request_id
)
BEGIN SELECT RAISE(ABORT, 'SellerHub requires a current slot and fresh request'); END;
